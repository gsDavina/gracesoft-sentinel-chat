import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { CHANNELS_DISABLED } from "@gracesoft-sentinel/webhook-host";
import type { ConciergeServiceEnv } from "./env.js";
import { buildServer } from "./server.js";
import { createSilentTestLogger } from "./test-support.js";

const BASE_ENV: ConciergeServiceEnv = {
  PORT: 0,
  OPENAI_API_KEY: "sk-test",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "svc@example.iam.gserviceaccount.com",
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "key",
  REDIS_URL: "redis://localhost:6379",
  DATABASE_URL: "postgres://localhost:5432/db",
  BUSINESS_CONFIG_PATH: "./business-config.json",
  ...CHANNELS_DISABLED,
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

async function listen(env: ConciergeServiceEnv): Promise<string> {
  const app = buildServer({
    env,
    onMessage: async () => ({ text: "unused" }),
    readinessCheck: async () => true,
    appLogger: createSilentTestLogger(),
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe("buildServer — health/readiness", () => {
  it("GET /health always returns ok", async () => {
    const baseUrl = await listen(BASE_ENV);
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /ready returns 200 when the readiness check passes", async () => {
    const app = buildServer({
      env: BASE_ENV,
      onMessage: async () => ({ text: "unused" }),
      readinessCheck: async () => true,
      appLogger: createSilentTestLogger(),
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(res.status).toBe(200);
  });

  it("GET /ready returns 503 when the readiness check fails", async () => {
    const app = buildServer({
      env: BASE_ENV,
      onMessage: async () => ({ text: "unused" }),
      readinessCheck: async () => {
        throw new Error("redis unreachable");
      },
      appLogger: createSilentTestLogger(),
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(res.status).toBe(503);
  });
});

describe("buildServer — conditional channel mounting", () => {
  it("mounts the Telegram webhook route when TELEGRAM_ENABLED", async () => {
    const baseUrl = await listen(BASE_ENV);
    // A POST without the secret header should hit the router (403), not 404 (not mounted).
    const res = await fetch(`${baseUrl}/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(403);
  });

  it("does not mount the WhatsApp webhook route when WHATSAPP_ENABLED is false", async () => {
    const baseUrl = await listen(BASE_ENV);
    const res = await fetch(`${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=y`);
    // Telegram's router only registers POST /webhook, not GET — so a GET falls through to 404 either way,
    // proving WhatsApp's GET handshake route specifically was never mounted.
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
    // 403 (missing Telegram secret header) proves the request was actually
    // handled by the rate limiter + router, not a 500 from an unhandled
    // ValidationError thrown by express-rate-limit's proxy-trust check.
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
