import type { Express, NextFunction, Request, RequestHandler, Response, Router } from "express";
import { rateLimit } from "express-rate-limit";
import { LineApiClient, LineChannelAdapter, createLineWebhookRouter } from "@gracesoft-sentinel/channel-line";
import { SlackApiClient, SlackChannelAdapter, createSlackWebhookRouter } from "@gracesoft-sentinel/channel-slack";
import { SmsChannelAdapter, TwilioApiClient, createSmsWebhookRouter } from "@gracesoft-sentinel/channel-sms";
import { TelegramApiClient, TelegramChannelAdapter, createTelegramWebhookRouter } from "@gracesoft-sentinel/channel-telegram";
import { createDavDevsWebChat } from "@gracesoft-sentinel/channel-web-davdevs";
import { createGraceSoftWebChat } from "@gracesoft-sentinel/channel-web-gracesoft";
import { WhatsAppApiClient, WhatsAppChannelAdapter, createWhatsAppWebhookRouter } from "@gracesoft-sentinel/channel-whatsapp";
import type { NormalizedMessage, NormalizedResponse } from "@gracesoft-sentinel/core";
import type { ChannelEnv } from "./channel-env.js";

export type WebhookChannelName = "whatsapp" | "telegram" | "sms" | "slack" | "line";
export type WebChatName = "gracesoft" | "davdevs";

export interface MountedChannel {
  name: WebhookChannelName | `web-${WebChatName}`;
  /** Where it's reachable, e.g. "/telegram/webhook" or "/chat/gracesoft/". */
  path: string;
  kind: "webhook" | "web-chat";
  /** Web chats only: whether an access code is required. */
  gated?: boolean;
}

export interface MountChannelsParams {
  env: ChannelEnv;
  onMessage: (message: NormalizedMessage) => Promise<NormalizedResponse>;
  onError: (channel: string, error: unknown) => void;
  /** Default copy for the web chats when `WEB_CHAT_PRODUCT_NAME`/`WEB_CHAT_WELCOME_MESSAGE` aren't set, e.g. the service's own product name. */
  webChatDefaults?: { productName?: string; welcomeMessage?: string };
}

/**
 * The platform header each webhook signs with. The legacy shared
 * `/webhook` path uses it to decide which channel a request is for — every
 * platform always sends its own, so it's unambiguous.
 */
const SIGNATURE_HEADERS: [string, WebhookChannelName][] = [
  ["x-hub-signature-256", "whatsapp"],
  ["x-telegram-bot-api-secret-token", "telegram"],
  ["x-twilio-signature", "sms"],
  ["x-slack-signature", "slack"],
  ["x-line-signature", "line"],
];

/** IP-based floor against abuse, not per-chatter fairness — legitimate webhook traffic comes from each platform's own servers. */
function webhookRateLimiter(): RequestHandler {
  return rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
}

/** Web chat traffic *is* end users, one IP each — a tighter per-IP limit on the message endpoint only. */
function webChatRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: "rate_limited" });
    },
  });
}

function buildWebhookRouters(params: MountChannelsParams): Map<WebhookChannelName, Router> {
  const { env, onMessage, onError } = params;
  const routers = new Map<WebhookChannelName, Router>();

  if (env.WHATSAPP_ENABLED) {
    const apiClient = new WhatsAppApiClient({ accessToken: env.WHATSAPP_ACCESS_TOKEN!, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID! });
    const adapter = new WhatsAppChannelAdapter({ resolveMedia: (mediaId) => apiClient.downloadMediaAsDataUri(mediaId) });
    routers.set(
      "whatsapp",
      createWhatsAppWebhookRouter({
        verifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN!,
        appSecret: env.WHATSAPP_APP_SECRET!,
        adapter,
        apiClient,
        onMessage,
        onError: (err) => onError("whatsapp", err),
      })
    );
  }

  if (env.TELEGRAM_ENABLED) {
    const apiClient = new TelegramApiClient({ botToken: env.TELEGRAM_BOT_TOKEN! });
    const adapter = new TelegramChannelAdapter({ resolveMedia: (fileId, mimeType) => apiClient.downloadFileAsDataUri(fileId, mimeType) });
    routers.set(
      "telegram",
      createTelegramWebhookRouter({ secretToken: env.TELEGRAM_WEBHOOK_SECRET!, adapter, apiClient, onMessage, onError: (err) => onError("telegram", err) })
    );
  }

  if (env.SMS_ENABLED) {
    const apiClient = new TwilioApiClient({ accountSid: env.TWILIO_ACCOUNT_SID!, authToken: env.TWILIO_AUTH_TOKEN!, fromNumber: env.TWILIO_FROM_NUMBER! });
    const adapter = new SmsChannelAdapter({ resolveMedia: (url, mimeType) => apiClient.downloadMediaAsDataUri(url, mimeType) });
    routers.set(
      "sms",
      createSmsWebhookRouter({
        authToken: env.TWILIO_AUTH_TOKEN!,
        webhookUrl: env.SMS_WEBHOOK_URL!,
        adapter,
        apiClient,
        onMessage,
        onError: (err) => onError("sms", err),
      })
    );
  }

  if (env.SLACK_ENABLED) {
    const apiClient = new SlackApiClient({ botToken: env.SLACK_BOT_TOKEN! });
    const adapter = new SlackChannelAdapter({ resolveMedia: (url, mimeType) => apiClient.downloadFileAsDataUri(url, mimeType) });
    routers.set(
      "slack",
      createSlackWebhookRouter({ signingSecret: env.SLACK_SIGNING_SECRET!, adapter, apiClient, onMessage, onError: (err) => onError("slack", err) })
    );
  }

  if (env.LINE_ENABLED) {
    const apiClient = new LineApiClient({ channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN! });
    const adapter = new LineChannelAdapter({ resolveMedia: (messageId, mimeType) => apiClient.downloadContentAsDataUri(messageId, mimeType) });
    routers.set(
      "line",
      createLineWebhookRouter({ channelSecret: env.LINE_CHANNEL_SECRET!, adapter, apiClient, onMessage, onError: (err) => onError("line", err) })
    );
  }

  return routers;
}

