import type { ChatMessage, ConversationState, SessionStore } from "@gracesoft-sentinel/core";

/** Bounds how much prior conversation is replayed into every model call — enough for "and in July?"-style follow-ups without unbounded token growth. */
const MAX_HISTORY_TURNS = 10;
const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour of inactivity — a demo session, not a durable record.

export interface SessionIdentity {
  channel: string;
  userId: string;
}

function isChatMessage(value: unknown): value is ChatMessage {
  return typeof value === "object" && value !== null && "role" in value && "content" in value && typeof (value as { content: unknown }).content === "string";
}

/** Reads this session's prior turns, for `runAssistant`'s `history` param — an empty array for a brand-new or reset session, never an error. */
export async function loadHistory(store: SessionStore, sessionId: string): Promise<ChatMessage[]> {
  const state = await store.get(sessionId);
  const raw = state?.context.history;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isChatMessage).slice(-MAX_HISTORY_TURNS * 2);
}

/** Appends this turn's user question and the assistant's answer, creating the session on first use. */
export async function appendTurn(store: SessionStore, sessionId: string, identity: SessionIdentity, question: string, answer: string, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
  const existing = await store.get(sessionId);
  const history = (Array.isArray(existing?.context.history) ? existing.context.history.filter(isChatMessage) : []) as ChatMessage[];
  const updatedHistory = [...history, { role: "user" as const, content: question }, { role: "assistant" as const, content: answer }].slice(-MAX_HISTORY_TURNS * 2);

  const now = new Date().toISOString();
  const state: ConversationState = {
    sessionId,
    channel: identity.channel,
    userId: identity.userId,
    agent: "gracesoft-assistant",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    context: { history: updatedHistory },
  };
  await store.set(state, ttlSeconds);
}

/** Clears a session's context — the standalone service's `POST /sessions/:id/reset` and demo-service's switcher-level reset both call this. */
export async function resetSession(store: SessionStore, sessionId: string): Promise<void> {
  await store.delete(sessionId);
}
