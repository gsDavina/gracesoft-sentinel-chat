import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const BASE_ENV = {
  OPENAI_API_KEY: "sk-test",
  REDIS_URL: "redis://localhost:6379",
  DATABASE_URL: "postgres://localhost:5432/db",
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
    expect(env.PORT).toBe(3001);
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
});
