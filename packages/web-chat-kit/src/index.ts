import type { Router } from "express";
import type { ChannelId, NormalizedMessage, NormalizedResponse } from "@gracesoft-sentinel/core";
import { createWebChatRouter } from "./router.js";
import type { WebChatTheme } from "./theme.js";
import { WebChatChannelAdapter } from "./web-chat-adapter.js";

export { WebChatChannelAdapter, WebChatInboundSchema } from "./web-chat-adapter.js";
export type { WebChatInbound, WebChatReply } from "./web-chat-adapter.js";
export { createWebChatRouter } from "./router.js";
export type { WebChatRouterConfig } from "./router.js";
export { renderThemeCss } from "./theme.js";
export type { WebChatColorScheme, WebChatColorTokens, WebChatFonts, WebChatLogo, WebChatTheme } from "./theme.js";
export { escapeHtml, renderChatPage } from "./page.js";
export { auditThemeContrast, contrastRatio } from "./contrast.js";
export type { ContrastFailure } from "./contrast.js";

export interface WebChatChannelOptions {
  onMessage: (message: NormalizedMessage) => Promise<NormalizedResponse>;
  /** See `WebChatRouterConfig.accessToken`. */
  accessToken?: string;
  onError?: (error: unknown) => void;
  /** Per-deployment overrides of the theme's copy, e.g. `{ productName: "Sentinel Cook" }`. */
  copy?: Partial<Pick<WebChatTheme, "productName" | "welcomeMessage" | "inputPlaceholder" | "footerNote">>;
}

export interface WebChatChannel {
  adapter: WebChatChannelAdapter;
  router: Router;
}

/**
 * The one-call way to build a branded web chat channel: a theme plus the
 * usual channel wiring. This is what each `channel-web-*` package wraps —
 * the template for any future branded UI is "write a `WebChatTheme`, call
 * this".
 */
export function createWebChatChannel(channel: ChannelId, theme: WebChatTheme, options: WebChatChannelOptions): WebChatChannel {
  const adapter = new WebChatChannelAdapter({ channel });
  const router = createWebChatRouter({
    adapter,
    theme: { ...theme, ...options.copy },
    onMessage: options.onMessage,
    accessToken: options.accessToken,
    onError: options.onError,
  });
  return { adapter, router };
}
