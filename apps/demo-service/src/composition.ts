import { OpenAIProvider } from "@gracesoft-sentinel/provider-ai-openai";
import { GoogleCalendarProvider, createGoogleCalendarClient } from "@gracesoft-sentinel/provider-calendar-google";
import { PineconeRecipeProvider, createPineconeClient } from "@gracesoft-sentinel/provider-recipe-pinecone";
import { PineconeSnapshotSearchProvider } from "@gracesoft-sentinel/provider-snapshot-pinecone";
import { RedisRateLimiter, RedisSessionStore, createRedisClient } from "@gracesoft-sentinel/provider-session-redis";
import { PostgresConversationLogger, createPgClient } from "@gracesoft-sentinel/logging-postgres";
import { createLogger, type Logger } from "@gracesoft-sentinel/logging";
import { createAgentSwitcher, type RegisteredAgent } from "@gracesoft-sentinel/agent-switcher";
import type { AIProvider, NormalizedMessage, NormalizedResponse, RecipeSourceProvider, SessionStore } from "@gracesoft-sentinel/core";
import { buildSearchTools, createEmptyQueryContext, loadSnapshot, type QueryContext, type ToolDefinition } from "@gracesoft-sentinel/agent-assistant";
import { loadBusinessConfig, loadFaqBlueprint } from "./business-config-loader.js";
import { createConciergeOnMessageHandler } from "./concierge-on-message.js";
import { createCookOnMessageHandler } from "./cook-on-message.js";
import { createAssistantOnMessageHandler } from "./assistant-on-message.js";
import type { DemoServiceEnv } from "./env.js";

export interface Composition {
  onMessage: (message: NormalizedMessage) => Promise<NormalizedResponse>;
  readinessCheck: () => Promise<boolean>;
  appLogger: Logger;
}

const RATE_LIMITED_MESSAGE = "You're sending messages a bit quickly — please wait a moment and try again.";

/**
 * "Mother's Day Edition" (Milestone 11) — fully opt-in, query-time only,
 * mirrors cook-service's own `buildRecipeSourceProvider`. Only constructed
 * when PINECONE_INDEX_NAME is set; every other demo-service run gets
 * `undefined` and Cook's photo-based flow is entirely unaffected. The
 * index itself is populated separately, ahead of time, by
 * `provider-recipe-pinecone`'s Drive→Pinecone sync job.
 */
function buildRecipeSourceProvider(env: DemoServiceEnv, aiProvider: AIProvider): RecipeSourceProvider | undefined {
  if (!env.PINECONE_INDEX_NAME) return undefined;

  const client = createPineconeClient({
    apiKey: env.PINECONE_API_KEY!,
    indexName: env.PINECONE_INDEX_NAME,
    namespace: env.PINECONE_NAMESPACE,
  });
  return new PineconeRecipeProvider({ client, aiProvider });
}

/**
 * GraceSoft Assistant (feature-flagged): `undefined` when `ASSISTANT_ENABLED`
 * is unset, so nothing about the switcher or its routes changes for a
 * deployment that hasn't turned this on — same opt-in shape as
 * `buildRecipeSourceProvider` above. Loads the snapshot synchronously here
 * (env.ts's `superRefine` already guarantees `ASSISTANT_SNAPSHOT_DIR` is set
 * whenever this runs), so a bad snapshot fails demo-service's boot loudly,
 * the same way it fails `assistant-service`'s.
 */
function buildAssistantAgent(env: DemoServiceEnv, aiProvider: AIProvider, sessionStore: SessionStore, appLogger: Logger): RegisteredAgent | undefined {
  if (!env.ASSISTANT_ENABLED) return undefined;

  let ctx: QueryContext;
  let tools: ToolDefinition[] | undefined;

  if (env.ASSISTANT_PINECONE_INDEX_NAME) {
    const pineconeClient = createPineconeClient({ apiKey: env.ASSISTANT_PINECONE_API_KEY!, indexName: env.ASSISTANT_PINECONE_INDEX_NAME, namespace: env.ASSISTANT_PINECONE_NAMESPACE });
    const searchProvider = new PineconeSnapshotSearchProvider({ client: pineconeClient, aiProvider });
    appLogger.info({ index: env.ASSISTANT_PINECONE_INDEX_NAME, namespace: env.ASSISTANT_PINECONE_NAMESPACE }, "assistant running in Pinecone-search mode");
    ctx = createEmptyQueryContext(env.ASSISTANT_AS_OF_DATE);
    tools = buildSearchTools(searchProvider);
  } else {
    const loaded = loadSnapshot(env.ASSISTANT_SNAPSHOT_DIR!, { asOfDate: env.ASSISTANT_AS_OF_DATE });
    appLogger.info({ recordCounts: loaded.summary.recordCounts, warnings: loaded.summary.warnings.length }, "assistant snapshot loaded");
    for (const warning of loaded.summary.warnings) appLogger.warn({ code: warning.code }, warning.message);
    ctx = { desk: loaded.desk, skylight: loaded.skylight, crossTool: loaded.crossTool, asOfDate: env.ASSISTANT_AS_OF_DATE };
  }

  const onMessage = createAssistantOnMessageHandler({
    ctx,
    tools,
    aiProvider,
    sessionStore,
    appLogger,
    maxSteps: env.ASSISTANT_MAX_TOOL_STEPS,
    timeoutMs: env.ASSISTANT_MODEL_TIMEOUT_MS,
    maxTokens: env.ASSISTANT_MAX_TOKENS_PER_REQUEST,
  });

  return { name: "assistant", label: "GraceSoft Assistant", triggers: ["/assistant", "assistant"], onMessage };
}

