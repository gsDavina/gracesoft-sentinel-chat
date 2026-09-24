import { describe, expect, it } from "vitest";
import type { ConversationState, NormalizedMessage, SessionStore } from "@gracesoft-sentinel/core";
import { createAgentSwitcher, type RegisteredAgent } from "./switcher.js";

class FakeSessionStore implements SessionStore {
  private readonly sessions = new Map<string, ConversationState>();

  async get(sessionId: string): Promise<ConversationState | null> {
    return this.sessions.get(sessionId) ?? null;
  }
  async set(state: ConversationState): Promise<void> {
    this.sessions.set(state.sessionId, state);
  }
  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

function makeMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return { id: "msg-1", channel: "telegram", senderId: "user-1", timestamp: new Date().toISOString(), raw: {}, ...overrides };
}

function fakeAgent(name: string, label: string, triggers: string[]): RegisteredAgent & { calls: NormalizedMessage[] } {
  const calls: NormalizedMessage[] = [];
  return {
    name,
    label,
    triggers,
    calls,
    onMessage: async (message: NormalizedMessage) => {
      calls.push(message);
      return { text: `${name}-reply` };
    },
  };
}

describe("createAgentSwitcher", () => {
  it("forwards to the default agent when no explicit switch has ever happened", async () => {
    const concierge = fakeAgent("concierge", "Sentinel Concierge", ["/concierge", "concierge"]);
    const cook = fakeAgent("cook", "Sentinel Cook", ["/cook", "cook"]);
    const onMessage = createAgentSwitcher({
      agents: [concierge, cook],
      defaultAgent: "concierge",
      sessionStore: new FakeSessionStore(),
    });

    const response = await onMessage(makeMessage({ text: "hi" }));
    expect(response.text).toBe("concierge-reply");
    expect(concierge.calls).toHaveLength(1);
    expect(cook.calls).toHaveLength(0);
  });

  it("switches via an exact command and confirms without forwarding that message to any agent", async () => {
    const concierge = fakeAgent("concierge", "Sentinel Concierge", ["/concierge", "concierge"]);
    const cook = fakeAgent("cook", "Sentinel Cook", ["/cook", "cook"]);
    const onMessage = createAgentSwitcher({
      agents: [concierge, cook],
      defaultAgent: "concierge",
      sessionStore: new FakeSessionStore(),
    });

    const response = await onMessage(makeMessage({ text: "/cook" }));
    expect(response.text).toContain("Sentinel Cook");
    expect(concierge.calls).toHaveLength(0);
    expect(cook.calls).toHaveLength(0); // the switch command itself is never forwarded
  });

  it("switches via a bare passphrase, not just a slash command", async () => {
    const concierge = fakeAgent("concierge", "Sentinel Concierge", ["/concierge", "concierge"]);
    const cook = fakeAgent("cook", "Sentinel Cook", ["/cook", "cook"]);
    const onMessage = createAgentSwitcher({
      agents: [concierge, cook],
      defaultAgent: "concierge",
      sessionStore: new FakeSessionStore(),
    });

    const response = await onMessage(makeMessage({ text: "Cook" })); // case-insensitive too
    expect(response.text).toContain("Sentinel Cook");
  });

  it("routes subsequent messages to whichever agent was last switched to", async () => {
    const concierge = fakeAgent("concierge", "Sentinel Concierge", ["/concierge", "concierge"]);
    const cook = fakeAgent("cook", "Sentinel Cook", ["/cook", "cook"]);
    const sessionStore = new FakeSessionStore();
    const onMessage = createAgentSwitcher({ agents: [concierge, cook], defaultAgent: "concierge", sessionStore });

    await onMessage(makeMessage({ text: "/cook" }));
    const response = await onMessage(makeMessage({ text: "what can you make with eggs?" }));

    expect(response.text).toBe("cook-reply");
    expect(cook.calls).toHaveLength(1);
    expect(concierge.calls).toHaveLength(0);
  });

  it("does not switch on a message that merely contains a trigger word as part of a longer sentence", async () => {
    const concierge = fakeAgent("concierge", "Sentinel Concierge", ["/concierge", "concierge"]);
    const cook = fakeAgent("cook", "Sentinel Cook", ["/cook", "cook"]);
    const onMessage = createAgentSwitcher({
      agents: [concierge, cook],
      defaultAgent: "concierge",
      sessionStore: new FakeSessionStore(),
    });

    const response = await onMessage(makeMessage({ text: "can you cook up a good appointment time?" }));
    expect(response.text).toBe("concierge-reply"); // stays on the default, not misread as a switch to cook
    expect(concierge.calls).toHaveLength(1);
  });

  it("keeps each chatter's active agent independent of other chatters", async () => {
    const concierge = fakeAgent("concierge", "Sentinel Concierge", ["/concierge", "concierge"]);
    const cook = fakeAgent("cook", "Sentinel Cook", ["/cook", "cook"]);
    const sessionStore = new FakeSessionStore();
    const onMessage = createAgentSwitcher({ agents: [concierge, cook], defaultAgent: "concierge", sessionStore });

    await onMessage(makeMessage({ senderId: "user-A", text: "/cook" }));
    const responseB = await onMessage(makeMessage({ senderId: "user-B", text: "hi" }));

    expect(responseB.text).toBe("concierge-reply"); // user-B never switched, still on the default
  });

  it("throws at construction time if defaultAgent isn't one of the registered agents", () => {
    const concierge = fakeAgent("concierge", "Sentinel Concierge", ["/concierge"]);
    expect(() =>
      createAgentSwitcher({ agents: [concierge], defaultAgent: "does-not-exist", sessionStore: new FakeSessionStore() })
    ).toThrow(/does-not-exist/);
  });
});

