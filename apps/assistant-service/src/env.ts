import { z } from "zod";

/**
 * `z.coerce.boolean()` is just `Boolean(value)` under the hood — for a
 * string env var, that makes the literal string "false" coerce to `true`
 * (any non-empty string is truthy), silently ignoring an explicit
 * WHATSAPP_ENABLED=false. Parse the two expected string values explicitly
 * instead, so a real "false" is actually respected and anything else is a
 * clear validation error rather than a silent yes. Same pattern as
 * cook-service's/concierge-service's/demo-service's own env.ts.
 */
const booleanFromEnvString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

export const AssistantServiceEnvSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3004),

    OPENAI_API_KEY: z.string().min(1),
    OPENAI_MODEL: z.string().default("gpt-4o-mini"),

    /**
     * Structured mode (default): a directory of snapshot JSON tables,
     * queried deterministically — see packages/agent-assistant/data/snapshot/valid
     * for the shape. Required unless PINECONE_INDEX_NAME is set.
     */
    SNAPSHOT_DIR: z.string().optional(),
    AS_OF_DATE: z.string().date().default("2026-09-10"),

    /**
     * Pinecone-search mode: swaps the structured query layer for semantic
     * search over an existing MySQL→Pinecone index (see
     * packages/ingest-mysql-pinecone). Unset by default; when
     * PINECONE_INDEX_NAME is set, PINECONE_API_KEY becomes required too,
     * and SNAPSHOT_DIR/AS_OF_DATE are ignored.
     */
    PINECONE_API_KEY: z.string().optional(),
    PINECONE_INDEX_NAME: z.string().optional(),
    /** Keeps this index isolated from anything else sharing the same Pinecone project — recommended, not required. */
    PINECONE_NAMESPACE: z.string().optional(),

    MAX_TOOL_STEPS: z.coerce.number().int().positive().default(6),
    MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    MAX_TOKENS_PER_REQUEST: z.coerce.number().int().positive().default(1024),
    /** A proxy for spend, not real token-cost accounting (AIProvider exposes no usage/pricing) — a simple per-day cap on model calls, documented as an approximation. */
    DAILY_MODEL_CALL_CAP: z.coerce.number().int().positive().default(500),
    /** Per-chatter flood floor, in-memory (no Redis dependency for this service) — see session-rate-limiter.ts. */
    RATE_LIMIT_PER_CHATTER_PER_MINUTE: z.coerce.number().int().positive().default(10),

    WHATSAPP_ENABLED: booleanFromEnvString,
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),

    TELEGRAM_ENABLED: booleanFromEnvString,
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.WHATSAPP_ENABLED) {
      for (const key of ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when WHATSAPP_ENABLED=true` });
      }
    }
    if (env.TELEGRAM_ENABLED) {
      for (const key of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when TELEGRAM_ENABLED=true` });
      }
    }
    if (!env.WHATSAPP_ENABLED && !env.TELEGRAM_ENABLED) {
      ctx.addIssue({ code: "custom", path: ["WHATSAPP_ENABLED"], message: "At least one of WHATSAPP_ENABLED or TELEGRAM_ENABLED must be true" });
    }
    if (env.PINECONE_INDEX_NAME && !env.PINECONE_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["PINECONE_API_KEY"], message: "PINECONE_API_KEY is required when PINECONE_INDEX_NAME is set" });
    }
    if (!env.PINECONE_INDEX_NAME && !env.SNAPSHOT_DIR) {
      ctx.addIssue({ code: "custom", path: ["SNAPSHOT_DIR"], message: "SNAPSHOT_DIR is required unless PINECONE_INDEX_NAME is set" });
    }
  });

export type AssistantServiceEnv = z.infer<typeof AssistantServiceEnvSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AssistantServiceEnv {
  const result = AssistantServiceEnvSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid assistant-service environment configuration:\n${issues}`);
  }
  return result.data;
}
