import { OpenAIProvider } from "@gracesoft-sentinel/provider-ai-openai";
import { createLogger, type Logger } from "@gracesoft-sentinel/logging";
import { loadSnapshot, type QueryContext, type Snapshot } from "@gracesoft-sentinel/agent-assistant";
import { InMemorySessionStore } from "./in-memory-session-store.js";
import { DailyCallCap } from "./daily-call-cap.js";
import { createChatHandler, createSessionResetHandler } from "./chat-handler.js";
import type { AssistantServiceEnv } from "./env.js";

export interface Composition {
  snapshot: Snapshot;
  ctx: QueryContext;
  chatHandler: ReturnType<typeof createChatHandler>;
  resetSession: ReturnType<typeof createSessionResetHandler>;
  sessionStore: InMemorySessionStore;
  appLogger: Logger;
  callCap: DailyCallCap;
}

/** The composition root — loads the snapshot once at boot (fails fast on a bad snapshot, per M1) and wires every other piece purely from env. */
export function buildComposition(env: AssistantServiceEnv): Composition {
  const appLogger = createLogger("assistant-service");

  const loaded = loadSnapshot(env.SNAPSHOT_DIR, { asOfDate: env.AS_OF_DATE });
  appLogger.info({ recordCounts: loaded.summary.recordCounts, warnings: loaded.summary.warnings.length, asOfDate: loaded.summary.asOfDate }, "snapshot loaded");
  for (const warning of loaded.summary.warnings) appLogger.warn({ code: warning.code }, warning.message);

  const ctx: QueryContext = { desk: loaded.desk, skylight: loaded.skylight, crossTool: loaded.crossTool, asOfDate: env.AS_OF_DATE };
  const aiProvider = new OpenAIProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL });
  const sessionStore = new InMemorySessionStore();
  const callCap = new DailyCallCap(env.DAILY_MODEL_CALL_CAP);

  const chatHandler = createChatHandler({
    ctx,
    aiProvider,
    sessionStore,
    appLogger,
    callCap,
    maxSteps: env.MAX_TOOL_STEPS,
    timeoutMs: env.MODEL_TIMEOUT_MS,
    maxTokens: env.MAX_TOKENS_PER_REQUEST,
  });

  return { snapshot: loaded, ctx, chatHandler, resetSession: createSessionResetHandler(sessionStore), sessionStore, appLogger, callCap };
}
