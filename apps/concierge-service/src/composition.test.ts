import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANNELS_DISABLED } from "@gracesoft-sentinel/webhook-host";
import { buildComposition } from "./composition.js";
import type { ConciergeServiceEnv } from "./env.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Proves `concierge-service` actually wires up with every provider —
 * OpenAI, Google Calendar, Redis, Postgres — given valid-shaped
 * (not live) credentials. Construction itself never makes a network call
 * for any of these clients (auth happens lazily on first request), so this
 * is a legitimate no-live-credentials smoke test, not a mock of the wiring.
 */
describe("buildComposition — concierge-service", () => {
  const env: ConciergeServiceEnv = {
    PORT: 3000,
    OPENAI_API_KEY: "sk-test",
    OPENAI_MODEL: undefined,
    OPENAI_VISION_MODEL: undefined,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "svc@example.iam.gserviceaccount.com",
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
    REDIS_URL: "redis://localhost:6379",
    DATABASE_URL: "postgres://localhost:5432/db",
    BUSINESS_CONFIG_PATH: resolve(here, "../../../_internal-docs/data/business-config.example.json"),
    ...CHANNELS_DISABLED,
    WHATSAPP_ENABLED: false,
    TELEGRAM_ENABLED: true,
    TELEGRAM_BOT_TOKEN: "t",
    TELEGRAM_WEBHOOK_SECRET: "s",
  };

  it("wires OpenAI, Google Calendar, Redis, and Postgres without throwing, using the real example business config", () => {
    const composition = buildComposition(env);
    expect(composition.onMessage).toBeInstanceOf(Function);
    expect(composition.readinessCheck).toBeInstanceOf(Function);
  });

  it("throws a clear error when BUSINESS_CONFIG_PATH points at a nonexistent file", () => {
    expect(() => buildComposition({ ...env, BUSINESS_CONFIG_PATH: "./does-not-exist.json" })).toThrow();
  });

  describe("multi-tenant (BUSINESS_CONFIGS_DIR)", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "concierge-service-composition-test-"));
      mkdirSync(join(dir, "faq-blueprints"));
      const exampleConfig = JSON.parse(readFileSync(resolve(here, "../../../_internal-docs/data/business-config.example.json"), "utf-8"));
      const exampleFaq = readFileSync(resolve(here, "../../../_internal-docs/data/faq-blueprint.json"), "utf-8");
      writeFileSync(join(dir, "faq-blueprints", "biz-a.json"), exampleFaq);
      writeFileSync(
        join(dir, "1234567890.json"),
        JSON.stringify({ ...exampleConfig, businessId: "biz-a", faqBlueprintPath: "./faq-blueprints/biz-a.json" })
      );
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("wires up successfully from a directory of per-business config files instead of a single BUSINESS_CONFIG_PATH", () => {
      const { BUSINESS_CONFIG_PATH: _drop, ...rest } = env;
      const composition = buildComposition({ ...rest, BUSINESS_CONFIGS_DIR: dir });
      expect(composition.onMessage).toBeInstanceOf(Function);
    });
  });
});