/**
 * The composition root: wires agent-concierge AND agent-cook side by side
 * behind `@gracesoft-sentinel/agent-switcher`, so one channel webhook can
 * demo both. Everything below the switcher is a trimmed, single-tenant
 * echo of apps/concierge-service's / apps/cook-service's own composition —
 * this app can't import those apps directly (apps/* may not depend on each
 * other), so their wiring is re-derived here from the same packages, not
 * shared code.
 */
export function buildComposition(env: DemoServiceEnv): Composition {
  const appLogger = createLogger("demo-service");

  const aiProvider = new OpenAIProvider({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    visionModel: env.OPENAI_VISION_MODEL,
  });

  const calendarClient = createGoogleCalendarClient({
    serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  });
  const businessConfig = loadBusinessConfig(env.BUSINESS_CONFIG_PATH);
  const faqBlueprint = loadFaqBlueprint(env.BUSINESS_CONFIG_PATH, businessConfig);
  const calendarProvider = new GoogleCalendarProvider({ client: calendarClient, businessHours: businessConfig.businessHours });

  const redisClient = createRedisClient(env.REDIS_URL);
  // One shared store for all four concerns (Concierge sessions, Cook
  // sessions, Assistant sessions, and the switcher's own "which agent is
  // active" state) — safe because each already namespaces its own
  // sessionId ("concierge:...", "cook:...", "assistant:...", "switcher:..."),
  // so nothing collides under one keyPrefix.
  const sessionStore = new RedisSessionStore({ client: redisClient, keyPrefix: "gracesoft-sentinel:demo:" });
  // One shared limiter, not one per agent like the two real services use —
  // here it's genuinely the same chatter switching between agents, not two
  // independent products with independent audiences.
  const rateLimiter = new RedisRateLimiter({ client: redisClient, limit: 20, windowSeconds: 60, keyPrefix: "gracesoft-sentinel:demo-ratelimit:" });

  const pgClient = createPgClient(env.DATABASE_URL);
  const conversationLogger = new PostgresConversationLogger({ client: pgClient });

  const conciergeOnMessage = createConciergeOnMessageHandler({
    businessConfig,
    faqBlueprint,
    calendarProvider,
    aiProvider,
    sessionStore,
    conversationLogger,
    appLogger,
  });
  const recipeSourceProvider = buildRecipeSourceProvider(env, aiProvider);
  const cookOnMessage = createCookOnMessageHandler({ aiProvider, sessionStore, conversationLogger, appLogger, recipeSourceProvider });
  const assistantAgent = buildAssistantAgent(env, aiProvider, sessionStore, appLogger);

  const switcherOnMessage = createAgentSwitcher({
    agents: [
      { name: "concierge", label: "Sentinel Concierge", triggers: ["/concierge", "concierge"], onMessage: conciergeOnMessage },
      { name: "cook", label: "Sentinel Cook", triggers: ["/cook", "cook"], onMessage: cookOnMessage },
      ...(assistantAgent ? [assistantAgent] : []),
    ],
    defaultAgent: env.DEMO_DEFAULT_AGENT,
    sessionStore,
  });

  const onMessage = async (message: NormalizedMessage): Promise<NormalizedResponse> => {
    const { limited } = await rateLimiter.hit(`${message.channel}:${message.senderId}`);
    if (limited) {
      appLogger.warn({ channel: message.channel }, "sender rate limit exceeded");
      return { text: RATE_LIMITED_MESSAGE };
    }
    return switcherOnMessage(message);
  };

  const readinessCheck = async (): Promise<boolean> => {
    await redisClient.get("__healthcheck__");
    await pgClient.query("SELECT 1", []);
    return true;
  };

  return { onMessage, readinessCheck, appLogger };
}
