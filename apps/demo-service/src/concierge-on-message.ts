import { handleMessage, type FaqGroundingBlueprint } from "@gracesoft-sentinel/agent-concierge";
import type {
  AIProvider,
  BusinessConfig,
  CalendarProvider,
  ConversationState,
  NormalizedMessage,
  NormalizedResponse,
  SessionStore,
} from "@gracesoft-sentinel/core";
import { redactPii, type Logger } from "@gracesoft-sentinel/logging";
import type { ConversationLogger } from "@gracesoft-sentinel/logging-postgres";

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24; // matches concierge-service's own default

export interface ConciergeOnMessageDeps {
  businessConfig: BusinessConfig;
  faqBlueprint: FaqGroundingBlueprint;
  calendarProvider: CalendarProvider;
  aiProvider: AIProvider;
  sessionStore: SessionStore;
  conversationLogger: ConversationLogger;
  appLogger: Logger;
  sessionTtlSeconds?: number;
}

/** Exported so the "delete my data" flow erases exactly the key this handler writes. */
export function sessionIdFor(message: Pick<NormalizedMessage, "channel" | "senderId" | "businessChannelId">): string {
  return `concierge:${message.channel}:${message.senderId}`;
}

function freshState(sessionId: string, message: NormalizedMessage): ConversationState {
  const now = new Date().toISOString();
  return { sessionId, channel: message.channel, userId: message.senderId, agent: "concierge", createdAt: now, updatedAt: now, context: {} };
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

/**
 * The Concierge half of demo-service — a trimmed single-tenant version of
 * apps/concierge-service's own on-message.ts (no multi-tenant resolution,
 * no per-service rate limiter — demo-service applies one shared limiter at
 * the switcher level instead, see composition.ts). Fully self-contained:
 * `@gracesoft-sentinel/agent-switcher` never sees any of this, only the
 * `onMessage` callback this factory returns.
 */
export function createConciergeOnMessageHandler(deps: ConciergeOnMessageDeps): (message: NormalizedMessage) => Promise<NormalizedResponse> {
  return async (message: NormalizedMessage): Promise<NormalizedResponse> => {
    const sessionId = sessionIdFor(message);
    const log = deps.appLogger.child({ sessionId });
    const state = (await deps.sessionStore.get(sessionId)) ?? freshState(sessionId, message);

    await logSafely(deps.conversationLogger, log, {
      sessionId,
      channel: message.channel,
      agent: "concierge",
      direction: "inbound",
      text: message.text,
      occurredAt: message.timestamp,
    });

    const result = await handleMessage({
      message,
      state,
      businessConfig: deps.businessConfig,
      calendarProvider: deps.calendarProvider,
      aiProvider: deps.aiProvider,
      faqBlueprint: deps.faqBlueprint,
    });

    await deps.sessionStore.set(result.state, deps.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS);

    await logSafely(deps.conversationLogger, log, {
      sessionId,
      channel: message.channel,
      agent: "concierge",
      direction: "outbound",
      text: result.response.text,
      occurredAt: new Date().toISOString(),
    });

    log.info("handled message");
    return result.response;
  };
}
