import { beforeAll, describe, expect, it } from "vitest";
import type { NormalizedMessage } from "@gracesoft-sentinel/core";
import { buildDemoFallbackAnswers, loadSnapshot, type QueryContext } from "@gracesoft-sentinel/agent-assistant";
import { createOnMessageHandler } from "./on-message.js";
import { InMemorySessionStore } from "./in-memory-session-store.js";
import { DailyCallCap } from "./daily-call-cap.js";
import { SessionRateLimiter } from "./session-rate-limiter.js";
import { createSilentTestLogger, FakeAiProvider, FIXTURE_SNAPSHOT_DIR } from "./test-support.js";

let ctx: QueryContext;

beforeAll(() => {
  const snapshot = loadSnapshot(FIXTURE_SNAPSHOT_DIR);
  ctx = { desk: snapshot.desk, skylight: snapshot.skylight, crossTool: snapshot.crossTool, asOfDate: "2026-09-10" };
});

function makeMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return { id: "msg-1", channel: "telegram", senderId: "chatter-1", timestamp: new Date().toISOString(), raw: {}, ...overrides };
}

function buildHandler(overrides: Partial<{ aiProvider: FakeAiProvider; callCap: DailyCallCap; rateLimiter: SessionRateLimiter }> = {}) {
  const sessionStore = new InMemorySessionStore();
  const onMessage = createOnMessageHandler({
    ctx,
    aiProvider: overrides.aiProvider ?? new FakeAiProvider("The answer is 16 billable hours."),
    sessionStore,
    appLogger: createSilentTestLogger(),
    callCap: overrides.callCap ?? new DailyCallCap(100),
    fallbackAnswers: buildDemoFallbackAnswers(ctx),
    rateLimiter: overrides.rateLimiter,
    maxSteps: 6,
    timeoutMs: 5000,
    maxTokens: 512,
  });
  return { onMessage, sessionStore };
}

describe("createOnMessageHandler", () => {
  it("answers a question and persists the turn to session memory", async () => {
    const { onMessage, sessionStore } = buildHandler();
    const response = await onMessage(makeMessage({ text: "hours in August?" }));
    expect(response.text).toBe("The answer is 16 billable hours.");

    const state = await sessionStore.get("assistant:telegram:chatter-1");
    expect(state?.context.history).toEqual([
      { role: "user", content: "hours in August?" },
      { role: "assistant", content: "The answer is 16 billable hours." },
    ]);
  });

  it("prompts for a question when the message has no text (e.g. a photo)", async () => {
    const { onMessage } = buildHandler();
    const response = await onMessage(makeMessage({ text: undefined, media: [{ type: "image", url: "data:image/png;base64,abc" }] }));
    expect(response.text).toMatch(/ask me about/i);
  });

  it("refuses new model calls once the daily cap is reached, without calling the model", async () => {
    const cap = new DailyCallCap(1);
    cap.recordCall();
    const { onMessage } = buildHandler({ callCap: cap });
    const response = await onMessage(makeMessage({ text: "hi" }));
    expect(response.text).toMatch(/usage limit/);
  });

  it("rate-limits a chatter sending too many messages, without calling the model", async () => {
    const limiter = new SessionRateLimiter(1, 60_000);
    const { onMessage } = buildHandler({ rateLimiter: limiter });
    const first = await onMessage(makeMessage({ text: "hi" }));
    const second = await onMessage(makeMessage({ text: "hi again" }));
    expect(first.text).not.toMatch(/quickly/);
    expect(second.text).toMatch(/quickly/);
  });

  it("keeps two chatters' sessions independent", async () => {
    const { onMessage, sessionStore } = buildHandler();
    await onMessage(makeMessage({ senderId: "chatter-a", text: "question A" }));
    await onMessage(makeMessage({ senderId: "chatter-b", text: "question B" }));

    const stateA = await sessionStore.get("assistant:telegram:chatter-a");
    const stateB = await sessionStore.get("assistant:telegram:chatter-b");
    expect(stateA?.context.history).toEqual([{ role: "user", content: "question A" }, expect.anything()]);
    expect(stateB?.context.history).toEqual([{ role: "user", content: "question B" }, expect.anything()]);
  });
});
