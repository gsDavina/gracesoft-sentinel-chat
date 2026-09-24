import { OpenAIProvider } from "@gracesoft-sentinel/provider-ai-openai";
import { createPineconeClient } from "@gracesoft-sentinel/provider-recipe-pinecone";
import { PineconeSnapshotSearchProvider } from "@gracesoft-sentinel/provider-snapshot-pinecone";
import type { AIProvider, NormalizedMessage, NormalizedResponse } from "@gracesoft-sentinel/core";
import { createLogger, type Logger } from "@gracesoft-sentinel/logging";
import { buildDemoFallbackAnswers, buildSearchTools, createEmptyQueryContext, loadSnapshot, type FallbackAnswer, type QueryContext, type ToolDefinition } from "@gracesoft-sentinel/agent-assistant";
import { InMemorySessionStore } from "./in-memory-session-store.js";
import { DailyCallCap } from "./daily-call-cap.js";
import { SessionRateLimiter } from "./session-rate-limiter.js";
import { sessionStoreEraser, withUserDataDeletion } from "@gracesoft-sentinel/user-data-deletion";
import { createOnMessageHandler, sessionIdFor } from "./on-message.js";
import type { AssistantServiceEnv } from "./env.js";

export interface Composition {
  onMessage: (message: NormalizedMessage) => Promise<NormalizedResponse>;
  readinessCheck: () => Promise<boolean>;
  appLogger: Logger;
  /** Exposed only for index.ts's boot-time warm-up call — nothing else should reach past `onMessage`. */
  aiProvider: AIProvider;
}

interface DataMode {
  ctx: QueryContext;
  tools: ToolDefinition[] | undefined;
  fallbackAnswers: FallbackAnswer[];
}

/**
 * Structured mode (default) loads a JSON snapshot and answers via the
 * deterministic query-layer tools; Pinecone-search mode (set
 * `PINECONE_INDEX_NAME`) swaps in `search_snapshot` over an existing
 * MySQL→Pinecone index instead — env.ts's `superRefine` already guarantees
 * exactly one of `SNAPSHOT_DIR`/`PINECONE_INDEX_NAME` is usable. The M7
 * fallback-answer cache is structured-mode-only: it's built from the
 * query layer, which Pinecone-search mode doesn't load at all.
 */
function buildDataMode(env: AssistantServiceEnv, aiProvider: AIProvider, appLogger: Logger): DataMode {
  if (env.PINECONE_INDEX_NAME) {
    const pineconeClient = createPineconeClient({ apiKey: env.PINECONE_API_KEY!, indexName: env.PINECONE_INDEX_NAME, namespace: env.PINECONE_NAMESPACE });
    const searchProvider = new PineconeSnapshotSearchProvider({ client: pineconeClient, aiProvider });
    appLogger.info({ index: env.PINECONE_INDEX_NAME, namespace: env.PINECONE_NAMESPACE }, "assistant running in Pinecone-search mode");
    return { ctx: createEmptyQueryContext(env.AS_OF_DATE), tools: buildSearchTools(searchProvider), fallbackAnswers: [] };
  }

  const loaded = loadSnapshot(env.SNAPSHOT_DIR!, { asOfDate: env.AS_OF_DATE });
  appLogger.info({ recordCounts: loaded.summary.recordCounts, warnings: loaded.summary.warnings.length, asOfDate: loaded.summary.asOfDate }, "snapshot loaded");
  for (const warning of loaded.summary.warnings) appLogger.warn({ code: warning.code }, warning.message);

  const ctx: QueryContext = { desk: loaded.desk, skylight: loaded.skylight, crossTool: loaded.crossTool, asOfDate: env.AS_OF_DATE };
  return { ctx, tools: undefined, fallbackAnswers: buildDemoFallbackAnswers(ctx) };
}

/** The composition root — resolves the data mode (fails fast on a bad snapshot or missing Pinecone config, per env.ts) and wires every channel purely from env. */
export function buildComposition(env: AssistantServiceEnv): Composition {
  const appLogger = createLogger("assistant-service");
  const aiProvider = new OpenAIProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL });

  const { ctx, tools, fallbackAnswers } = buildDataMode(env, aiProvider, appLogger);

  const sessionStore = new InMemorySessionStore();
  const callCap = new DailyCallCap(env.DAILY_MODEL_CALL_CAP);
  const rateLimiter = new SessionRateLimiter(env.RATE_LIMIT_PER_CHATTER_PER_MINUTE);

  const assistantOnMessage = createOnMessageHandler({
    ctx,
    tools,
    aiProvider,
    sessionStore,
    appLogger,
    callCap,
    fallbackAnswers,
    rateLimiter,
    maxSteps: env.MAX_TOOL_STEPS,
    timeoutMs: env.MODEL_TIMEOUT_MS,
    maxTokens: env.MAX_TOKENS_PER_REQUEST,
  });
  // Sessions are in-memory only here (no Postgres log), so that's all there is to erase.
  const onMessage = withUserDataDeletion(assistantOnMessage, {
    erasers: [sessionStoreEraser(sessionStore, (subject) => [sessionIdFor(subject)])],
    pendingStore: sessionStore,
    whatIsDeleted: ["your conversation history with the assistant"],
    contact: "hello@gracesoft.dev",
    onDeleted: ({ subject, erased, failed }) =>
      appLogger.info({ channel: subject.channel, erased, failed: failed.map((f) => f.eraser) }, "user data deletion completed"),
  });

  // Everything above already ran to completion synchronously (or threw) by the time this returns — nothing external left to ping.
  const readinessCheck = async (): Promise<boolean> => true;

  return { onMessage, readinessCheck, appLogger, aiProvider };
}
