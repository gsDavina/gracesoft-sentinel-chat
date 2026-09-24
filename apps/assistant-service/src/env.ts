import { z } from "zod";
import { channelEnvShape, refineChannelEnv } from "@gracesoft-sentinel/webhook-host";

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

    /** Every channel's flags and credentials — WhatsApp, Telegram, SMS, Slack, LINE and the two branded web chats; any number can be on at once. */
    ...channelEnvShape,
  })
  .superRefine((env, ctx) => {
    refineChannelEnv(env, ctx);
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
