import express, { type Request, type Response, type Router } from "express";
import type { NormalizedMessage, NormalizedResponse } from "@gracesoft-sentinel/core";
import { verifySlackSignature } from "./signature.js";
import { isActionableSlackEvent, type SlackChannelAdapter } from "./slack-adapter.js";
import type { SlackApiClient } from "./slack-api-client.js";
import type { SlackInboundPayload } from "./slack-types.js";

export interface SlackWebhookRouterConfig {
  signingSecret: string;
  adapter: SlackChannelAdapter;
  apiClient: SlackApiClient;
  /** Injected by whoever composes this router with an agent — keeps this package agent-agnostic. */
  onMessage: (message: NormalizedMessage) => Promise<NormalizedResponse>;
  onError?: (error: unknown) => void;
}

/** Events API posts JSON; interactivity posts `payload=<json>` form-encoded. Both are signed over the same raw bytes. */
function parseBody(rawBody: Buffer, contentType: string | undefined): unknown {
  const text = rawBody.toString("utf-8");
  if (contentType?.includes("application/x-www-form-urlencoded")) {
    const payload = new URLSearchParams(text).get("payload");
    return payload ? JSON.parse(payload) : undefined;
  }
  return JSON.parse(text);
}

function isActionable(payload: SlackInboundPayload): boolean {
  if (payload.type === "block_actions") return payload.actions.length > 0 && Boolean(payload.channel?.id);
  return payload.type === "event_callback" && isActionableSlackEvent(payload.event);
}

/**
 * Express router for Slack — one `POST /webhook` serving as *both* the
 * Events API Request URL and the Interactivity Request URL (point both at
 * it in the Slack app config). Answers the one-time `url_verification`
 * challenge, verifies every request's signature over the raw body, and
 * drops Slack's automatic retries (`X-Slack-Retry-Num`): the ack below goes
 * out before any processing, so a retry only ever means a slow network,
 * and processing it again would answer the same message twice.
 */
export function createSlackWebhookRouter(config: SlackWebhookRouterConfig): Router {
  const router = express.Router();
  const onError = config.onError ?? ((err: unknown) => console.error("[channel-slack] webhook processing failed:", err));

  router.post("/webhook", express.raw({ type: () => true }), (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const signed = verifySlackSignature({
      rawBody,
      signatureHeader: req.header("x-slack-signature"),
      timestampHeader: req.header("x-slack-request-timestamp"),
      signingSecret: config.signingSecret,
    });
    if (!signed) {
      res.sendStatus(403);
      return;
    }

    let payload: SlackInboundPayload | { type: "url_verification"; challenge: string } | undefined;
    try {
      payload = parseBody(rawBody, req.header("content-type")) as typeof payload;
    } catch (err) {
      res.sendStatus(400);
      onError(err);
      return;
    }

    if (payload?.type === "url_verification") {
      res.status(200).json({ challenge: payload.challenge });
      return;
    }

    // Ack immediately — Slack expects a response within 3 seconds.
    res.sendStatus(200);

    if (!payload || req.header("x-slack-retry-num") !== undefined || !isActionable(payload)) return;
    const inbound = payload;

    void (async () => {
      try {
        const normalized = await config.adapter.parseInbound(inbound);
        const response = await config.onMessage(normalized);
        const outbound = config.adapter.formatOutbound(response, { recipientId: normalized.senderId });
        await config.apiClient.sendMessage(outbound);
      } catch (err) {
        onError(err);
      }
    })();
  });

  return router;
}
