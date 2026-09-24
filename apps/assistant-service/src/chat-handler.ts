import type { AIProvider, SessionStore } from "@gracesoft-sentinel/core";
import type { Logger } from "@gracesoft-sentinel/logging";
import { appendTurn, loadHistory, resetSession, runAssistant, type OrchestratorResult, type QueryContext } from "@gracesoft-sentinel/agent-assistant";
import type { DailyCallCap } from "./daily-call-cap.js";

export interface ChatHandlerDeps {
  ctx: QueryContext;
  aiProvider: AIProvider;
  sessionStore: SessionStore;
  appLogger: Logger;
  callCap: DailyCallCap;
  maxSteps: number;
  timeoutMs: number;
  maxTokens: number;
}

export interface ChatRequest {
  sessionId: string;
  message: string;
  channel: string;
  userId: string;
}

export type ChatResponse = OrchestratorResult & { capped: boolean };

const SPEND_CAP_MESSAGE = "This demo has hit its usage limit for today — please try again tomorrow.";

export function createChatHandler(deps: ChatHandlerDeps) {
  return async function handleChat(req: ChatRequest): Promise<ChatResponse> {
    if (deps.callCap.isExceeded()) {
      deps.appLogger.warn({ sessionId: req.sessionId }, "daily model call cap reached");
      return { answer: SPEND_CAP_MESSAGE, toolCalls: [], steps: 0, gracefulFailure: true, capped: true };
    }

    const history = await loadHistory(deps.sessionStore, req.sessionId);
    const startedAt = Date.now();

    const result = await runAssistant({
      aiProvider: deps.aiProvider,
      ctx: deps.ctx,
      question: req.message,
      history,
      config: { maxSteps: deps.maxSteps, timeoutMs: deps.timeoutMs, maxTokens: deps.maxTokens },
      onToolCall: (log) => {
        deps.appLogger.info({ sessionId: req.sessionId, tool: log.tool, arguments: log.arguments, latencyMs: log.latencyMs }, "assistant tool call");
      },
    });

    deps.callCap.recordCall();
    await appendTurn(deps.sessionStore, req.sessionId, { channel: req.channel, userId: req.userId }, req.message, result.answer);

    deps.appLogger.info(
      { sessionId: req.sessionId, question: req.message, steps: result.steps, toolCallCount: result.toolCalls.length, gracefulFailure: result.gracefulFailure, latencyMs: Date.now() - startedAt },
      "assistant chat request completed"
    );

    return { ...result, capped: false };
  };
}

export function createSessionResetHandler(sessionStore: SessionStore) {
  return (sessionId: string) => resetSession(sessionStore, sessionId);
}
