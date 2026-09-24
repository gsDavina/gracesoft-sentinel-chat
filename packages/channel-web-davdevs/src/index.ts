import { createWebChatChannel, type WebChatChannel, type WebChatChannelOptions } from "@gracesoft-sentinel/web-chat-kit";
import { davDevsTheme } from "./theme.js";

export { DAVDEVS_BRAND_ASSETS_DIR, davDevsTheme } from "./theme.js";

/** Channel id on every message from this chat — keeps its sessions and logs separate from any other web chat. */
export const DAVDEVS_WEB_CHANNEL_ID = "web-davdevs";

/**
 * The Dav/Devs-branded browser chat channel: `web-chat-kit`'s template in
 * the dark-first ink/cream/gold palette with Syne/Inter/JetBrains Mono
 * type. Mount `router` under any path.
 */
export function createDavDevsWebChat(options: WebChatChannelOptions): WebChatChannel {
  return createWebChatChannel(DAVDEVS_WEB_CHANNEL_ID, davDevsTheme, options);
}
