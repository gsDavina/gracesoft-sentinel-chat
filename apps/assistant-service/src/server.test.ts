import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadSnapshot, type QueryContext } from "@gracesoft-sentinel/agent-assistant";
import type { AssistantServiceEnv } from "./env.js";
import { buildServer } from "./server.js";
import { createChatHandler } from "./chat-handler.js";
import { InMemorySessionStore } from "./in-memory-session-store.js";
import { DailyCallCap } from "./daily-call-cap.js";
import { createSilentTestLogger, FakeAiProvider, FIXTURE_SNAPSHOT_DIR } from "./test-support.js";

const BASE_ENV: AssistantServiceEnv = {
  PORT: 0,
  OPENAI_API_KEY: "sk-test",
  OPENAI_MODEL: "gpt-4o-mini",
  SNAPSHOT_DIR: FIXTURE_SNAPSHOT_DIR,
  AS_OF_DATE: "2026-09-10",
  DEMO_TOKEN: "test-token",
  MAX_TOOL_STEPS: 6,
  MODEL_TIMEOUT_MS: 5000,
  MAX_TOKENS_PER_REQUEST: 512,
  RATE_LIMIT_PER_IP_PER_MINUTE: 100,
  RATE_LIMIT_PER_SESSION_PER_MINUTE: 2,
  DAILY_MODEL_CALL_CAP: 500,
};

let ctx: QueryContext;
let snapshot: ReturnType<typeof loadSnapshot>;

beforeAll(() => {
  snapshot = loadSnapshot(FIXTURE_SNAPSHOT_DIR);
  ctx = { desk: snapshot.desk, skylight: snapshot.skylight, crossTool: snapshot.crossTool, asOfDate: "2026-09-10" };
});

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function listen(envOverrides: Partial<AssistantServiceEnv> = {}, isReady = () => true) {
  const env = { ...BASE_ENV, ...envOverrides };
  const sessionStore = new InMemorySessionStore();
  const chatHandler = createChatHandler({
    ctx,
    aiProvider: new FakeAiProvider("Fixed test answer."),
    sessionStore,
    appLogger: createSilentTestLogger(),
    callCap: new DailyCallCap(500),
    maxSteps: env.MAX_TOOL_STEPS,
    timeoutMs: env.MODEL_TIMEOUT_MS,
    maxTokens: env.MAX_TOKENS_PER_REQUEST,
    fallbackAnswers: [],
  });
  const app = buildServer({ env, snapshot, chatHandler, resetSession: (id) => sessionStore.delete(id), appLogger: createSilentTestLogger(), isReady });
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const { port } = server!.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, sessionStore };
}

describe("GET /health", () => {
  it("returns 200 once ready", async () => {
    const { baseUrl } = await listen({}, () => true);
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });

  it("returns 503 before the snapshot has loaded", async () => {
    const { baseUrl } = await listen({}, () => false);
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(503);
  });
});

describe("GET /meta", () => {
  it("returns the snapshot span, as-of date, record counts and model", async () => {
    const { baseUrl } = await listen();
    const res = await fetch(`${baseUrl}/meta`);
    const body = (await res.json()) as { recordCounts: { projects: number } };
    expect(body).toMatchObject({ snapshotStart: "2026-07-10", snapshotEnd: "2026-09-10", asOfDate: "2026-09-10", model: "gpt-4o-mini" });
    expect(body.recordCounts.projects).toBe(5);
  });
});

describe("POST /chat — access control", () => {
  it("rejects a request without the demo token with 401", async () => {
    const { baseUrl } = await listen();
    const res = await fetch(`${baseUrl}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "s1", message: "hi" }) });
    expect(res.status).toBe(401);
  });

  it("rejects a request with the wrong demo token with 401", async () => {
    const { baseUrl } = await listen();
    const res = await fetch(`${baseUrl}/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer wrong" }, body: JSON.stringify({ sessionId: "s1", message: "hi" }) });
    expect(res.status).toBe(401);
  });
});

describe("POST /chat — validation", () => {
  it("rejects a missing message with 400", async () => {
    const { baseUrl } = await listen();
    const res = await fetch(`${baseUrl}/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-token" }, body: JSON.stringify({ sessionId: "s1" }) });
    expect(res.status).toBe(400);
  });

  it("rejects an empty message with 400", async () => {
    const { baseUrl } = await listen();
    const res = await fetch(`${baseUrl}/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-token" }, body: JSON.stringify({ sessionId: "s1", message: "   " }) });
    expect(res.status).toBe(400);
  });

  it("rejects an oversized message with 400", async () => {
    const { baseUrl } = await listen();
    const res = await fetch(`${baseUrl}/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-token" }, body: JSON.stringify({ sessionId: "s1", message: "a".repeat(3000) }) });
    expect(res.status).toBe(400);
  });
});

describe("POST /chat — success", () => {
  it("returns the answer and metadata", async () => {
    const { baseUrl } = await listen();
    const res = await fetch(`${baseUrl}/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-token" }, body: JSON.stringify({ sessionId: "s1", message: "hi" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ answer: "Fixed test answer.", gracefulFailure: false, capped: false });
  });

  it("streams via SSE when requested", async () => {
    const { baseUrl } = await listen();
    const res = await fetch(`${baseUrl}/chat?stream=1`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-token" }, body: JSON.stringify({ sessionId: "s1", message: "hi" }) });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text.startsWith("data: ")).toBe(true);
    expect(JSON.parse(text.replace(/^data: /, "").trim())).toMatchObject({ answer: "Fixed test answer." });
  });
});

describe("POST /chat — rate limiting", () => {
  it("returns 429 once the per-session limit is exceeded", async () => {
    const { baseUrl } = await listen({ RATE_LIMIT_PER_SESSION_PER_MINUTE: 1 });
    const send = () => fetch(`${baseUrl}/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-token" }, body: JSON.stringify({ sessionId: "s1", message: "hi" }) });
    const first = await send();
    const second = await send();
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });
});

describe("POST /sessions/:id/reset", () => {
  it("clears the session", async () => {
    const { baseUrl, sessionStore } = await listen();
    await fetch(`${baseUrl}/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-token" }, body: JSON.stringify({ sessionId: "s1", message: "hi" }) });
    expect(await sessionStore.get("s1")).not.toBeNull();

    const res = await fetch(`${baseUrl}/sessions/s1/reset`, { method: "POST", headers: { authorization: "Bearer test-token" } });
    expect(res.status).toBe(200);
    expect(await sessionStore.get("s1")).toBeNull();
  });

  it("requires the demo token", async () => {
    const { baseUrl } = await listen();
    const res = await fetch(`${baseUrl}/sessions/s1/reset`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});
