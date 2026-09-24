import type { ConversationState, NormalizedMessage, NormalizedResponse, SessionStore } from "@gracesoft-sentinel/core";
import { dataSubjectOf, type DataSubject, type UserDataEraser } from "./erasers.js";

export const CONFIRM_REPLY_ID = "user-data-deletion:confirm";
export const CANCEL_REPLY_ID = "user-data-deletion:cancel";

const DEFAULT_TRIGGERS = ["/deletemydata", "delete my data", "/forgetme", "forget me"];
const DEFAULT_CONFIRMATION_TTL_SECONDS = 5 * 60;
const CONFIRM_WORD = "DELETE";

export interface UserDataDeletionResult {
  subject: DataSubject;
  erased: Record<string, number>;
  failed: { eraser: string; error: unknown }[];
}

export interface UserDataDeletionConfig {
  /** Every store holding this chatter's data. All run on confirmation; one failing never stops the others. */
  erasers: UserDataEraser[];
  /** Holds the short-lived "waiting for confirmation" marker — the service's own session store is fine (its own key prefix). */
  pendingStore: SessionStore;
  /** Exact, case-insensitive whole-message matches. Defaults to /deletemydata, "delete my data", /forgetme, "forget me". */
  triggers?: string[];
  confirmationTtlSeconds?: number;
  /**
   * Plain-language list of what will go, shown in the confirmation prompt,
   * e.g. ["your conversation history", "your booking records"]. Defaults
   * to a generic "your conversation history and saved chat state".
   */
  whatIsDeleted?: string[];
  /** Anything that is deliberately *not* deleted and why, e.g. confirmed appointments on the business calendar. Shown in the prompt. */
  notDeletedNote?: string;
  /** Where to go if something couldn't be deleted. */
  contact: string;
  onDeleted?: (result: UserDataDeletionResult) => void;
}

interface PendingContext {
  pendingDeletion?: boolean;
}

function pendingKey(subject: DataSubject): string {
  return `user-data-deletion:${subject.channel}:${subject.senderId}`;
}

function normalize(text: string | undefined): string {
  return (text ?? "").trim().toLowerCase();
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Wraps a service's `onMessage` with a PDPA-style "delete my data" command.
 * Two steps, never one: the trigger only *asks*, naming exactly what will
 * be deleted, and nothing is erased until the chatter confirms (a button,
 * or typing DELETE) within a few minutes. Any other reply cancels the
 * request and is handled as a normal message, so ignoring the prompt never
 * traps anyone.
 *
 * Wrap this *outermost* — outside any rate limiter, agent-switcher, or
 * conversation logging — so the command itself is never forwarded to an
 * agent or written to the very log it's asking to erase. A partial failure
 * is reported as one, with a contact to follow up, never as "done".
 */
export function withUserDataDeletion(
  onMessage: (message: NormalizedMessage) => Promise<NormalizedResponse>,
  config: UserDataDeletionConfig
): (message: NormalizedMessage) => Promise<NormalizedResponse> {
  const triggers = new Set((config.triggers ?? DEFAULT_TRIGGERS).map(normalize));
  const ttl = config.confirmationTtlSeconds ?? DEFAULT_CONFIRMATION_TTL_SECONDS;
  const whatIsDeleted = joinList(config.whatIsDeleted ?? ["your conversation history and saved chat state"]);

  async function erase(subject: DataSubject): Promise<UserDataDeletionResult> {
    const result: UserDataDeletionResult = { subject, erased: {}, failed: [] };
    for (const eraser of config.erasers) {
      try {
        result.erased[eraser.name] = await eraser.erase(subject);
      } catch (error) {
        result.failed.push({ eraser: eraser.name, error });
      }
    }
    config.onDeleted?.(result);
    return result;
  }

  return async (message: NormalizedMessage): Promise<NormalizedResponse> => {
    const subject = dataSubjectOf(message);
    const key = pendingKey(subject);
    const text = normalize(message.text);

    if (triggers.has(text)) {
      const now = new Date().toISOString();
      const pending: ConversationState = {
        sessionId: key,
        channel: message.channel,
        userId: message.senderId,
        agent: "user-data-deletion",
        createdAt: now,
        updatedAt: now,
        context: { pendingDeletion: true } satisfies PendingContext,
      };
      await config.pendingStore.set(pending, ttl);
      const note = config.notDeletedNote ? `\n\n${config.notDeletedNote}` : "";
      return {
        text: `This will permanently delete ${whatIsDeleted} with us. It can't be undone.${note}\n\nReply ${CONFIRM_WORD} to confirm, or anything else to cancel.`,
        quickReplies: [
          { id: CONFIRM_REPLY_ID, label: "Yes, delete my data" },
          { id: CANCEL_REPLY_ID, label: "Cancel" },
        ],
      };
    }

    const pending = await config.pendingStore.get(key);
    if (!(pending?.context as PendingContext | undefined)?.pendingDeletion) return onMessage(message);

    await config.pendingStore.delete(key);

    const confirmed = message.quickReplyId === CONFIRM_REPLY_ID || (message.text ?? "").trim() === CONFIRM_WORD;
    if (confirmed) {
      const result = await erase(subject);
      if (result.failed.length > 0) {
        return {
          text: `Some of your data couldn't be deleted just now. Please contact ${config.contact} and we'll finish the job by hand.`,
        };
      }
      return { text: "Done — your data has been deleted. If you message again, we'll start a fresh conversation." };
    }

    if (message.quickReplyId === CANCEL_REPLY_ID || text === "cancel") {
      return { text: "Okay — nothing was deleted." };
    }
    // Anything else: the request lapses and the message is answered normally.
    return onMessage(message);
  };
}
