import { describe, expect, it } from "vitest";
import type { ConversationState } from "@gracesoft-sentinel/core";
import { InMemorySessionStore } from "./in-memory-session-store.js";

function state(sessionId: string): ConversationState {
  return { sessionId, channel: "web", userId: "u1", agent: "gracesoft-assistant", createdAt: "now", updatedAt: "now", context: {} };
}

describe("InMemorySessionStore", () => {
  it("returns null for a session that was never set", async () => {
    const store = new InMemorySessionStore();
    expect(await store.get("missing")).toBeNull();
  });

  it("round-trips a session", async () => {
    const store = new InMemorySessionStore();
    await store.set(state("s1"));
    expect(await store.get("s1")).toMatchObject({ sessionId: "s1" });
  });

  it("deletes a session", async () => {
    const store = new InMemorySessionStore();
    await store.set(state("s1"));
    await store.delete("s1");
    expect(await store.get("s1")).toBeNull();
  });

  it("expires a session after its TTL", async () => {
    const store = new InMemorySessionStore();
    await store.set(state("s1"), 0.01); // 10ms
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await store.get("s1")).toBeNull();
  });
});
