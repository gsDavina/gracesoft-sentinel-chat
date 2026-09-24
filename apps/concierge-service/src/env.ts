import { z } from "zod";
import { channelEnvShape, refineChannelEnv } from "@gracesoft-sentinel/webhook-host";

/**
 * Env validation via Zod, fails fast at startup with a clear error rather
 * than surfacing a confusing failure deep in a request handler later.
 */
export const ConciergeServiceEnvSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),

    OPENAI_API_KEY: z.string().min(1),
    OPENAI_MODEL: z.string().optional(),
    OPENAI_VISION_MODEL: z.string().optional(),

    GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().min(1),
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().min(1),

    REDIS_URL: z.string().min(1),
    DATABASE_URL: z.string().min(1),

    /** Single-tenant mode: path to a JSON file matching core's BusinessConfigSchema. */
    BUSINESS_CONFIG_PATH: z.string().min(1).optional(),
    /**
     * Multi-tenant mode: a directory of BusinessConfig JSON files, one per
     * business, each named `<businessChannelId>.json` (the WhatsApp
     * `phone_number_id` or Twilio `To` number that routes to that business —
     * see `NormalizedMessage.businessChannelId`). Takes precedence over
     * BUSINESS_CONFIG_PATH when both are set.
     */
    BUSINESS_CONFIGS_DIR: z.string().min(1).optional(),

    /**
     * Deployment-wide fallback for `BusinessConfig.maxBookingHorizonDays` —
     * applied only to a business config that doesn't set its own value, so
     * ops can cap how far ahead bookings/reschedules can go without editing
     * every tenant's JSON file individually. Unset means no deployment-wide
     * default; a business can still set its own regardless.
     */
    DEFAULT_MAX_BOOKING_HORIZON_DAYS: z.coerce.number().int().positive().optional(),

    /** Every channel's flags and credentials — WhatsApp, Telegram, SMS, Slack, LINE and the two branded web chats; any number can be on at once. */
    ...channelEnvShape,
  })
  .superRefine((env, ctx) => {
    refineChannelEnv(env, ctx);
    if (!env.BUSINESS_CONFIG_PATH && !env.BUSINESS_CONFIGS_DIR) {
      ctx.addIssue({
        code: "custom",
        path: ["BUSINESS_CONFIG_PATH"],
        message: "At least one of BUSINESS_CONFIG_PATH or BUSINESS_CONFIGS_DIR must be set",
      });
    }
  });

export type ConciergeServiceEnv = z.infer<typeof ConciergeServiceEnvSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): ConciergeServiceEnv {
  const result = ConciergeServiceEnvSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid concierge-service environment configuration:\n${issues}`);
  }
  return result.data;
}
