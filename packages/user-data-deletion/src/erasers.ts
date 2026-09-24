import type { NormalizedMessage, SessionStore } from "@gracesoft-sentinel/core";

/** Who is asking to be forgotten — the same identity every session key in this repo is built from. */
export interface DataSubject {
  channel: string;
  senderId: string;
  businessChannelId?: string;
}

export function dataSubjectOf(message: NormalizedMessage): DataSubject {
  return { channel: message.channel, senderId: message.senderId, businessChannelId: message.businessChannelId };
}

/**
 * One store's share of an erasure. Deliberately tiny so each service can
 * plug in whatever it actually persists (Redis sessions, Postgres logs, an
 * in-memory store) without this package depending on any of them.
 */
export interface UserDataEraser {
  /** Shown in logs and the result, e.g. "sessions" or "conversation-log". */
  name: string;
  /** Deletes everything this store holds for `subject`; resolves to how many records went. */
  erase(subject: DataSubject): Promise<number>;
}

/**
 * Erases the given session keys from a `SessionStore`. `sessionIdsFor`
 * must list every key the service writes for a chatter — each agent's own
 * key plus anything wrapped around it (e.g. agent-switcher's). Missing
 * keys are fine (`delete` of an absent key is a no-op); a missed key
 * format is not, which is why each service's test pins its list.
 */
export function sessionStoreEraser(store: SessionStore, sessionIdsFor: (subject: DataSubject) => string[], name = "sessions"): UserDataEraser {
  return {
    name,
    async erase(subject) {
      let erased = 0;
      for (const sessionId of sessionIdsFor(subject)) {
        if (await store.get(sessionId)) erased += 1;
        await store.delete(sessionId);
      }
      return erased;
    },
  };
}

/** The slice of `logging-postgres`'s `ConversationDataEraser` this needs — structural, so this package doesn't depend on Postgres. */
export interface SessionLogEraser {
  deleteSessionData(sessionIds: string[]): Promise<{ messages: number; bookings: number }>;
}

/** Erases a chatter's rows from the conversation/booking audit log, keyed by the same session ids as `sessionStoreEraser`. */
export function conversationLogEraser(log: SessionLogEraser, sessionIdsFor: (subject: DataSubject) => string[], name = "conversation-log"): UserDataEraser {
  return {
    name,
    async erase(subject) {
      const { messages, bookings } = await log.deleteSessionData(sessionIdsFor(subject));
      return messages + bookings;
    },
  };
}
