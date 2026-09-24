import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import type { Logger } from "@gracesoft-sentinel/logging";
import type { Snapshot } from "@gracesoft-sentinel/agent-assistant";
import type { AssistantServiceEnv } from "./env.js";
import type { createChatHandler, createSessionResetHandler } from "./chat-handler.js";
import { SessionRateLimiter } from "./session-rate-limiter.js";

// Works from both `src/server.ts` (tests) and the compiled `dist/server.js` — both sit one level under the package root, so `../public` reaches the same static folder either way.
const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const MAX_MESSAGE_LENGTH = 2000;

export interface BuildServerParams {
  env: AssistantServiceEnv;
  snapshot: Snapshot;
  chatHandler: ReturnType<typeof createChatHandler>;
  resetSession: ReturnType<typeof createSessionResetHandler>;
  appLogger: Logger;
  /** Flips to true once the snapshot has loaded — /health is 503 before this, 200 after (this service's own convention; see the M4 progress note). */
  isReady: () => boolean;
}

function requireDemoToken(env: AssistantServiceEnv) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (token !== env.DEMO_TOKEN) {
      res.status(401).json({ error: "Missing or invalid demo token" });
      return;
    }
    next();
  };
}

export function buildServer(params: BuildServerParams): Express {
  const { env, appLogger } = params;
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "16kb" }));
  app.use(express.static(PUBLIC_DIR));

  app.get("/health", (_req, res) => {
    res.status(params.isReady() ? 200 : 503).json({ status: params.isReady() ? "ok" : "loading" });
  });

  app.get("/meta", (_req, res) => {
    res.json({
      snapshotStart: params.snapshot.summary.snapshotStart,
      snapshotEnd: params.snapshot.summary.snapshotEnd,
      asOfDate: params.snapshot.summary.asOfDate,
      recordCounts: params.snapshot.summary.recordCounts,
      model: env.OPENAI_MODEL,
    });
  });

  const ipLimiter = rateLimit({ windowMs: 60_000, limit: env.RATE_LIMIT_PER_IP_PER_MINUTE, standardHeaders: true, legacyHeaders: false });
  const sessionLimiter = new SessionRateLimiter(env.RATE_LIMIT_PER_SESSION_PER_MINUTE);

  app.post("/chat", requireDemoToken(env), ipLimiter, async (req, res) => {
    const { sessionId, message, channel, userId } = req.body as { sessionId?: unknown; message?: unknown; channel?: unknown; userId?: unknown };

    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }
    if (typeof message !== "string" || message.trim().length === 0) {
      res.status(400).json({ error: "message is required and must not be empty" });
      return;
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
      return;
    }
    if (!sessionLimiter.tryConsume(sessionId)) {
      res.status(429).json({ error: "Too many requests for this session — please slow down and try again shortly." });
      return;
    }

    try {
      const result = await params.chatHandler({
        sessionId,
        message,
        channel: typeof channel === "string" ? channel : "web",
        userId: typeof userId === "string" ? userId : sessionId,
      });

      const wantsStream = req.query.stream === "1" || req.header("accept") === "text/event-stream";
      if (wantsStream) {
        // AIProvider has no token-streaming capability in this repo, so this
        // isn't token-by-token — it's the whole finished answer sent as one
        // SSE event, which still gives the standalone UI a streaming-shaped
        // transport to render against (and to grow into real streaming later
        // if AIProvider ever gains it).
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.write(`data: ${JSON.stringify(result)}\n\n`);
        res.end();
        return;
      }

      res.json(result);
    } catch (err) {
      appLogger.error({ err, sessionId }, "chat request failed unexpectedly");
      res.status(500).json({ error: "Something went wrong answering that — please try again." });
    }
  });

  app.post("/sessions/:id/reset", requireDemoToken(env), async (req, res) => {
    const sessionId = req.params.id;
    if (!sessionId) {
      res.status(400).json({ error: "session id is required" });
      return;
    }
    await params.resetSession(sessionId);
    res.status(200).json({ status: "reset" });
  });

  return app;
}
