import express, { type Express } from "express";
import type { NormalizedMessage, NormalizedResponse } from "@gracesoft-sentinel/core";
import type { Logger } from "@gracesoft-sentinel/logging";
import { mountChannels } from "@gracesoft-sentinel/webhook-host";
import type { DemoServiceEnv } from "./env.js";

export interface BuildServerParams {
  env: DemoServiceEnv;
  onMessage: (message: NormalizedMessage) => Promise<NormalizedResponse>;
  readinessCheck: () => Promise<boolean>;
  appLogger: Logger;
}

/**
 * Composes the deployable HTTP surface: health/readiness endpoints plus
 * every enabled channel, all running side by side — each webhook channel
 * at `/{channel}/webhook` (plus the legacy shared `/webhook`, dispatched
 * by signature header, so already-registered webhook URLs keep working),
 * and the branded web chats at `/chat/gracesoft/` and `/chat/davdevs/`.
 * See `@gracesoft-sentinel/webhook-host` for the routing and rate limits.
 */
export function buildServer(params: BuildServerParams): Express {
  const { env, appLogger } = params;
  const app = express();
  // Exactly one hop: the reverse proxy/tunnel this service always sits
  // behind (ngrok locally, a load balancer in production) — not `true`,
  // which would trust the entire client-supplied X-Forwarded-For chain
  // and let a client spoof its own rate-limit identity.
  app.set("trust proxy", 1);

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/ready", async (_req, res) => {
    const ready = await params.readinessCheck().catch(() => false);
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not ready" });
  });

  const mounted = mountChannels(app, {
    env,
    onMessage: params.onMessage,
    onError: (channel, err) => appLogger.error({ err, channel }, "channel message processing failed"),
    webChatDefaults: {
      productName: "Sentinel Demo",
        welcomeMessage: "Hi! This one chat window demos every GraceSoft Sentinel agent. Send /services to see them all.",
    },
  });
  appLogger.info({ channels: mounted.map((m) => m.path) }, "channels mounted");
  for (const chat of mounted.filter((m) => m.kind === "web-chat" && !m.gated)) {
    appLogger.warn({ path: chat.path }, "web chat is open to anyone — set WEB_CHAT_ACCESS_TOKEN before exposing it publicly");
  }

  return app;
}