describe("createAgentSwitcher — service map", () => {
  function setup() {
    const concierge = { ...fakeAgent("concierge", "Sentinel Concierge", ["/concierge", "concierge"]), description: "FAQs and bookings" };
    const cook = { ...fakeAgent("cook", "Sentinel Cook", ["/cook", "cook"]), description: "Recipes from a dish photo" };
    const sessionStore = new FakeSessionStore();
    const onMessage = createAgentSwitcher({
      agents: [concierge, cook],
      defaultAgent: "concierge",
      sessionStore,
      serviceMapFooter: "Send /deletemydata to erase your data.",
    });
    return { concierge, cook, onMessage };
  }

  it("lists every agent, its description and command, marks the active one, and offers a button per agent", async () => {
    const { onMessage, concierge, cook } = setup();
    const response = await onMessage(makeMessage({ text: "/services" }));
    expect(response.text).toContain("• Sentinel Concierge (you're here) — FAQs and bookings. Say \"/concierge\".");
    expect(response.text).toContain("• Sentinel Cook — Recipes from a dish photo. Say \"/cook\".");
    expect(response.text).toContain("Send /services any time");
    expect(response.text).toContain("Send /deletemydata to erase your data.");
    expect(response.quickReplies).toEqual([
      { id: "/concierge", label: "Sentinel Concierge" },
      { id: "/cook", label: "Sentinel Cook" },
    ]);
    expect(concierge.calls).toHaveLength(0);
    expect(cook.calls).toHaveLength(0);
  });

  it("follows the active agent after a switch", async () => {
    const { onMessage } = setup();
    await onMessage(makeMessage({ text: "/cook" }));
    const response = await onMessage(makeMessage({ text: "Menu" }));
    expect(response.text).toContain("Sentinel Cook (you're here)");
    expect(response.text).not.toContain("Sentinel Concierge (you're here)");
  });

  it("switches when a service-map button is tapped, even on channels that put the label (not the id) in text", async () => {
    const { onMessage, cook } = setup();
    const response = await onMessage(makeMessage({ text: "Sentinel Cook", quickReplyId: "/cook" }));
    expect(response.text).toContain("Switched to Sentinel Cook");
    await onMessage(makeMessage({ text: "eggs?" }));
    expect(cook.calls).toHaveLength(1);
  });

  it("can be turned off", async () => {
    const concierge = fakeAgent("concierge", "Sentinel Concierge", ["/concierge"]);
    const onMessage = createAgentSwitcher({ agents: [concierge], defaultAgent: "concierge", sessionStore: new FakeSessionStore(), serviceMapTriggers: [] });
    expect((await onMessage(makeMessage({ text: "/services" }))).text).toBe("concierge-reply");
  });
});
