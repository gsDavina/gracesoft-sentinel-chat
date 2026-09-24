import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ChannelAdapter, ChannelId, NormalizedMessage, NormalizedResponse } from "@gracesoft-sentinel/core";

const MAX_TEXT_LENGTH = 4000;
/** ~4 MB of image once base64-decoded — generous for a phone photo, small enough not to be a memory lever. */
const MAX_IMAGE_DATA_URI_LENGTH = 5_600_000;
const IMAGE_DATA_URI = /^data:(image\/(?:png|jpeg|webp|gif));base64,[A-Za-z0-9+/]+=*$/;

/**
 * What the browser posts to `api/messages`. `sessionId` is a random id the
 * page generates once and keeps in `localStorage` — it becomes the
 * `senderId`, so it's constrained to a shape that can't smuggle anything
 * into a session key or log line.
 */
export const WebChatInboundSchema = z
  .object({
    sessionId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "sessionId must be 16-64 URL-safe characters"),
    text: z.string().max(MAX_TEXT_LENGTH).optional(),
    quickReplyId: z.string().max(300).optional(),
    image: z.string().max(MAX_IMAGE_DATA_URI_LENGTH).regex(IMAGE_DATA_URI, "image must be a base64 PNG/JPEG/WebP/GIF data URI").optional(),
  })
  .refine((body) => Boolean(body.text?.trim() || body.quickReplyId || body.image), { message: "Send text, a quick reply, or an image" });
export type WebChatInbound = z.infer<typeof WebChatInboundSchema>;

/** What `api/messages` answers with — deliberately a small, rendering-oriented subset of `NormalizedResponse`. */
export interface WebChatReply {
  text?: string;
  quickReplies?: { id: string; label: string }[];
  /** Only images the page can display safely: https URLs or image `data:` URIs. */
  images?: string[];
}

function isDisplayableImage(url: string | undefined): url is string {
  return Boolean(url && (url.startsWith("https://") || IMAGE_DATA_URI.test(url)));
}

/**
 * `ChannelAdapter` for a browser chat page served by `createWebChatRouter`.
 * The channel id is per-brand (e.g. "web-gracesoft", "web-davdevs") so two
 * branded chats on one service keep separate sessions and show up as
 * separate channels in logs, exactly as Telegram and WhatsApp do.
 */
export class WebChatChannelAdapter implements ChannelAdapter {
  readonly channel: ChannelId;

  constructor(config: { channel: ChannelId }) {
    this.channel = config.channel;
  }

  parseInbound(payload: unknown): NormalizedMessage {
    const body = WebChatInboundSchema.parse(payload);
    const imageMime = body.image ? IMAGE_DATA_URI.exec(body.image)?.[1] : undefined;
    return {
      id: randomUUID(),
      channel: this.channel,
      senderId: body.sessionId,
      timestamp: new Date().toISOString(),
      text: body.text?.trim() || undefined,
      quickReplyId: body.quickReplyId,
      media: body.image ? [{ type: "image", url: body.image, mimeType: imageMime }] : undefined,
      // The raw body is logged/debugged elsewhere in this repo — keep a multi-megabyte image out of it.
      raw: { ...body, image: body.image ? "[image]" : undefined },
    };
  }

  formatOutbound(response: NormalizedResponse, _context: { recipientId: string }): WebChatReply {
    const images = (response.media ?? []).filter((m) => m.type === "image").map((m) => m.url).filter(isDisplayableImage);
    return {
      text: response.text,
      quickReplies: response.quickReplies?.map((qr) => ({ id: qr.id, label: qr.label })),
      images: images.length > 0 ? images : undefined,
    };
  }
}
