import { z } from "zod";

/**
 * `z.coerce.boolean()` is just `Boolean(value)` under the hood — for a
 * string env var, that makes the literal string "false" coerce to `true`.
 * Parse the two expected string values explicitly instead, so a real
 * "false" is respected and anything else is a clear validation error.
 */
export const booleanFromEnvString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

/**
 * `KEY=` in a `.env` file arrives as "" — treat that as unset, or a copied
 * `.env.example` would fail `min(8)`/`url()` checks on values nobody set,
 * and an empty copy override would blank the chat header.
 */
function optionalNonEmpty<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

/**
 * Every channel's env vars, in one place, so each service's own `env.ts`
 * spreads this into its schema instead of re-declaring (and drifting on)
 * the same WhatsApp/Telegram block four times. Each channel is off unless
 * its `*_ENABLED` flag is "true"; any number can be on at once.
 */
export const channelEnvShape = {
  WHATSAPP_ENABLED: booleanFromEnvString,
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),

  TELEGRAM_ENABLED: booleanFromEnvString,
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  SMS_ENABLED: booleanFromEnvString,
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  /** The exact public URL configured in Twilio — its signature covers it, so it can't be inferred behind a proxy. */
  SMS_WEBHOOK_URL: optionalNonEmpty(z.string().url()),

  SLACK_ENABLED: booleanFromEnvString,
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),

  LINE_ENABLED: booleanFromEnvString,
  LINE_CHANNEL_ACCESS_TOKEN: z.string().optional(),
  LINE_CHANNEL_SECRET: z.string().optional(),

  WEB_GRACESOFT_ENABLED: booleanFromEnvString,
  WEB_DAVDEVS_ENABLED: booleanFromEnvString,
  /** Shared access code for both web chats. Strongly recommended for anything internet-facing — see web-chat-kit. */
  WEB_CHAT_ACCESS_TOKEN: optionalNonEmpty(z.string().min(8, "WEB_CHAT_ACCESS_TOKEN must be at least 8 characters")),
  /** Optional per-deployment copy for the web chats' header/welcome, e.g. "Sentinel Cook". */
  WEB_CHAT_PRODUCT_NAME: optionalNonEmpty(z.string()),
  WEB_CHAT_WELCOME_MESSAGE: optionalNonEmpty(z.string()),
};

export type ChannelEnv = z.infer<z.ZodObject<typeof channelEnvShape>>;

const REQUIRED_WHEN_ENABLED: { flag: keyof ChannelEnv; keys: (keyof ChannelEnv)[] }[] = [
  { flag: "WHATSAPP_ENABLED", keys: ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN"] },
  { flag: "TELEGRAM_ENABLED", keys: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"] },
  { flag: "SMS_ENABLED", keys: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "SMS_WEBHOOK_URL"] },
  { flag: "SLACK_ENABLED", keys: ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"] },
  { flag: "LINE_ENABLED", keys: ["LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET"] },
];

export const CHANNEL_FLAGS = [
  "WHATSAPP_ENABLED",
  "TELEGRAM_ENABLED",
  "SMS_ENABLED",
  "SLACK_ENABLED",
  "LINE_ENABLED",
  "WEB_GRACESOFT_ENABLED",
  "WEB_DAVDEVS_ENABLED",
] as const satisfies readonly (keyof ChannelEnv)[];

/**
 * Every channel off — a convenient base for a service's own test fixtures,
 * which then switch on just the channel under test.
 */
export const CHANNELS_DISABLED: Pick<ChannelEnv, (typeof CHANNEL_FLAGS)[number]> = {
  WHATSAPP_ENABLED: false,
  TELEGRAM_ENABLED: false,
  SMS_ENABLED: false,
  SLACK_ENABLED: false,
  LINE_ENABLED: false,
  WEB_GRACESOFT_ENABLED: false,
  WEB_DAVDEVS_ENABLED: false,
};

/**
 * Cross-field checks for `channelEnvShape`, for a service's own
 * `superRefine`: every enabled channel has its credentials, and at least
 * one channel is enabled (a service with no way in is a misconfiguration,
 * not a valid deployment).
 */
export function refineChannelEnv(env: ChannelEnv, ctx: z.RefinementCtx): void {
  for (const { flag, keys } of REQUIRED_WHEN_ENABLED) {
    if (!env[flag]) continue;
    for (const key of keys) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when ${flag}=true` });
    }
  }
  if (!CHANNEL_FLAGS.some((flag) => env[flag])) {
    ctx.addIssue({ code: "custom", path: ["WHATSAPP_ENABLED"], message: `At least one channel must be enabled (${CHANNEL_FLAGS.join(", ")})` });
  }
}