/**
 * The legacy single `/webhook` path every service used before channels
 * could run side by side. Kept so already-registered webhooks (the live
 * Railway deployments' WhatsApp/Telegram URLs) keep working unchanged: the
 * request is routed by the platform's own signature header, and a request
 * carrying none gets the same 403 an unsigned request always got.
 */
function legacyWebhookDispatcher(routers: Map<WebhookChannelName, Router>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path !== "/") return next();

    let name: WebhookChannelName | undefined;
    if (req.method === "GET" && req.query["hub.mode"] !== undefined) name = "whatsapp";
    else if (req.method === "POST") name = SIGNATURE_HEADERS.find(([header]) => req.header(header) !== undefined)?.[1];

    const router = name ? routers.get(name) : undefined;
    if (!router) {
      res.sendStatus(req.method === "POST" ? 403 : 404);
      return;
    }
    // Each channel router defines its own `/webhook` route; mounted here
    // at `/webhook`, Express has stripped that prefix, so restore it.
    req.url = "/webhook";
    router(req, res, next);
  };
}

/**
 * Mounts every enabled channel on one Express app, all at once:
 *
 * - webhook channels at `/{channel}/webhook` (`/whatsapp/webhook`,
 *   `/telegram/webhook`, `/sms/webhook`, `/slack/webhook`, `/line/webhook`)
 * - the legacy shared `/webhook`, dispatched by signature header
 * - branded web chats at `/chat/gracesoft/` and `/chat/davdevs/`
 *
 * Before this, every service mounted each channel router at the root, and
 * every router claims `POST /webhook` — so with WhatsApp and Telegram both
 * enabled, WhatsApp's router answered (and 403'd) every Telegram delivery.
 * Giving each channel its own path is what actually lets them run
 * concurrently.
 */
export function mountChannels(app: Express, params: MountChannelsParams): MountedChannel[] {
  const { env } = params;
  const mounted: MountedChannel[] = [];
  const routers = buildWebhookRouters(params);

  for (const [name, router] of routers) {
    app.use(`/${name}`, webhookRateLimiter(), router);
    mounted.push({ name, path: `/${name}/webhook`, kind: "webhook" });
  }
  if (routers.size > 0) {
    app.use("/webhook", webhookRateLimiter(), legacyWebhookDispatcher(routers));
  }

  const copy = {
    productName: env.WEB_CHAT_PRODUCT_NAME ?? params.webChatDefaults?.productName,
    welcomeMessage: env.WEB_CHAT_WELCOME_MESSAGE ?? params.webChatDefaults?.welcomeMessage,
  };
  const webCopy = Object.fromEntries(Object.entries(copy).filter(([, value]) => value !== undefined));
  const webChats: [WebChatName, boolean, typeof createGraceSoftWebChat][] = [
    ["gracesoft", env.WEB_GRACESOFT_ENABLED, createGraceSoftWebChat],
    ["davdevs", env.WEB_DAVDEVS_ENABLED, createDavDevsWebChat],
  ];
  for (const [name, enabled, create] of webChats) {
    if (!enabled) continue;
    const path = `/chat/${name}`;
    const { router } = create({
      onMessage: params.onMessage,
      accessToken: env.WEB_CHAT_ACCESS_TOKEN,
      onError: (err) => params.onError(`web-${name}`, err),
      copy: webCopy,
    });
    app.use(`${path}/api`, webChatRateLimiter());
    app.use(path, router);
    mounted.push({ name: `web-${name}`, path: `${path}/`, kind: "web-chat", gated: Boolean(env.WEB_CHAT_ACCESS_TOKEN) });
  }

  return mounted;
}
