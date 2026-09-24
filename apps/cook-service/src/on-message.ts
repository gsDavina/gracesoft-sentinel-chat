import { handleMessage } from "@gracesoft-sentinel/agent-cook";
import type { AIProvider, ConversationState, NormalizedMessage, NormalizedResponse, RecipeSourceProvider, SessionStore } from "@gracesoft-sentinel/core";
import { redactPii, type Logger } from "@gracesoft-sentinel/logging";
import type { ConversationLogger } from "@gracesoft-sentinel/logging-postgres";
import type { RedisRateLimiter } from "@gracesoft-sentinel/provider-session-redis";

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60; // 1h — Cook's flow is single-photo-in, single-recipe-out; short-lived by design
const RATE_LIMITED_MESSAGE = "You're sending messages a bit quickly — please wait a moment and try again.";

export interface OnMessageDeps {
  aiProvider: AIProvider;
  sessionStore: SessionStore;
  conversationLogger: ConversationLogger;
  appLogger: Logger;
  sessionTtlSeconds?: number;
  /** "Mother's Day Edition" (Milestone 11), opt-in — see agent-cook's CookHandleMessageInput. */
  recipeSourceProvider?: RecipeSourceProvider;
  /** Per-chatter floor against flooding — see concierge-service's equivalent for the design rationale. */
  rateLimiter?: RedisRateLimiter;
}

/** Exported so the "delete my data" flow erases exactly the key this handler writes. */
export function sessionIdFor(message: Pick<NormalizedMessage, "channel" | "senderId" | "businessChannelId">): string {
  return `cook:${message.channel}:${message.senderId}`;
}

function freshState(sessionId: string, message: NormalizedMessage): ConversationState {
  const now = new Date().toISOString();
  return { sessionId, channel: message.channel, userId: message.senderId, agent: "cook", createdAt: now, updatedAt: now, context: {} };
}

async function logSafely(
  conversationLogger: ConversationLogger,
  appLogger: Logger,
  entry: Parameters<ConversationLogger["logMessage"]>[0]
): Promise<void> {
  try {
    await conversationLogger.logMessage({ ...entry, text: entry.text ? redactPii(entry.text) : entry.text });
  } catch (err) {
    appLogger.error({ err, sessionId: entry.sessionId }, "failed to log conversation message");
  }
}

/** Builds the `onMessage` callback both channel webhook routers are given — see concierge-service's equivalent for the design rationale. */
export function createOnMessageHandler(deps: OnMessageDeps): (message: NormalizedMessage) => Promise<NormalizedResponse> {
  return async (message: NormalizedMessage): Promise<NormalizedResponse> => {
    const sessionId = sessionIdFor(message);
    const log = deps.appLogger.child({ sessionId });

    if (deps.rateLimiter) {
      const { limited } = await deps.rateLimiter.hit(`${message.channel}:${message.senderId}`);
      if (limited) {
        log.warn({ channel: message.channel }, "sender rate limit exceeded");
        return { text: RATE_LIMITED_MESSAGE };
      }
    }

    const state = (await deps.sessionStore.get(sessionId)) ?? freshState(sessionId, message);

    await logSafely(deps.conversationLogger, log, {
      sessionId,
      channel: message.channel,
      agent: "cook",
      direction: "inbound",
      text: message.text ?? (message.media?.length ? "[photo]" : undefined),
      occurredAt: message.timestamp,
    });

    const result = await handleMessage({ message, state, aiProvider: deps.aiProvider, recipeSourceProvider: deps.recipeSourceProvider });

    await deps.sessionStore.set(result.state, deps.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS);

    await logSafely(deps.conversationLogger, log, {
      sessionId,
      channel: message.channel,
      agent: "cook",
      direction: "outbound",
      text: result.response.text,
      occurredAt: new Date().toISOString(),
    });

    log.info("handled message");
    return result.response;
  };
}
