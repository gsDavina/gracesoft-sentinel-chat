import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const BASE_ENV = {
  OPENAI_API_KEY: "sk-test",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "svc@example.iam.gserviceaccount.com",
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "key",
  REDIS_URL: "redis://localhost:6379",
  DATABASE_URL: "postgres://localhost:5432/db",
  BUSINESS_CONFIG_PATH: "./business-config.json",
};

describe("loadEnv", () => {
  it("loads successfully with WhatsApp enabled and its required vars present", () => {
    const env = loadEnv({
      ...BASE_ENV,
      WHATSAPP_ENABLED: "true",
      WHATSAPP_PHONE_NUMBER_ID: "1",
      WHATSAPP_ACCESS_TOKEN: "t",
      WHATSAPP_APP_SECRET: "s",
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "v",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.WHATSAPP_ENABLED).toBe(true);
    expect(env.PORT).toBe(3000);
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

  it("throws when TELEGRAM_ENABLED is true but its required vars are missing", () => {
    expect(() => loadEnv({ ...BASE_ENV, TELEGRAM_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toThrow(
      /TELEGRAM_BOT_TOKEN is required/
    );
  });

  it("throws when a base required var (e.g. OPENAI_API_KEY) is missing", () => {
    const { OPENAI_API_KEY: _drop, ...rest } = BASE_ENV;
    expect(() =>
      loadEnv({ ...rest, TELEGRAM_ENABLED: "true", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_WEBHOOK_SECRET: "s" } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/Invalid concierge-service environment configuration/);
  });

  it("throws when neither BUSINESS_CONFIG_PATH nor BUSINESS_CONFIGS_DIR is set", () => {
    const { BUSINESS_CONFIG_PATH: _drop, ...rest } = BASE_ENV;
    expect(() =>
      loadEnv({ ...rest, TELEGRAM_ENABLED: "true", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_WEBHOOK_SECRET: "s" } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/BUSINESS_CONFIG_PATH or BUSINESS_CONFIGS_DIR/);
  });

  it("loads successfully with only BUSINESS_CONFIGS_DIR set (multi-tenant mode)", () => {
    const { BUSINESS_CONFIG_PATH: _drop, ...rest } = BASE_ENV;
    const env = loadEnv({
      ...rest,
      BUSINESS_CONFIGS_DIR: "./business-configs",
      TELEGRAM_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_WEBHOOK_SECRET: "s",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.BUSINESS_CONFIGS_DIR).toBe("./business-configs");
  });

  it("respects a custom PORT", () => {
    const env = loadEnv({
      ...BASE_ENV,
      PORT: "8080",
      TELEGRAM_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_WEBHOOK_SECRET: "s",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(8080);
  });
});
