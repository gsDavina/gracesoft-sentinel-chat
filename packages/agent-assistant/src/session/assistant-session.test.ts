import { describe, expect, it } from "vitest";
import type { ConversationState, SessionStore } from "@gracesoft-sentinel/core";
import { appendTurn, loadHistory, resetSession } from "./assistant-session.js";

class InMemorySessionStore implements SessionStore {
  private readonly states = new Map<string, ConversationState>();

  async get(sessionId: string): Promise<ConversationState | null> {
    return this.states.get(sessionId) ?? null;
  }
  async set(state: ConversationState): Promise<void> {
    this.states.set(state.sessionId, state);
  }
  async delete(sessionId: string): Promise<void> {
    this.states.delete(sessionId);
  }
}

describe("assistant session memory", () => {
  it("returns an empty history for a brand-new session", async () => {
    const store = new InMemorySessionStore();
    expect(await loadHistory(store, "session-1")).toEqual([]);
  });

  it("accumulates turns so a follow-up question has context", async () => {
    const store = new InMemorySessionStore();
    await appendTurn(store, "session-1", { channel: "web", userId: "u1" }, "how many billable hours in August?", "16 billable hours.");
    const history = await loadHistory(store, "session-1");
    expect(history).toEqual([
      { role: "user", content: "how many billable hours in August?" },
      { role: "assistant", content: "16 billable hours." },
    ]);
  });

  it("keeps separate sessions from leaking into each other", async () => {
    const store = new InMemorySessionStore();
    await appendTurn(store, "session-a", { channel: "web", userId: "a" }, "question A", "answer A");
    await appendTurn(store, "session-b", { channel: "web", userId: "b" }, "question B", "answer B");

    expect(await loadHistory(store, "session-a")).toEqual([
      { role: "user", content: "question A" },
      { role: "assistant", content: "answer A" },
    ]);
    expect(await loadHistory(store, "session-b")).toEqual([
      { role: "user", content: "question B" },
      { role: "assistant", content: "answer B" },
    ]);
  });

  it("clears the session on reset", async () => {
    const store = new InMemorySessionStore();
    await appendTurn(store, "session-1", { channel: "web", userId: "u1" }, "q", "a");
    await resetSession(store, "session-1");
    expect(await loadHistory(store, "session-1")).toEqual([]);
  });

  it("caps history so it doesn't grow unbounded across many turns", async () => {
    const store = new InMemorySessionStore();
    for (let i = 0; i < 20; i++) {
      await appendTurn(store, "session-1", { channel: "web", userId: "u1" }, `question ${i}`, `answer ${i}`);
    }
    const history = await loadHistory(store, "session-1");
    expect(history.length).toBeLessThanOrEqual(20);
    expect(history.at(-1)).toEqual({ role: "assistant", content: "answer 19" });
  });
});
