import { z } from "zod";

export const AssistantServiceEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3004),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),

  SNAPSHOT_DIR: z.string().min(1),
  AS_OF_DATE: z.string().date().default("2026-09-10"),

  /** Bearer token gating every /chat and /sessions call — the milestone doc's open question #5 ("public link with a token"), resolved as the default for a demo deployment. */
  DEMO_TOKEN: z.string().min(1),

  MAX_TOOL_STEPS: z.coerce.number().int().positive().default(6),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  MAX_TOKENS_PER_REQUEST: z.coerce.number().int().positive().default(1024),

  RATE_LIMIT_PER_IP_PER_MINUTE: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_PER_SESSION_PER_MINUTE: z.coerce.number().int().positive().default(10),
  /** A proxy for spend, not real token-cost accounting (AIProvider doesn't expose usage/pricing) — a simple per-day cap on model calls, documented as an approximation. */
  DAILY_MODEL_CALL_CAP: z.coerce.number().int().positive().default(500),
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
