import type { ConversationState, SessionStore } from "@gracesoft-sentinel/core";

interface Entry {
  state: ConversationState;
  expiresAt: number | null;
}

/**
 * A single-process demo doesn't need Redis — this is the whole session
 * store for the standalone service. Implements the exact same
 * `SessionStore` interface `provider-session-redis` does, so swapping in
 * Redis later (for a multi-instance deployment) is a one-line composition
 * change, not a rewrite.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly entries = new Map<string, Entry>();

  async get(sessionId: string): Promise<ConversationState | null> {
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.entries.delete(sessionId);
      return null;
    }
    return entry.state;
  }

  async set(state: ConversationState, ttlSeconds?: number): Promise<void> {
    this.entries.set(state.sessionId, { state, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
  }

  async delete(sessionId: string): Promise<void> {
    this.entries.delete(sessionId);
  }

  /** For readiness/health checks only — never used for chat logic. */
  size(): number {
    return this.entries.size;
  }
}
