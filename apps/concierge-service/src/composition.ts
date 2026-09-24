import { OpenAIProvider } from "@gracesoft-sentinel/provider-ai-openai";
import { GoogleCalendarProvider, createGoogleCalendarClient, type GoogleCalendarClient } from "@gracesoft-sentinel/provider-calendar-google";
import { RedisRateLimiter, RedisSessionStore, createRedisClient } from "@gracesoft-sentinel/provider-session-redis";
import { PostgresConversationLogger, createPgClient } from "@gracesoft-sentinel/logging-postgres";
import { createLogger, type Logger } from "@gracesoft-sentinel/logging";
import type { NormalizedMessage, NormalizedResponse } from "@gracesoft-sentinel/core";
import { loadBusinessConfig, loadBusinessConfigRegistry, loadFaqBlueprint, withDefaultMaxBookingHorizon } from "./business-config-loader.js";
import { conversationLogEraser, sessionStoreEraser, withUserDataDeletion } from "@gracesoft-sentinel/user-data-deletion";
import { createOnMessageHandler, sessionIdFor, type TenantContext } from "./on-message.js";
import type { ConciergeServiceEnv } from "./env.js";

/**
 * Builds the per-message tenant lookup. Multi-tenant (`BUSINESS_CONFIGS_DIR`
 * set) builds a `TenantContext` per business, all sharing one
 * `GoogleCalendarClient` (the calendar API doesn't care which business a
 * request is for — only `calendarId` and `businessHours`, both already
 * per-`BusinessConfig`, do). Single-tenant mode (`BUSINESS_CONFIG_PATH`)
 * always resolves to the same one config regardless of `businessChannelId`,
 * preserving the pre-multi-tenancy behavior.
 */
function buildTenantResolver(env: ConciergeServiceEnv, calendarClient: GoogleCalendarClient): (message: NormalizedMessage) => TenantContext | undefined {
  if (env.BUSINESS_CONFIGS_DIR) {
    const registry = loadBusinessConfigRegistry(env.BUSINESS_CONFIGS_DIR);
    const tenants = new Map<string, TenantContext>();
    for (const [businessChannelId, { businessConfig: rawBusinessConfig, faqBlueprint }] of registry) {
      const businessConfig = withDefaultMaxBookingHorizon(rawBusinessConfig, env.DEFAULT_MAX_BOOKING_HORIZON_DAYS);
      tenants.set(businessChannelId, {
        businessConfig,
        faqBlueprint,
        calendarProvider: new GoogleCalendarProvider({ client: calendarClient, businessHours: businessConfig.businessHours }),
      });
    }
    return (message) => (message.businessChannelId ? tenants.get(message.businessChannelId) : undefined);
  }

  const businessConfig = withDefaultMaxBookingHorizon(loadBusinessConfig(env.BUSINESS_CONFIG_PATH!), env.DEFAULT_MAX_BOOKING_HORIZON_DAYS);
  const faqBlueprint = loadFaqBlueprint(env.BUSINESS_CONFIG_PATH!, businessConfig);
  const tenant: TenantContext = {
    businessConfig,
    faqBlueprint,
    calendarProvider: new GoogleCalendarProvider({ client: calendarClient, businessHours: businessConfig.businessHours }),
  };
  return () => tenant;
}

export interface Composition {
  onMessage: (message: NormalizedMessage) => Promise<NormalizedResponse>;
  readinessCheck: () => Promise<boolean>;
  appLogger: Logger;
}

/** The composition root: wires agent-concierge to every provider and persistence layer, purely from env. */
export function buildComposition(env: ConciergeServiceEnv): Composition {
  const appLogger = createLogger("concierge-service");

  const aiProvider = new OpenAIProvider({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    visionModel: env.OPENAI_VISION_MODEL,
  });

  const calendarClient = createGoogleCalendarClient({
    serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  });
  const resolveTenant = buildTenantResolver(env, calendarClient);

  const redisClient = createRedisClient(env.REDIS_URL);
  const sessionStore = new RedisSessionStore({ client: redisClient });
  // 20 messages/minute per chatter — generous for a real conversation
  // (including a multi-turn booking flow), tight enough to blunt a flood.
  const rateLimiter = new RedisRateLimiter({ client: redisClient, limit: 20, windowSeconds: 60 });

  const pgClient = createPgClient(env.DATABASE_URL);
  const conversationLogger = new PostgresConversationLogger({ client: pgClient });

  const conciergeOnMessage = createOnMessageHandler({
    resolveTenant,
    aiProvider,
    sessionStore,
    conversationLogger,
    appLogger,
    rateLimiter,
  });
  // Outermost, so the command never reaches the agent or the log it erases.
  // Scoped per tenant, like the session key itself: deleting your data with
  // one business on a multi-tenant deployment leaves the others untouched.
  const sessionIds = (subject: Parameters<typeof sessionIdFor>[0]) => [sessionIdFor(subject)];
  const onMessage = withUserDataDeletion(conciergeOnMessage, {
    erasers: [sessionStoreEraser(sessionStore, sessionIds), conversationLogEraser(conversationLogger, sessionIds)],
    pendingStore: sessionStore,
    whatIsDeleted: ["your conversation history", "your saved chat and booking-flow state", "our log of bookings you made in this chat"],
    notDeletedNote:
      "Appointments you've already booked stay on the business's calendar — say \"cancel my booking\" first if you'd also like one cancelled.",
    contact: "hello@gracesoft.dev",
    onDeleted: ({ subject, erased, failed }) =>
      appLogger.info({ channel: subject.channel, erased, failed: failed.map((f) => f.eraser) }, "user data deletion completed"),
  });

  const readinessCheck = async (): Promise<boolean> => {
    await redisClient.get("__healthcheck__");
    await pgClient.query("SELECT 1", []);
    return true;
  };

  return { onMessage, readinessCheck, appLogger };
}
