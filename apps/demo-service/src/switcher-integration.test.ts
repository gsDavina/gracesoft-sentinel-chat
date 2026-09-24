import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { NormalizedMessage } from "@gracesoft-sentinel/core";
import { createAgentSwitcher } from "@gracesoft-sentinel/agent-switcher";
import { loadSnapshot, type QueryContext } from "@gracesoft-sentinel/agent-assistant";
import { createConciergeOnMessageHandler } from "./concierge-on-message.js";
import { createCookOnMessageHandler } from "./cook-on-message.js";
import { createAssistantOnMessageHandler } from "./assistant-on-message.js";
import { conversationLogEraser, sessionStoreEraser, withUserDataDeletion, CONFIRM_REPLY_ID } from "@gracesoft-sentinel/user-data-deletion";
import { demoSessionIds } from "./composition.js";
import {
  FakeAiProvider,
  FakeCalendarProvider,
  FakeConversationLogger,
  FakeRecipeSourceProvider,
  FakeSessionStore,
  TEST_BUSINESS_CONFIG,
  TEST_FAQ_BLUEPRINT,
  createSilentTestLogger,
} from "./test-support.js";

const FIXTURE_SNAPSHOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/agent-assistant/data/snapshot/valid");

function loadFixtureContext(): QueryContext {
  const snapshot = loadSnapshot(FIXTURE_SNAPSHOT_DIR);
  return { desk: snapshot.desk, skylight: snapshot.skylight, crossTool: snapshot.crossTool, asOfDate: "2026-09-10" };
}

/**
 * Proves the actual demo-service wiring — not just agent-switcher's own
 * isolated unit tests (which use trivial fake agents) — correctly switches
 * between two *real* agents (agent-concierge, agent-cook) built the same
 * way composition.ts builds them, sharing one SessionStore.
 */
function makeMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return { id: "msg-1", channel: "telegram", senderId: "chatter-1", timestamp: new Date().toISOString(), raw: {}, ...overrides };
}

function buildTestSwitcher(recipeSourceProvider?: FakeRecipeSourceProvider) {
  const aiProvider = new FakeAiProvider();
  const sessionStore = new FakeSessionStore();
  const conversationLogger = new FakeConversationLogger();
  const appLogger = createSilentTestLogger();

  const conciergeOnMessage = createConciergeOnMessageHandler({
    businessConfig: TEST_BUSINESS_CONFIG,
    faqBlueprint: TEST_FAQ_BLUEPRINT,
    calendarProvider: new FakeCalendarProvider(),
    aiProvider,
    sessionStore,
    conversationLogger,
    appLogger,
  });
  const cookOnMessage = createCookOnMessageHandler({ aiProvider, sessionStore, conversationLogger, appLogger, recipeSourceProvider });
  const assistantOnMessage = createAssistantOnMessageHandler({
    ctx: loadFixtureContext(),
    aiProvider,
    sessionStore,
    appLogger,
    maxSteps: 6,
    timeoutMs: 15_000,
    maxTokens: 1024,
  });

  const onMessage = createAgentSwitcher({
    agents: [
      { name: "concierge", label: "Sentinel Concierge", triggers: ["/concierge", "concierge"], onMessage: conciergeOnMessage },
      { name: "cook", label: "Sentinel Cook", triggers: ["/cook", "cook"], onMessage: cookOnMessage },
      { name: "assistant", label: "GraceSoft Assistant", triggers: ["/assistant", "assistant"], onMessage: assistantOnMessage },
    ],
    defaultAgent: "concierge",
    sessionStore,
  });

  return { onMessage, aiProvider, conversationLogger, sessionStore };
}

