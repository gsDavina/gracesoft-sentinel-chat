import type { AIProvider, NormalizedMessage, NormalizedResponse, SessionStore } from "@gracesoft-sentinel/core";
import type { Logger } from "@gracesoft-sentinel/logging";
import { appendTurn, loadHistory, runAssistant, type QueryContext, type ToolDefinition } from "@gracesoft-sentinel/agent-assistant";

export interface AssistantOnMessageDeps {
  ctx: QueryContext;
  /** Structured query-layer tools (default) or `buildSearchTools(pineconeProvider)` in Pinecone-search mode — see composition.ts. */
  tools?: ToolDefinition[];
  aiProvider: AIProvider;
  /** The switcher's own shared store — namespaced below by its own sessionId prefix, same as agent-concierge/agent-cook already do. */
  sessionStore: SessionStore;
  appLogger: Logger;
  maxSteps: number;
  timeoutMs: number;
  maxTokens: number;
}

const NO_TEXT_MESSAGE = "Ask me about GraceSoft Desk or Skylight — hours, billable value, cash position, overdue cards, project health, and so on.";

/** Exported so the "delete my data" flow erases exactly the key this handler writes. */
export function sessionIdFor(message: Pick<NormalizedMessage, "channel" | "senderId" | "businessChannelId">): string {
  return `assistant:${message.channel}:${message.senderId}`;
}

/** Adapts `runAssistant` to the switcher's `RegisteredAgent.onMessage` shape — mirrors `createConciergeOnMessageHandler`/`createCookOnMessageHandler`'s own role in this same file group. */
export function createAssistantOnMessageHandler(deps: AssistantOnMessageDeps): (message: NormalizedMessage) => Promise<NormalizedResponse> {
  return async (message: NormalizedMessage): Promise<NormalizedResponse> => {
    const text = message.text?.trim();
    if (!text) return { text: NO_TEXT_MESSAGE };

    const sessionId = sessionIdFor(message);
    const history = await loadHistory(deps.sessionStore, sessionId);

    const result = await runAssistant({
      aiProvider: deps.aiProvider,
      ctx: deps.ctx,
      question: text,
      history,
      tools: deps.tools,
      config: { maxSteps: deps.maxSteps, timeoutMs: deps.timeoutMs, maxTokens: deps.maxTokens },
      onToolCall: (log) => deps.appLogger.info({ sessionId, tool: log.tool, arguments: log.arguments, latencyMs: log.latencyMs }, "assistant tool call"),
    });

    await appendTurn(deps.sessionStore, sessionId, { channel: message.channel, userId: message.senderId }, text, result.answer);
    deps.appLogger.info(
      { sessionId, steps: result.steps, toolCallCount: result.toolCalls.length, gracefulFailure: result.gracefulFailure },
      "assistant demo-service request completed"
    );

    return { text: result.answer };
  };
}
