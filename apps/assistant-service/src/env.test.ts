import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const VALID_STRUCTURED_ENV = {
  OPENAI_API_KEY: "sk-test",
  SNAPSHOT_DIR: "/tmp/snapshot",
  TELEGRAM_ENABLED: "true",
  TELEGRAM_BOT_TOKEN: "t",
  TELEGRAM_WEBHOOK_SECRET: "s",
} as NodeJS.ProcessEnv;

describe("loadEnv — structured mode (default)", () => {
  it("loads valid config with defaults filled in", () => {
    const env = loadEnv(VALID_STRUCTURED_ENV);
    expect(env).toMatchObject({ PORT: 3004, OPENAI_MODEL: "gpt-4o-mini", AS_OF_DATE: "2026-09-10", MAX_TOOL_STEPS: 6 });
  });

  it("fails with the missing key named", () => {
    expect(() => loadEnv({ TELEGRAM_ENABLED: "true", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_WEBHOOK_SECRET: "s" } as NodeJS.ProcessEnv)).toThrowError(/OPENAI_API_KEY/);
  });

  it("requires SNAPSHOT_DIR unless PINECONE_INDEX_NAME is set", () => {
    expect(() => loadEnv({ OPENAI_API_KEY: "sk", TELEGRAM_ENABLED: "true", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_WEBHOOK_SECRET: "s" } as NodeJS.ProcessEnv)).toThrowError(/SNAPSHOT_DIR/);
  });

  it("requires at least one of WHATSAPP_ENABLED or TELEGRAM_ENABLED", () => {
    expect(() => loadEnv({ OPENAI_API_KEY: "sk", SNAPSHOT_DIR: "/tmp" } as NodeJS.ProcessEnv)).toThrowError(/WHATSAPP_ENABLED or TELEGRAM_ENABLED/);
  });

  it("requires TELEGRAM_BOT_TOKEN/TELEGRAM_WEBHOOK_SECRET when TELEGRAM_ENABLED=true", () => {
    expect(() => loadEnv({ OPENAI_API_KEY: "sk", SNAPSHOT_DIR: "/tmp", TELEGRAM_ENABLED: "true" } as NodeJS.ProcessEnv)).toThrow();
  });

  it('respects an explicit WHATSAPP_ENABLED=false (regression: z.coerce.boolean() would treat the string "false" as true)', () => {
    const env = loadEnv({ ...VALID_STRUCTURED_ENV, WHATSAPP_ENABLED: "false" } as NodeJS.ProcessEnv);
    expect(env.WHATSAPP_ENABLED).toBe(false);
  });
});

describe("loadEnv — Pinecone-search mode", () => {
  const VALID_PINECONE_ENV = {
    OPENAI_API_KEY: "sk-test",
    PINECONE_API_KEY: "pc-test",
    PINECONE_INDEX_NAME: "desk-skylight",
    TELEGRAM_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: "t",
    TELEGRAM_WEBHOOK_SECRET: "s",
  } as NodeJS.ProcessEnv;

  it("loads without SNAPSHOT_DIR when PINECONE_INDEX_NAME is set", () => {
    const env = loadEnv(VALID_PINECONE_ENV);
    expect(env.PINECONE_INDEX_NAME).toBe("desk-skylight");
    expect(env.SNAPSHOT_DIR).toBeUndefined();
  });

  it("requires PINECONE_API_KEY when PINECONE_INDEX_NAME is set", () => {
    expect(() => loadEnv({ ...VALID_PINECONE_ENV, PINECONE_API_KEY: undefined } as NodeJS.ProcessEnv)).toThrowError(/PINECONE_API_KEY/);
  });
});
