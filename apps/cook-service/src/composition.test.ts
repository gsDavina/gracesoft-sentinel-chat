import { describe, expect, it } from "vitest";
import { CHANNELS_DISABLED } from "@gracesoft-sentinel/webhook-host";
import { buildComposition } from "./composition.js";
import type { CookServiceEnv } from "./env.js";

/**
 * Proves `cook-service` actually wires up with OpenAI, Redis, and Postgres
 * given valid-shaped (not live) credentials. Construction never makes a
 * network call for any of these clients, so this is a legitimate
 * no-live-credentials smoke test, not a mock of the wiring.
 */
describe("buildComposition — cook-service", () => {
  const env: CookServiceEnv = {
    PORT: 3001,
    OPENAI_API_KEY: "sk-test",
    OPENAI_MODEL: undefined,
    OPENAI_VISION_MODEL: undefined,
    REDIS_URL: "redis://localhost:6379",
    DATABASE_URL: "postgres://localhost:5432/db",
    ...CHANNELS_DISABLED,
    WHATSAPP_ENABLED: false,
    TELEGRAM_ENABLED: true,
    TELEGRAM_BOT_TOKEN: "t",
    TELEGRAM_WEBHOOK_SECRET: "s",
  };

  it("wires OpenAI, Redis, and Postgres without throwing", () => {
    const composition = buildComposition(env);
    expect(composition.onMessage).toBeInstanceOf(Function);
    expect(composition.readinessCheck).toBeInstanceOf(Function);
  });

  it("also wires the opt-in Mother's Day Edition (Pinecone recipe retrieval) without throwing when configured", () => {
    const composition = buildComposition({ ...env, PINECONE_INDEX_NAME: "recipes", PINECONE_API_KEY: "pc-test" });
    expect(composition.onMessage).toBeInstanceOf(Function);
  });
});
