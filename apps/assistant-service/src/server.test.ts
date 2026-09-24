import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { AssistantServiceEnv } from "./env.js";
import { buildServer } from "./server.js";
import { createSilentTestLogger } from "./test-support.js";

const BASE_ENV: AssistantServiceEnv = {
  PORT: 0,
  OPENAI_API_KEY: "sk-test",
  OPENAI_MODEL: "gpt-4o-mini",
  SNAPSHOT_DIR: "/unused-in-these-tests",
  AS_OF_DATE: "2026-09-10",
  MAX_TOOL_STEPS: 6,
  MODEL_TIMEOUT_MS: 5000,
  MAX_TOKENS_PER_REQUEST: 512,
  DAILY_MODEL_CALL_CAP: 500,
  RATE_LIMIT_PER_CHATTER_PER_MINUTE: 10,
  WHATSAPP_ENABLED: false,
  TELEGRAM_ENABLED: true,
  TELEGRAM_BOT_TOKEN: "t",
  TELEGRAM_WEBHOOK_SECRET: "s",
};

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function listen(env: AssistantServiceEnv, readinessCheck: () => Promise<boolean> = async () => true): Promise<string> {
  const app = buildServer({ env, onMessage: async () => ({ text: "unused" }), readinessCheck, appLogger: createSilentTestLogger() });
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const { port } = server!.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe("buildServer — health/readiness", () => {
  it("GET /health always returns ok", async () => {
    const baseUrl = await listen(BASE_ENV);
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /ready returns 503 when the readiness check fails", async () => {
    const baseUrl = await listen(BASE_ENV, async () => {
      throw new Error("unreachable");
    });
    const res = await fetch(`${baseUrl}/ready`);
    expect(res.status).toBe(503);
  });
});

describe("buildServer — conditional channel mounting", () => {
  it("mounts the Telegram webhook route when TELEGRAM_ENABLED", async () => {
    const baseUrl = await listen(BASE_ENV);
    const res = await fetch(`${baseUrl}/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(403); // wrong/missing Telegram secret token
  });

  it("has no /chat or /sessions route — the assistant is reachable only through mounted channels", async () => {
    const baseUrl = await listen(BASE_ENV);
    const res = await fetch(`${baseUrl}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(404);
  });
});

describe("buildServer — rate limiting", () => {
  it("doesn't crash on a request carrying X-Forwarded-For (regression: ERR_ERL_UNEXPECTED_X_FORWARDED_FOR without app.set('trust proxy', ...))", async () => {
    const baseUrl = await listen(BASE_ENV);
    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.1" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("rate limits the webhook endpoint after too many requests from the same source", async () => {
    const baseUrl = await listen(BASE_ENV);
    let lastStatus = 200;
    for (let i = 0; i < 121; i++) {
      const res = await fetch(`${baseUrl}/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
