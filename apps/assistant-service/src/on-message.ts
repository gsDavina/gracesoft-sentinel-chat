import type { AIProvider, NormalizedMessage, NormalizedResponse, SessionStore } from "@gracesoft-sentinel/core";
import type { Logger } from "@gracesoft-sentinel/logging";
import { appendTurn, findFallbackAnswer, loadHistory, runAssistant, type FallbackAnswer, type QueryContext, type ToolDefinition } from "@gracesoft-sentinel/agent-assistant";
import type { DailyCallCap } from "./daily-call-cap.js";
import type { SessionRateLimiter } from "./session-rate-limiter.js";

export interface OnMessageDeps {
  ctx: QueryContext;
  /** Structured query-layer tools (default) or `buildSearchTools(pineconeProvider)` in Pinecone-search mode — see composition.ts. */
  tools?: ToolDefinition[];
  aiProvider: AIProvider;
  sessionStore: SessionStore;
  appLogger: Logger;
  callCap: DailyCallCap;
  /** M7's fallback plan: pre-computed answers for the demo script's own questions, used only when the live model call fails outright. Empty in Pinecone-search mode — see the composition.ts note. */
  fallbackAnswers: FallbackAnswer[];
  rateLimiter?: SessionRateLimiter;
  maxSteps: number;
  timeoutMs: number;
  maxTokens: number;
}

const NO_TEXT_MESSAGE = "Ask me about GraceSoft Desk or Skylight — hours, billable value, cash position, overdue cards, project health, and so on.";
const RATE_LIMITED_MESSAGE = "You're sending messages a bit quickly — please wait a moment and try again.";
const SPEND_CAP_MESSAGE = "This demo has hit its usage limit for today — please try again tomorrow.";

/** Exported so the "delete my data" flow erases exactly the key this handler writes. */
export function sessionIdFor(message: Pick<NormalizedMessage, "channel" | "senderId" | "businessChannelId">): string {
  return `assistant:${message.channel}:${message.senderId}`;
}

/** Builds the `onMessage` callback both channel webhook routers are given — same role as cook-service's/concierge-service's own `createOnMessageHandler`. */
export function createOnMessageHandler(deps: OnMessageDeps): (message: NormalizedMessage) => Promise<NormalizedResponse> {
  return async (message: NormalizedMessage): Promise<NormalizedResponse> => {
    const sessionId = sessionIdFor(message);
    const log = deps.appLogger.child({ sessionId });

    const text = message.text?.trim();
    if (!text) return { text: NO_TEXT_MESSAGE };

    if (deps.rateLimiter && !deps.rateLimiter.tryConsume(sessionId)) {
      log.warn({ channel: message.channel }, "sender rate limit exceeded");
      return { text: RATE_LIMITED_MESSAGE };
    }

    if (deps.callCap.isExceeded()) {
      log.warn("daily model call cap reached");
      return { text: SPEND_CAP_MESSAGE };
    }

    const history = await loadHistory(deps.sessionStore, sessionId);
    const startedAt = Date.now();

    const result = await runAssistant({
      aiProvider: deps.aiProvider,
      ctx: deps.ctx,
      question: text,
      history,
      tools: deps.tools,
      config: { maxSteps: deps.maxSteps, timeoutMs: deps.timeoutMs, maxTokens: deps.maxTokens },
      onToolCall: (toolLog) => log.info({ tool: toolLog.tool, arguments: toolLog.arguments, latencyMs: toolLog.latencyMs }, "assistant tool call"),
    });

    deps.callCap.recordCall();

    let answer = result.answer;
    if (result.gracefulFailure) {
      const fallback = findFallbackAnswer(deps.fallbackAnswers, text);
      if (fallback) {
        log.warn("live model failed — serving a cached demo-script fallback answer");
        answer = fallback;
      }
    }

    await appendTurn(deps.sessionStore, sessionId, { channel: message.channel, userId: message.senderId }, text, answer);
    log.info({ steps: result.steps, toolCallCount: result.toolCalls.length, gracefulFailure: result.gracefulFailure, latencyMs: Date.now() - startedAt }, "assistant message handled");

    return { text: answer };
  };
}
