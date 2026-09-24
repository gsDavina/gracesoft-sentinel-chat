import express, { type Request, type Response, type Router } from "express";
import type { NormalizedMessage, NormalizedResponse } from "@gracesoft-sentinel/core";
import { isActionableLineEvent, type LineChannelAdapter } from "./line-adapter.js";
import type { LineApiClient } from "./line-api-client.js";
import type { LineWebhookBody } from "./line-types.js";
import { verifyLineSignature } from "./signature.js";

export interface LineWebhookRouterConfig {
  channelSecret: string;
  adapter: LineChannelAdapter;
  apiClient: LineApiClient;
  /** Injected by whoever composes this router with an agent — keeps this package agent-agnostic. */
  onMessage: (message: NormalizedMessage) => Promise<NormalizedResponse>;
  onError?: (error: unknown) => void;
}

/**
 * Express router for the LINE Messaging API webhook. POST-only (the
 * console's "Verify" button just sends a signed body with no events, which
 * this acks like any other). Verifies `X-Line-Signature` over the raw body,
 * acks at once, then answers each actionable event in the batch
 * independently, so one failing event doesn't swallow the rest.
 */
export function createLineWebhookRouter(config: LineWebhookRouterConfig): Router {
  const router = express.Router();
  const onError = config.onError ?? ((err: unknown) => console.error("[channel-line] webhook processing failed:", err));

  router.post("/webhook", express.raw({ type: () => true }), (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyLineSignature(rawBody, req.header("x-line-signature"), config.channelSecret)) {
      res.sendStatus(403);
      return;
    }

    let body: LineWebhookBody;
    try {
      body = JSON.parse(rawBody.toString("utf-8")) as LineWebhookBody;
    } catch (err) {
      res.sendStatus(400);
      onError(err);
      return;
    }

    res.sendStatus(200);

    for (const event of body.events ?? []) {
      if (!isActionableLineEvent(event)) continue;
      void (async () => {
        try {
          const normalized = await config.adapter.parseInbound({ destination: body.destination, event });
          const response = await config.onMessage(normalized);
          const outbound = config.adapter.formatOutbound(response, { recipientId: normalized.senderId });
          await config.apiClient.replyOrPush(event.replyToken, outbound);
        } catch (err) {
          onError(err);
        }
      })();
    }
  });

  return router;
}