describe("demo-service — switching between real agent-concierge and agent-cook", () => {
  it("starts on the default agent (concierge) and stays there without an explicit switch", async () => {
    const { onMessage } = buildTestSwitcher();
    const response = await onMessage(makeMessage({ text: "Do you sell coffee?" }));
    // TEST_FAQ_BLUEPRINT's ai_disclosure is disabled, so this is a plain FAQ answer, not a cook-shaped one.
    expect(response.text).toBe("fake answer");
  });

  it("switches to Cook via command, and the switch confirmation isn't itself forwarded to either agent", async () => {
    const { onMessage, aiProvider } = buildTestSwitcher();
    const response = await onMessage(makeMessage({ text: "/cook" }));
    expect(response.text).toContain("Sentinel Cook");
    expect(aiProvider.calls).toHaveLength(0);
  });

  it("routes a photo to Cook after switching, producing a recipe-shaped reply, not a Concierge FAQ answer", async () => {
    const { onMessage } = buildTestSwitcher();
    await onMessage(makeMessage({ text: "/cook" }));

    const response = await onMessage(
      makeMessage({ text: undefined, media: [{ type: "image", url: "data:image/png;base64,abc", mimeType: "image/png" }] })
    );
    expect(response.text).toContain("Chicken Rice");
  });

  it("switches back to Concierge and its own conversation state survived the detour to Cook untouched", async () => {
    const { onMessage } = buildTestSwitcher();

    // Offered 3 slots on Concierge (the default agent) — "book something"
    // matches the booking-intent keyword with no date/time given.
    const offer = await onMessage(makeMessage({ text: "book something" }));
    expect(offer.quickReplies).toHaveLength(3);

    // Detour to Cook and back.
    await onMessage(makeMessage({ text: "/cook" }));
    await onMessage(makeMessage({ text: "what can I make with eggs?" }));
    const back = await onMessage(makeMessage({ text: "/concierge" }));
    expect(back.text).toContain("Sentinel Concierge");

    // Picking "the first one" only resolves to an actual booking if
    // Concierge's own candidate-slot state from before the detour to Cook
    // is still there — proves the switcher didn't clobber it.
    const resumed = await onMessage(makeMessage({ text: "the first one" }));
    expect(resumed.text).toMatch(/booked/i);
  });

  it("routes a personal-recipe request to Cook's RAG lookup after switching, when a recipeSourceProvider is configured", async () => {
    const recipeSourceProvider = new FakeRecipeSourceProvider([
      { id: "1", title: "Mom's Chicken Curry", raw: { content: "Simmer the chicken for 40 minutes with coconut milk." } },
    ]);
    const { onMessage } = buildTestSwitcher(recipeSourceProvider);

    await onMessage(makeMessage({ text: "/cook" }));
    const response = await onMessage(makeMessage({ text: "do you have my mom's recipe for chicken curry?" }));

    expect(response.text).toContain("Mom's Chicken Curry");
    expect(response.text).toContain("Simmer the chicken for 40 minutes");
    expect(recipeSourceProvider.findRecipesCalls).toHaveLength(1);
  });

  it("falls back to Cook's ordinary photo prompt for personal-recipe phrasing when no recipeSourceProvider is configured", async () => {
    const { onMessage } = buildTestSwitcher();
    await onMessage(makeMessage({ text: "/cook" }));
    // Possessive-only phrasing (dish name before "recipe", no "recipe for X" /
    // "how to make X") — doesn't also satisfy agent-cook's free recipe
    // search, which (by design) needs no recipeSourceProvider at all and
    // would otherwise generate a generic recipe instead of prompting for a photo.
    const response = await onMessage(makeMessage({ text: "do you have my mom's chicken curry recipe?" }));
    expect(response.text).toMatch(/send me a photo/i);
  });

  it("switches to the GraceSoft Assistant via command and answers from the real M2 query layer/M3 loop", async () => {
    const { onMessage } = buildTestSwitcher();
    const switchResponse = await onMessage(makeMessage({ text: "/assistant" }));
    expect(switchResponse.text).toContain("GraceSoft Assistant");

    const answer = await onMessage(makeMessage({ text: "what stage is project 4 in?" }));
    // FakeAiProvider always replies {"action":"final_answer","text":"fake answer"} — proves the
    // request reached runAssistant and came back through the switcher, not that the model chose a tool.
    expect(answer.text).toBe("fake answer");
  });

  it("logs each turn under the correct agent name, not always whichever was active last", async () => {
    const { onMessage, conversationLogger } = buildTestSwitcher();
    await onMessage(makeMessage({ text: "/cook" }));
    await onMessage(makeMessage({ text: "what can I make with eggs?" }));

    const cookEntries = conversationLogger.messages.filter((m) => m.agent === "cook");
    const conciergeEntries = conversationLogger.messages.filter((m) => m.agent === "concierge");
    expect(cookEntries.length).toBeGreaterThan(0);
    expect(conciergeEntries).toHaveLength(0); // switching to cook never touched concierge's own on-message handler
  });
});

describe("demo-service — /deletemydata across every agent", () => {
  it("erases every session key and log row the real agents wrote for this chatter, and nothing of anyone else's", async () => {
    const { onMessage: switcherOnMessage, sessionStore, conversationLogger } = buildTestSwitcher();
    const onMessage = withUserDataDeletion(switcherOnMessage, {
      erasers: [sessionStoreEraser(sessionStore, demoSessionIds), conversationLogEraser(conversationLogger, demoSessionIds)],
      pendingStore: sessionStore,
      contact: "hello@gracesoft.dev",
    });

    // Talk to all three agents so each writes its own session, plus the switcher's.
    await onMessage(makeMessage({ text: "Do you sell coffee?" }));
    await onMessage(makeMessage({ text: "/cook" }));
    await onMessage(makeMessage({ text: "recipe for fried rice" }));
    await onMessage(makeMessage({ text: "/assistant" }));
    await onMessage(makeMessage({ text: "What's overdue?" }));
    await onMessage(makeMessage({ senderId: "someone-else", text: "Do you sell coffee?" }));

    const mine = [...sessionStore.sessions.keys()].filter((key) => key.endsWith(":chatter-1"));
    expect(mine.length).toBeGreaterThanOrEqual(4);
    expect(conversationLogger.messages.some((m) => m.sessionId.endsWith(":chatter-1"))).toBe(true);

    await onMessage(makeMessage({ text: "/deletemydata" }));
    const reply = await onMessage(makeMessage({ quickReplyId: CONFIRM_REPLY_ID, text: "Yes, delete my data" }));

    expect(reply.text).toMatch(/has been deleted/);
    // demoSessionIds covered every key format the real handlers actually wrote — none survived.
    expect([...sessionStore.sessions.keys()].filter((key) => key.includes("chatter-1"))).toEqual([]);
    expect(conversationLogger.messages.filter((m) => m.sessionId.endsWith(":chatter-1"))).toEqual([]);
    expect([...sessionStore.sessions.keys()].some((key) => key.endsWith(":someone-else"))).toBe(true);
    expect(conversationLogger.messages.some((m) => m.sessionId.endsWith(":someone-else"))).toBe(true);
  });
});
