import { beforeAll, describe, expect, it } from "vitest";
import { loadSnapshot, type QueryContext } from "@gracesoft-sentinel/agent-assistant";
import { createChatHandler } from "./chat-handler.js";
import { InMemorySessionStore } from "./in-memory-session-store.js";
import { DailyCallCap } from "./daily-call-cap.js";
import { createSilentTestLogger, FakeAiProvider, FIXTURE_SNAPSHOT_DIR } from "./test-support.js";

let ctx: QueryContext;

beforeAll(() => {
  const snapshot = loadSnapshot(FIXTURE_SNAPSHOT_DIR);
  ctx = { desk: snapshot.desk, skylight: snapshot.skylight, crossTool: snapshot.crossTool, asOfDate: "2026-09-10" };
});

function buildHandler(overrides: Partial<{ callCap: DailyCallCap; sessionStore: InMemorySessionStore }> = {}) {
  const sessionStore = overrides.sessionStore ?? new InMemorySessionStore();
  const callCap = overrides.callCap ?? new DailyCallCap(100);
  const handler = createChatHandler({
    ctx,
    aiProvider: new FakeAiProvider("The answer is 16 billable hours."),
    sessionStore,
    appLogger: createSilentTestLogger(),
    callCap,
    maxSteps: 6,
    timeoutMs: 5000,
    maxTokens: 512,
  });
  return { handler, sessionStore, callCap };
}

describe("chat handler", () => {
  it("answers a question and persists the turn to session memory", async () => {
    const { handler, sessionStore } = buildHandler();
    const result = await handler({ sessionId: "s1", message: "hours in August?", channel: "web", userId: "u1" });
    expect(result).toMatchObject({ answer: "The answer is 16 billable hours.", capped: false });
    const state = await sessionStore.get("s1");
    expect(state?.context.history).toEqual([
      { role: "user", content: "hours in August?" },
      { role: "assistant", content: "The answer is 16 billable hours." },
    ]);
  });

  it("refuses new model calls once the daily cap is reached, without calling the model", async () => {
    const cap = new DailyCallCap(1);
    cap.recordCall();
    const { handler } = buildHandler({ callCap: cap });
    const result = await handler({ sessionId: "s1", message: "hi", channel: "web", userId: "u1" });
    expect(result.capped).toBe(true);
    expect(result.answer).toMatch(/usage limit/);
  });
});
