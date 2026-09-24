import { OpenAIProvider } from "@gracesoft-sentinel/provider-ai-openai";
import { RedisRateLimiter, RedisSessionStore, createRedisClient } from "@gracesoft-sentinel/provider-session-redis";
import { PostgresConversationLogger, createPgClient } from "@gracesoft-sentinel/logging-postgres";
import { createLogger, type Logger } from "@gracesoft-sentinel/logging";
import { PineconeRecipeProvider, createPineconeClient } from "@gracesoft-sentinel/provider-recipe-pinecone";
import type { AIProvider, NormalizedMessage, NormalizedResponse, RecipeSourceProvider } from "@gracesoft-sentinel/core";
import { conversationLogEraser, sessionStoreEraser, withUserDataDeletion } from "@gracesoft-sentinel/user-data-deletion";
import { createOnMessageHandler, sessionIdFor } from "./on-message.js";
import type { CookServiceEnv } from "./env.js";

export interface Composition {
  onMessage: (message: NormalizedMessage) => Promise<NormalizedResponse>;
  readinessCheck: () => Promise<boolean>;
  appLogger: Logger;
}

/**
 * "Mother's Day Edition" (Milestone 11) — fully opt-in, query-time only.
 * Only constructed when PINECONE_INDEX_NAME is set (env.ts's superRefine
 * already guarantees PINECONE_API_KEY is present whenever it is); every
 * other deployment gets `undefined` and agent-cook's photo-based flow is
 * entirely unaffected. The index itself is populated separately, ahead of
 * time, by `provider-recipe-pinecone`'s Drive→Pinecone sync job — this
 * service only ever queries it, never lists/embeds a Drive folder inline.
 */
function buildRecipeSourceProvider(env: CookServiceEnv, aiProvider: AIProvider): RecipeSourceProvider | undefined {
  if (!env.PINECONE_INDEX_NAME) return undefined;

  const client = createPineconeClient({
    apiKey: env.PINECONE_API_KEY!,
    indexName: env.PINECONE_INDEX_NAME,
    namespace: env.PINECONE_NAMESPACE,
  });
  return new PineconeRecipeProvider({ client, aiProvider });
}

/** The composition root: wires agent-cook to every provider and persistence layer, purely from env. */
export function buildComposition(env: CookServiceEnv): Composition {
  const appLogger = createLogger("cook-service");

  const aiProvider = new OpenAIProvider({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    visionModel: env.OPENAI_VISION_MODEL,
  });

  const recipeSourceProvider = buildRecipeSourceProvider(env, aiProvider);

  const redisClient = createRedisClient(env.REDIS_URL);
  const sessionStore = new RedisSessionStore({ client: redisClient, keyPrefix: "gracesoft-sentinel:cook-session:" });
  // Separate keyPrefix from concierge-service's limiter: the same phone
  // number can message both bots, and a flood on one product shouldn't
  // lock a chatter out of the other.
  const rateLimiter = new RedisRateLimiter({ client: redisClient, limit: 20, windowSeconds: 60, keyPrefix: "gracesoft-sentinel:cook-ratelimit:" });

  const pgClient = createPgClient(env.DATABASE_URL);
  const conversationLogger = new PostgresConversationLogger({ client: pgClient });

  const cookOnMessage = createOnMessageHandler({ aiProvider, sessionStore, conversationLogger, appLogger, recipeSourceProvider, rateLimiter });
  // Outermost, so the command never reaches the agent or the log it erases.
  const sessionIds = (subject: Parameters<typeof sessionIdFor>[0]) => [sessionIdFor(subject)];
  const onMessage = withUserDataDeletion(cookOnMessage, {
    erasers: [sessionStoreEraser(sessionStore, sessionIds), conversationLogEraser(conversationLogger, sessionIds)],
    pendingStore: sessionStore,
    whatIsDeleted: ["your conversation history", "your saved chat state"],
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
