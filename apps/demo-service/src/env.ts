import { z } from "zod";
import { booleanFromEnvString, channelEnvShape, refineChannelEnv } from "@gracesoft-sentinel/webhook-host";

/**
 * demo-service is deliberately single-tenant, single-business-config only
 * (no BUSINESS_CONFIGS_DIR multi-tenant mode) — its whole purpose is
 * demoing Concierge and Cook side by side in one chat window, not serving
 * real multi-business traffic.
 */
export const DemoServiceEnvSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3003),

    OPENAI_API_KEY: z.string().min(1),
    OPENAI_MODEL: z.string().optional(),
    OPENAI_VISION_MODEL: z.string().optional(),

    GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().min(1),
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().min(1),

    REDIS_URL: z.string().min(1),
    DATABASE_URL: z.string().min(1),

    /** Path to a JSON file matching core's BusinessConfigSchema — used for the Concierge half only. */
    BUSINESS_CONFIG_PATH: z.string().min(1),

    /** Which agent a chatter talks to before ever explicitly switching. */
    DEMO_DEFAULT_AGENT: z.enum(["concierge", "cook", "assistant"]).default("concierge"),

    /**
     * GraceSoft Assistant (feature-flagged, off by default) — a third agent
     * demoing Q&A over a redacted GraceSoft Desk/Skylight snapshot,
     * alongside Concierge and Cook. Unset/false leaves demo-service exactly
     * as it was before this agent existed: no route, no config requirement,
     * nothing registered with the switcher.
     */
    ASSISTANT_ENABLED: booleanFromEnvString,
    /** Structured mode (default): required unless ASSISTANT_PINECONE_INDEX_NAME is set. */
    ASSISTANT_SNAPSHOT_DIR: z.string().optional(),
    ASSISTANT_AS_OF_DATE: z.string().date().default("2026-09-10"),
    ASSISTANT_MAX_TOOL_STEPS: z.coerce.number().int().positive().default(6),
    ASSISTANT_MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    ASSISTANT_MAX_TOKENS_PER_REQUEST: z.coerce.number().int().positive().default(1024),

    /**
     * Pinecone-search mode for the Assistant: swaps its structured query
     * layer for semantic search over an existing MySQL→Pinecone index (see
     * packages/ingest-mysql-pinecone) instead of ASSISTANT_SNAPSHOT_DIR.
     * Deliberately separate from the PINECONE_* vars below (Cook's own,
     * unrelated recipe index) — different index/namespace, never conflated.
     */
    ASSISTANT_PINECONE_API_KEY: z.string().optional(),
    ASSISTANT_PINECONE_INDEX_NAME: z.string().optional(),
    ASSISTANT_PINECONE_NAMESPACE: z.string().optional(),

    /**
     * "Mother's Day Edition" (opt-in): personal recipe retrieval via RAG,
     * queried from a Pinecone index, for the Cook half. This service only
     * queries the index — it's populated ahead of time by
     * `provider-recipe-pinecone`'s own Drive→Pinecone sync job, run
     * out-of-band. Unset by default; when PINECONE_INDEX_NAME is set,
     * PINECONE_API_KEY becomes required too.
     */
    PINECONE_API_KEY: z.string().optional(),
    PINECONE_INDEX_NAME: z.string().optional(),
    /** Keeps recipe vectors isolated from anything else sharing the same index — recommended, not required. */
    PINECONE_NAMESPACE: z.string().optional(),

    /** Every channel's flags and credentials — WhatsApp, Telegram, SMS, Slack, LINE and the two branded web chats; any number can be on at once. */
    ...channelEnvShape,
  })
  .superRefine((env, ctx) => {
    refineChannelEnv(env, ctx);
    if (env.PINECONE_INDEX_NAME && !env.PINECONE_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["PINECONE_API_KEY"], message: "PINECONE_API_KEY is required when PINECONE_INDEX_NAME is set" });
    }
    if (env.ASSISTANT_ENABLED && !env.ASSISTANT_SNAPSHOT_DIR && !env.ASSISTANT_PINECONE_INDEX_NAME) {
      ctx.addIssue({ code: "custom", path: ["ASSISTANT_SNAPSHOT_DIR"], message: "ASSISTANT_SNAPSHOT_DIR is required when ASSISTANT_ENABLED=true, unless ASSISTANT_PINECONE_INDEX_NAME is set" });
    }
    if (env.ASSISTANT_PINECONE_INDEX_NAME && !env.ASSISTANT_PINECONE_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["ASSISTANT_PINECONE_API_KEY"], message: "ASSISTANT_PINECONE_API_KEY is required when ASSISTANT_PINECONE_INDEX_NAME is set" });
    }
    if (env.DEMO_DEFAULT_AGENT === "assistant" && !env.ASSISTANT_ENABLED) {
      ctx.addIssue({ code: "custom", path: ["DEMO_DEFAULT_AGENT"], message: "DEMO_DEFAULT_AGENT can't be \"assistant\" unless ASSISTANT_ENABLED=true" });
    }
  });

export type DemoServiceEnv = z.infer<typeof DemoServiceEnvSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): DemoServiceEnv {
  const result = DemoServiceEnvSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid demo-service environment configuration:\n${issues}`);
  }
  return result.data;
}
