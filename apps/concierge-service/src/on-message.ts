import { handleMessage, type FaqGroundingBlueprint } from "@gracesoft-sentinel/agent-concierge";
import type { AIProvider, BusinessConfig, CalendarProvider, ConversationState, NormalizedMessage, NormalizedResponse, SessionStore } from "@gracesoft-sentinel/core";
import { redactPii, type Logger } from "@gracesoft-sentinel/logging";
import type { ConversationLogger } from "@gracesoft-sentinel/logging-postgres";
import type { RedisRateLimiter } from "@gracesoft-sentinel/provider-session-redis";
import { withBookingLogging } from "./logging-calendar-provider.js";

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24; // 24h — long enough to span a slow-to-reply booking flow, short enough not to accumulate forever
const NO_TENANT_MESSAGE = "Sorry, this number isn't set up with us yet. Please contact the business directly.";
const RATE_LIMITED_MESSAGE = "You're sending messages a bit quickly — please wait a moment and try again.";

export interface TenantContext {
  businessConfig: BusinessConfig;
  faqBlueprint: FaqGroundingBlueprint;
  calendarProvider: CalendarProvider;
}

export interface OnMessageDeps {
  /**
   * Resolves which business a given inbound message belongs to, keyed off
   * `message.businessChannelId` (which of the business's own WhatsApp/Twilio
   * identities received it). Single-tenant deployments just return the same
   * `TenantContext` regardless of input; multi-tenant ones look it up in a
   * registry and may return `undefined` for an unrecognized identity.
   */
  resolveTenant: (message: NormalizedMessage) => TenantContext | undefined;
  aiProvider: AIProvider;
  sessionStore: SessionStore;
  conversationLogger: ConversationLogger;
  appLogger: Logger;
  sessionTtlSeconds?: number;
  /**
   * Per-chatter floor against message flooding, independent of the
   * webhook's own per-source-IP limiter (see `server.ts`) — that one can't
   * distinguish one abusive chatter from another, since all legitimate
   * traffic already shares Telegram's/Meta's own IPs. Optional so tests
   * and any deployment that hasn't wired Redis for this yet keep working.
   */
  rateLimiter?: RedisRateLimiter;
}

/** Exported so the "delete my data" flow erases exactly the key this handler writes. */
export function sessionIdFor(message: Pick<NormalizedMessage, "channel" | "senderId" | "businessChannelId">): string {
  // Scoped by tenant too — otherwise the same customer messaging two
  // different businesses on a multi-tenant deployment would collide onto
  // one shared conversation state.
  const tenant = message.businessChannelId ?? "default";
  return `concierge:${tenant}:${message.channel}:${message.senderId}`;
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
 * Builds the `onMessage` callback both channel webhook routers are given —
 * the actual composition of agent + providers + persistence for this
 * service. Kept as a standalone factory (rather than inlined into server
 * setup) so it's testable against fakes without a running Express app.
 */
export function createOnMessageHandler(deps: OnMessageDeps): (message: NormalizedMessage) => Promise<NormalizedResponse> {
  return async (message: NormalizedMessage): Promise<NormalizedResponse> => {
    const sessionId = sessionIdFor(message);
    const log = deps.appLogger.child({ sessionId });

    if (deps.rateLimiter) {
      // Not tenant-scoped: a chatter's own channel identity (their phone
      // number / Telegram user id) doesn't change across businesses on a
      // multi-tenant deployment, so scoping by tenant would let them reset
      // their budget just by being routed to a different one.
      const { limited } = await deps.rateLimiter.hit(`${message.channel}:${message.senderId}`);
      if (limited) {
        log.warn({ channel: message.channel }, "sender rate limit exceeded");
        return { text: RATE_LIMITED_MESSAGE };
      }
    }

    const tenant = deps.resolveTenant(message);
    if (!tenant) {
      log.warn({ businessChannelId: message.businessChannelId }, "no tenant resolved for inbound message");
      return { text: NO_TENANT_MESSAGE };
    }

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
      businessConfig: tenant.businessConfig,
      calendarProvider: withBookingLogging(tenant.calendarProvider, deps.conversationLogger, sessionId, log),
      aiProvider: deps.aiProvider,
      faqBlueprint: tenant.faqBlueprint,
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
