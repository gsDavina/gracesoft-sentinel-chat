import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHANNELS_DISABLED } from "@gracesoft-sentinel/webhook-host";
import { buildComposition } from "./composition.js";
import type { DemoServiceEnv } from "./env.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Proves demo-service actually wires OpenAI, Google Calendar, Redis, and
 * Postgres — for *both* halves it composes — given valid-shaped (not live)
 * credentials. Construction never makes a network call for any of these
 * clients, same as concierge-service's/cook-service's own equivalent tests.
 */
describe("buildComposition — demo-service", () => {
  const env: DemoServiceEnv = {
    PORT: 3003,
    OPENAI_API_KEY: "sk-test",
    OPENAI_MODEL: undefined,
    OPENAI_VISION_MODEL: undefined,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "svc@example.iam.gserviceaccount.com",
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
    REDIS_URL: "redis://localhost:6379",
    DATABASE_URL: "postgres://localhost:5432/db",
    BUSINESS_CONFIG_PATH: resolve(here, "../../../_internal-docs/data/business-config.example.json"),
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

  it("wires OpenAI, Google Calendar, Redis, and Postgres for both Concierge and Cook without throwing", () => {
    const composition = buildComposition(env);
    expect(composition.onMessage).toBeInstanceOf(Function);
    expect(composition.readinessCheck).toBeInstanceOf(Function);
  });

  it("throws a clear error when BUSINESS_CONFIG_PATH points at a nonexistent file", () => {
    expect(() => buildComposition({ ...env, BUSINESS_CONFIG_PATH: "./does-not-exist.json" })).toThrow();
  });

  it("also wires the opt-in Mother's Day Edition (Pinecone recipe retrieval) without throwing when configured", () => {
    const composition = buildComposition({ ...env, PINECONE_INDEX_NAME: "recipes", PINECONE_API_KEY: "pc-test" });
    expect(composition.onMessage).toBeInstanceOf(Function);
  });

  it("also wires the opt-in GraceSoft Assistant without throwing when ASSISTANT_ENABLED=true", () => {
    const composition = buildComposition({
      ...env,
      ASSISTANT_ENABLED: true,
      ASSISTANT_SNAPSHOT_DIR: resolve(here, "../../../packages/agent-assistant/data/snapshot/valid"),
    });
    expect(composition.onMessage).toBeInstanceOf(Function);
  });

  it("throws (fails boot) when ASSISTANT_ENABLED=true but the snapshot directory is invalid", () => {
    expect(() => buildComposition({ ...env, ASSISTANT_ENABLED: true, ASSISTANT_SNAPSHOT_DIR: "./does-not-exist" })).toThrow();
  });

  it("wires the Assistant in Pinecone-search mode without loading a snapshot when ASSISTANT_PINECONE_INDEX_NAME is set", () => {
    const composition = buildComposition({
      ...env,
      ASSISTANT_ENABLED: true,
      ASSISTANT_SNAPSHOT_DIR: undefined,
      ASSISTANT_PINECONE_API_KEY: "pc-test",
      ASSISTANT_PINECONE_INDEX_NAME: "desk-skylight",
      ASSISTANT_PINECONE_NAMESPACE: "desk-skylight",
    });
    expect(composition.onMessage).toBeInstanceOf(Function);
  });
});
