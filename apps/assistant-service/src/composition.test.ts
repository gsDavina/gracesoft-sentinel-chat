import { describe, expect, it } from "vitest";
import { buildComposition } from "./composition.js";
import type { AssistantServiceEnv } from "./env.js";
import { FIXTURE_SNAPSHOT_DIR } from "./test-support.js";

const BASE_ENV: AssistantServiceEnv = {
  PORT: 0,
  OPENAI_API_KEY: "sk-test",
  OPENAI_MODEL: "gpt-4o-mini",
  SNAPSHOT_DIR: FIXTURE_SNAPSHOT_DIR,
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

describe("buildComposition — structured mode", () => {
  it("wires an onMessage handler from a valid snapshot without throwing", () => {
    const composition = buildComposition(BASE_ENV);
    expect(composition.onMessage).toBeInstanceOf(Function);
    expect(composition.aiProvider).toBeDefined();
  });

  it("throws (fails fast) when the snapshot directory is invalid", () => {
    expect(() => buildComposition({ ...BASE_ENV, SNAPSHOT_DIR: "/no/such/dir" })).toThrow();
  });
});

describe("buildComposition — Pinecone-search mode", () => {
  it("wires an onMessage handler when PINECONE_INDEX_NAME is set, without loading a snapshot", () => {
    const composition = buildComposition({ ...BASE_ENV, SNAPSHOT_DIR: undefined, PINECONE_API_KEY: "pc-test", PINECONE_INDEX_NAME: "desk-skylight", PINECONE_NAMESPACE: "desk-skylight" });
    expect(composition.onMessage).toBeInstanceOf(Function);
  });
});
