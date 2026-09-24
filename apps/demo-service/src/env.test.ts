import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const BASE_ENV = {
  OPENAI_API_KEY: "sk-test",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "svc@example.iam.gserviceaccount.com",
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
  REDIS_URL: "redis://localhost:6379",
  DATABASE_URL: "postgres://localhost:5432/db",
  BUSINESS_CONFIG_PATH: "./business-config.json",
};

describe("loadEnv", () => {
  it("loads successfully with Telegram enabled and its required vars present", () => {
    const env = loadEnv({
      ...BASE_ENV,
      TELEGRAM_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_WEBHOOK_SECRET: "s",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.TELEGRAM_ENABLED).toBe(true);
    expect(env.PORT).toBe(3003);
  });

  it("defaults DEMO_DEFAULT_AGENT to concierge when unset", () => {
    const env = loadEnv({
      ...BASE_ENV,
      TELEGRAM_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_WEBHOOK_SECRET: "s",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.DEMO_DEFAULT_AGENT).toBe("concierge");
  });

  it("respects an explicit DEMO_DEFAULT_AGENT=cook", () => {
    const env = loadEnv({
      ...BASE_ENV,
      TELEGRAM_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_WEBHOOK_SECRET: "s",
      DEMO_DEFAULT_AGENT: "cook",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.DEMO_DEFAULT_AGENT).toBe("cook");
  });

  it("rejects an invalid DEMO_DEFAULT_AGENT value", () => {
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        TELEGRAM_ENABLED: "true",
        TELEGRAM_BOT_TOKEN: "t",
        TELEGRAM_WEBHOOK_SECRET: "s",
        DEMO_DEFAULT_AGENT: "not-a-real-agent",
      } as unknown as NodeJS.ProcessEnv)
    ).toThrow();
  });

  it("respects an explicit WHATSAPP_ENABLED=false (regression: z.coerce.boolean() would treat the string \"false\" as true)", () => {
    const env = loadEnv({
      ...BASE_ENV,
      WHATSAPP_ENABLED: "false",
      TELEGRAM_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_WEBHOOK_SECRET: "s",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.WHATSAPP_ENABLED).toBe(false);
  });

  it("throws when no channel is enabled", () => {
    expect(() => loadEnv({ ...BASE_ENV } as unknown as NodeJS.ProcessEnv)).toThrow(/At least one channel must be enabled/);
  });

  it("throws when WHATSAPP_ENABLED is true but its required vars are missing", () => {
    expect(() => loadEnv({ ...BASE_ENV, WHATSAPP_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toThrow(
      /WHATSAPP_PHONE_NUMBER_ID is required/
    );
  });

  it("throws when BUSINESS_CONFIG_PATH is missing", () => {
    const { BUSINESS_CONFIG_PATH: _drop, ...rest } = BASE_ENV;
    expect(() =>
      loadEnv({ ...rest, TELEGRAM_ENABLED: "true", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_WEBHOOK_SECRET: "s" } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/BUSINESS_CONFIG_PATH/);
  });

  it("throws when PINECONE_INDEX_NAME is set but PINECONE_API_KEY is missing", () => {
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        TELEGRAM_ENABLED: "true",
        TELEGRAM_BOT_TOKEN: "t",
        TELEGRAM_WEBHOOK_SECRET: "s",
        PINECONE_INDEX_NAME: "recipes",
      } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/PINECONE_API_KEY is required/);
  });

  it("loads successfully with the Mother's Day Edition fully configured", () => {
    const env = loadEnv({
      ...BASE_ENV,
      TELEGRAM_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_WEBHOOK_SECRET: "s",
      PINECONE_INDEX_NAME: "recipes",
      PINECONE_API_KEY: "pc-test",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.PINECONE_INDEX_NAME).toBe("recipes");
  });

  it("throws when ASSISTANT_ENABLED is true but neither ASSISTANT_SNAPSHOT_DIR nor ASSISTANT_PINECONE_INDEX_NAME is set", () => {
    expect(() =>
      loadEnv({ ...BASE_ENV, TELEGRAM_ENABLED: "true", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_WEBHOOK_SECRET: "s", ASSISTANT_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/ASSISTANT_SNAPSHOT_DIR/);
  });

  it("throws when ASSISTANT_PINECONE_INDEX_NAME is set but ASSISTANT_PINECONE_API_KEY is missing", () => {
    expect(() =>
      loadEnv({
        ...BASE_ENV,
        TELEGRAM_ENABLED: "true",
        TELEGRAM_BOT_TOKEN: "t",
        TELEGRAM_WEBHOOK_SECRET: "s",
        ASSISTANT_ENABLED: "true",
        ASSISTANT_PINECONE_INDEX_NAME: "desk-skylight",
      } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/ASSISTANT_PINECONE_API_KEY is required/);
  });

  it("loads successfully with the Assistant in Pinecone-search mode, and no ASSISTANT_SNAPSHOT_DIR needed", () => {
    const env = loadEnv({
      ...BASE_ENV,
      TELEGRAM_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_WEBHOOK_SECRET: "s",
      ASSISTANT_ENABLED: "true",
      ASSISTANT_PINECONE_INDEX_NAME: "desk-skylight",
      ASSISTANT_PINECONE_API_KEY: "pc-test",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.ASSISTANT_PINECONE_INDEX_NAME).toBe("desk-skylight");
    expect(env.ASSISTANT_SNAPSHOT_DIR).toBeUndefined();
  });
});
