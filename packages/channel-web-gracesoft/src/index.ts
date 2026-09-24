import { createWebChatChannel, type WebChatChannel, type WebChatChannelOptions } from "@gracesoft-sentinel/web-chat-kit";
import { graceSoftTheme } from "./theme.js";

export { GRACESOFT_BRAND_ASSETS_DIR, graceSoftTheme } from "./theme.js";

/** Channel id on every message from this chat — keeps its sessions and logs separate from any other web chat. */
export const GRACESOFT_WEB_CHANNEL_ID = "web-gracesoft";

/**
 * The GraceSoft-branded browser chat channel: `web-chat-kit`'s template
 * dressed in GraceSoft's Purple/Black palette, Montserrat/Playfair/Source
 * Code Pro type and the Sentinel wordmark. Mount `router` under any path.
 */
export function createGraceSoftWebChat(options: WebChatChannelOptions): WebChatChannel {
  return createWebChatChannel(GRACESOFT_WEB_CHANNEL_ID, graceSoftTheme, options);
}
