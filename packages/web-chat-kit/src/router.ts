import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { ZodError } from "zod";
import type { NormalizedMessage, NormalizedResponse } from "@gracesoft-sentinel/core";
import { renderChatPage } from "./page.js";
import { renderThemeCss, type WebChatTheme } from "./theme.js";
import type { WebChatChannelAdapter } from "./web-chat-adapter.js";

/** `public/` sits next to both `src/` (tests) and `dist/` (runtime), so this resolves either way. */
const KIT_ASSETS_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const MAX_BODY = "6mb";
const GENERIC_FAILURE = "Something went wrong on our side — please try again in a moment.";

export interface WebChatRouterConfig {
  adapter: WebChatChannelAdapter;
  theme: WebChatTheme;
  /** Injected by whoever composes this router with an agent — keeps this package agent-agnostic. */
  onMessage: (message: NormalizedMessage) => Promise<NormalizedResponse>;
  /**
   * Optional shared access code. When set, `api/messages` requires
   * `Authorization: Bearer <code>` and the page asks for it once. A public
   * chat page is a direct line to a paid model, so any internet-facing
   * deployment should set this (plus the host's per-IP rate limit).
   */
  accessToken?: string;
  onError?: (error: unknown) => void;
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function tokenMatches(header: string | undefined, expected: string): boolean {
  const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
}

/**
 * The web chat "channel": serves the themed page, its template assets and
 * the brand's own assets, plus the one API endpoint the page talks to.
 * Unlike the webhook channels, the reply comes back on the same HTTP
 * response — there's no separate platform API to send it through — so
 * `onMessage` is awaited inline here rather than after an early ack.
 *
 * Mount it under any prefix; the page only uses relative URLs. The bare
 * prefix (no trailing slash) is redirected to `prefix/` so those relative
 * URLs resolve under it rather than beside it.
 */
export function createWebChatRouter(config: WebChatRouterConfig): Router {
  const router = express.Router({ strict: true });
  const onError = config.onError ?? ((err: unknown) => console.error("[web-chat-kit] message handling failed:", err));
  const page = renderChatPage(config.theme, { requiresAccessToken: Boolean(config.accessToken) });
  const themeCss = renderThemeCss(config.theme);

  router.use(securityHeaders);

  router.get("/", (req, res) => {
    const [path, query] = req.originalUrl.split("?");
    if (!path!.endsWith("/")) {
      res.redirect(301, `${path}/${query ? `?${query}` : ""}`);
      return;
    }
    res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(page);
  });

  router.get("/theme.css", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.type("css").send(themeCss);
  });

  // maxAge 0 = always revalidate (cheap, ETag-based), so a redeploy's chat.js/chat.css reach browsers immediately.
  router.use("/assets", express.static(KIT_ASSETS_DIR, { index: false, fallthrough: false, maxAge: 0 }));
  if (config.theme.brandAssetsDir) {
    router.use("/brand", express.static(config.theme.brandAssetsDir, { index: false, fallthrough: false, maxAge: "1d" }));
  }

  router.post("/api/messages", express.json({ limit: MAX_BODY }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (config.accessToken && !tokenMatches(req.header("authorization"), config.accessToken)) {
      res.status(401).json({ error: "access_code_required" });
      return;
    }

    let message: NormalizedMessage;
    try {
      message = config.adapter.parseInbound(req.body);
    } catch (err) {
      const detail = err instanceof ZodError ? err.issues[0]?.message : undefined;
      res.status(400).json({ error: "invalid_message", detail });
      return;
    }

    try {
      const response = await config.onMessage(message);
      res.status(200).json({ reply: config.adapter.formatOutbound(response, { recipientId: message.senderId }) });
    } catch (err) {
      onError(err);
      res.status(500).json({ error: "internal_error", reply: { text: GENERIC_FAILURE } });
    }
  });

  // express.json() failures (malformed JSON, oversize body) — answer in the same JSON shape as everything else.
  router.use("/api", (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const status = typeof err === "object" && err !== null && "status" in err ? Number((err as { status: unknown }).status) : 500;
    res.status(status === 413 ? 413 : 400).json({ error: status === 413 ? "too_large" : "invalid_message" });
  });

  return router;
}
