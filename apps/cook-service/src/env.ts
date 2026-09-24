import { z } from "zod";
import { channelEnvShape, refineChannelEnv } from "@gracesoft-sentinel/webhook-host";

export const CookServiceEnvSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3001),

    OPENAI_API_KEY: z.string().min(1),
    OPENAI_MODEL: z.string().optional(),
    OPENAI_VISION_MODEL: z.string().optional(),

    REDIS_URL: z.string().min(1),
    DATABASE_URL: z.string().min(1),

    /**
     * "Mother's Day Edition" (Milestone 11), fully opt-in — personal recipe
     * retrieval via RAG, queried from a Pinecone index at chat time
     * (populated ahead of time by `provider-recipe-pinecone`'s Drive→Pinecone
     * sync job, run out-of-band — not by this service). Unset by default;
     * when PINECONE_INDEX_NAME is set, PINECONE_API_KEY becomes required too.
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
  });

export type CookServiceEnv = z.infer<typeof CookServiceEnvSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): CookServiceEnv {
  const result = CookServiceEnvSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid cook-service environment configuration:\n${issues}`);
  }
  return result.data;
}
