import { describe, expect, it } from "vitest";
import type { ConversationState, NormalizedMessage, SessionStore } from "@gracesoft-sentinel/core";
import { sessionStoreEraser, type UserDataEraser } from "./erasers.js";
import { CANCEL_REPLY_ID, CONFIRM_REPLY_ID, withUserDataDeletion, type UserDataDeletionResult } from "./with-user-data-deletion.js";

class FakeSessionStore implements SessionStore {
  readonly sessions = new Map<string, ConversationState>();
  async get(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }
  async set(state: ConversationState) {
    this.sessions.set(state.sessionId, state);
  }
  async delete(sessionId: string) {
    this.sessions.delete(sessionId);
  }
}

function state(sessionId: string): ConversationState {
  const now = new Date().toISOString();
  return { sessionId, channel: "telegram", userId: "u1", agent: "cook", createdAt: now, updatedAt: now, context: {} };
}

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return { id: "m", channel: "telegram", senderId: "u1", timestamp: new Date().toISOString(), raw: {}, ...overrides };
}

function setup(extraErasers: UserDataEraser[] = []) {
  const store = new FakeSessionStore();
  store.sessions.set("cook:telegram:u1", state("cook:telegram:u1"));
  store.sessions.set("cook:telegram:someone-else", state("cook:telegram:someone-else"));
  const forwarded: NormalizedMessage[] = [];
  const results: UserDataDeletionResult[] = [];
  const onMessage = withUserDataDeletion(
    async (m) => {
      forwarded.push(m);
      return { text: "agent reply" };
    },
    {
      erasers: [sessionStoreEraser(store, (s) => [`cook:${s.channel}:${s.senderId}`]), ...extraErasers],
      pendingStore: store,
      contact: "hello@example.com",
      notDeletedNote: "Appointments stay on the calendar.",
      onDeleted: (r) => results.push(r),
    }
  );
  return { store, forwarded, results, onMessage };
}

describe("withUserDataDeletion", () => {
  it("passes ordinary messages straight through", async () => {
    const { onMessage, forwarded } = setup();
    expect((await onMessage(message({ text: "hello" }))).text).toBe("agent reply");
    expect(forwarded).toHaveLength(1);
  });

  it("asks for confirmation first, deleting nothing and forwarding nothing", async () => {
    const { onMessage, forwarded, store } = setup();
    const prompt = await onMessage(message({ text: "  /DeleteMyData " }));
    expect(prompt.text).toMatch(/permanently delete/);
    expect(prompt.text).toContain("Appointments stay on the calendar.");
    expect(prompt.quickReplies?.map((q) => q.id)).toEqual([CONFIRM_REPLY_ID, CANCEL_REPLY_ID]);
    expect(forwarded).toHaveLength(0);
    expect(store.sessions.has("cook:telegram:u1")).toBe(true);
  });

  it("erases only this chatter's data on a tapped confirmation", async () => {
    const { onMessage, store, results, forwarded } = setup();
    await onMessage(message({ text: "delete my data" }));
    const done = await onMessage(message({ text: "Yes, delete my data", quickReplyId: CONFIRM_REPLY_ID }));
    expect(done.text).toMatch(/has been deleted/);
    expect(store.sessions.has("cook:telegram:u1")).toBe(false);
    expect(store.sessions.has("cook:telegram:someone-else")).toBe(true);
    expect(results[0]!.erased).toEqual({ sessions: 1 });
    expect(forwarded).toHaveLength(0);
    // The pending marker is gone too — nothing about the request lingers.
    expect([...store.sessions.keys()].some((k) => k.startsWith("user-data-deletion:"))).toBe(false);
  });

  it("accepts the typed confirmation word (exact, case-sensitive)", async () => {
    const { onMessage, store } = setup();
    await onMessage(message({ text: "/forgetme" }));
    await onMessage(message({ text: "DELETE" }));
    expect(store.sessions.has("cook:telegram:u1")).toBe(false);
  });

  it("cancels on the cancel button without forwarding", async () => {
    const { onMessage, store, forwarded } = setup();
    await onMessage(message({ text: "/deletemydata" }));
    expect((await onMessage(message({ text: "Cancel", quickReplyId: CANCEL_REPLY_ID }))).text).toMatch(/nothing was deleted/);
    expect(store.sessions.has("cook:telegram:u1")).toBe(true);
    expect(forwarded).toHaveLength(0);
  });

  it("lets any other reply lapse the request and answers it normally", async () => {
    const { onMessage, store, forwarded } = setup();
    await onMessage(message({ text: "/deletemydata" }));
    expect((await onMessage(message({ text: "actually, what's for dinner?" }))).text).toBe("agent reply");
    expect(forwarded).toHaveLength(1);
    expect(store.sessions.has("cook:telegram:u1")).toBe(true);
    // ...and a later DELETE on its own does nothing, since the request lapsed.
    await onMessage(message({ text: "DELETE" }));
    expect(store.sessions.has("cook:telegram:u1")).toBe(true);
  });

  it("does not treat 'delete' in lowercase as confirmation", async () => {
    const { onMessage, store } = setup();
    await onMessage(message({ text: "/deletemydata" }));
    await onMessage(message({ text: "delete" }));
    expect(store.sessions.has("cook:telegram:u1")).toBe(true);
  });

  it("keeps each chatter's pending request separate", async () => {
    const { onMessage, store } = setup();
    await onMessage(message({ text: "/deletemydata" }));
    await onMessage(message({ senderId: "someone-else", text: "DELETE" }));
    expect(store.sessions.has("cook:telegram:someone-else")).toBe(true);
  });

  it("reports a partial failure as a failure, after still running every other eraser", async () => {
    const failing: UserDataEraser = {
      name: "conversation-log",
      erase: async () => {
        throw new Error("postgres down");
      },
    };
    const { onMessage, store, results } = setup([failing]);
    await onMessage(message({ text: "/deletemydata" }));
    const reply = await onMessage(message({ quickReplyId: CONFIRM_REPLY_ID }));
    expect(reply.text).toMatch(/couldn't be deleted/);
    expect(reply.text).toContain("hello@example.com");
    expect(store.sessions.has("cook:telegram:u1")).toBe(false);
    expect(results[0]!.failed.map((f) => f.eraser)).toEqual(["conversation-log"]);
  });
});

describe("conversationLogEraser", () => {
  it("deletes by the subject's session ids and sums both tables", async () => {
    const { conversationLogEraser } = await import("./erasers.js");
    const calls: string[][] = [];
    const eraser = conversationLogEraser(
      { deleteSessionData: async (ids) => (calls.push(ids), { messages: 3, bookings: 1 }) },
      (s) => [`cook:${s.channel}:${s.senderId}`, `switcher:${s.channel}:${s.senderId}`]
    );
    expect(await eraser.erase({ channel: "telegram", senderId: "u1" })).toBe(4);
    expect(calls).toEqual([["cook:telegram:u1", "switcher:telegram:u1"]]);
  });
});
