import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { CHANNELS_DISABLED } from "@gracesoft-sentinel/webhook-host";
import type { DemoServiceEnv } from "./env.js";
import { buildServer } from "./server.js";
import { createSilentTestLogger } from "./test-support.js";

const BASE_ENV: DemoServiceEnv = {
  PORT: 0,
  OPENAI_API_KEY: "sk-test",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "svc@example.iam.gserviceaccount.com",
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "key",
  REDIS_URL: "redis://localhost:6379",
  DATABASE_URL: "postgres://localhost:5432/db",
  BUSINESS_CONFIG_PATH: "./business-config.json",
  DEMO_DEFAULT_AGENT: "concierge",
  ASSISTANT_ENABLED: false,
  ASSISTANT_AS_OF_DATE: "2026-09-10",
  ASSISTANT_MAX_TOOL_STEPS: 6,
  ASSISTANT_MODEL_TIMEOUT_MS: 15_000,
  ASSISTANT_MAX_TOKENS_PER_REQUEST: 1024,
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

async function listen(env: DemoServiceEnv): Promise<string> {
  const app = buildServer({
    env,
    onMessage: async () => ({ text: "unused" }),
    readinessCheck: async () => true,
    appLogger: createSilentTestLogger(),
  });
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
    const app = buildServer({
      env: BASE_ENV,
      onMessage: async () => ({ text: "unused" }),
      readinessCheck: async () => {
        throw new Error("postgres unreachable");
      },
      appLogger: createSilentTestLogger(),
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server!.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(res.status).toBe(503);
  });
});

describe("buildServer — conditional channel mounting", () => {
  it("mounts the Telegram webhook route when TELEGRAM_ENABLED", async () => {
    const baseUrl = await listen(BASE_ENV);
    const res = await fetch(`${baseUrl}/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(403); // reaches the secret-token check, proving the route exists
  });
});
