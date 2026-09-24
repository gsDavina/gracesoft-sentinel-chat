import type { ChannelAdapter, MediaType, NormalizedMedia, NormalizedMessage, NormalizedResponse, QuickReply } from "@gracesoft-sentinel/core";
import type { LineEvent, LineInboundEvent, LineMessage, LineQuickReply, LineSendRequest } from "./line-types.js";

/** LINE's own documented limits. */
const TEXT_MAX_LENGTH = 5000;
const QUICK_REPLY_LABEL_MAX_LENGTH = 20;
const QUICK_REPLY_MAX_ITEMS = 13;
const POSTBACK_DATA_MAX_LENGTH = 300;

const MEDIA_TYPES: Record<string, { type: MediaType; mimeType: string }> = {
  image: { type: "image", mimeType: "image/jpeg" },
  audio: { type: "audio", mimeType: "audio/m4a" },
  video: { type: "video", mimeType: "video/mp4" },
  file: { type: "document", mimeType: "application/octet-stream" },
};

export interface LineChannelAdapterConfig {
  /** Downloads a message's content by id (bearer-authenticated), inlined as a `data:` URI — see `line-api-client.ts`. */
  resolveMedia?: (messageId: string, mimeType: string) => Promise<{ url: string; mimeType: string }>;
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

/**
 * A 1:1 chat is keyed by the user alone. In a group/room the push target is
 * the group, but the conversation state belongs to each member, so the
 * sender id is `{groupOrRoomId}:{userId}` and `lineRecipientOf` recovers
 * the group half. LINE ids never contain ":".
 */
export function lineSenderIdOf(event: LineEvent): string | undefined {
  const { source } = event;
  if (source.type === "user") return source.userId;
  const container = source.groupId ?? source.roomId;
  if (!container) return undefined;
  return source.userId ? `${container}:${source.userId}` : container;
}

export function lineRecipientOf(senderId: string): string {
  const separator = senderId.indexOf(":");
  return separator === -1 ? senderId : senderId.slice(0, separator);
}

/**
 * Which webhook events are a person talking to the bot: text/media messages
 * and postbacks (a tapped quick reply), only in "active" mode, and never a
 * redelivery — the router acks before processing, so a redelivery only
 * means a slow ack, and answering it again would double-reply.
 */
export function isActionableLineEvent(event: LineEvent | undefined): boolean {
  if (!event || event.mode === "standby" || event.deliveryContext?.isRedelivery) return false;
  if (!lineSenderIdOf(event)) return false;
  if (event.type === "postback") return Boolean(event.postback?.data);
  if (event.type !== "message" || !event.message) return false;
  return event.message.type === "text" || event.message.type in MEDIA_TYPES;
}

/** `ChannelAdapter` for the LINE Messaging API — the only place in `channel-line` that knows LINE's own payload shapes. */
export class LineChannelAdapter implements ChannelAdapter {
  readonly channel = "line";
  private readonly resolveMedia: (messageId: string, mimeType: string) => Promise<{ url: string; mimeType: string }>;

  constructor(config: LineChannelAdapterConfig = {}) {
    this.resolveMedia =
      config.resolveMedia ??
      (() => {
        throw new Error("LineChannelAdapter: no `resolveMedia` configured — cannot handle an incoming media message");
      });
  }

  async parseInbound(payload: unknown): Promise<NormalizedMessage> {
    const { destination, event } = payload as LineInboundEvent;
    if (!isActionableLineEvent(event)) {
      throw new Error("LineChannelAdapter.parseInbound: event is not a user message or postback the bot should answer");
    }

    const base = {
      id: event.webhookEventId ?? event.message?.id ?? `${event.timestamp}`,
      channel: this.channel,
      senderId: lineSenderIdOf(event)!,
      timestamp: new Date(event.timestamp).toISOString(),
      businessChannelId: destination,
      raw: payload,
    };

    if (event.type === "postback") {
      return { ...base, text: event.postback!.data, quickReplyId: event.postback!.data };
    }

    const message = event.message!;
    if (message.type === "text") return { ...base, text: message.text };

    const mediaType = MEDIA_TYPES[message.type]!;
    const resolved = await this.resolveMedia(message.id, mediaType.mimeType);
    const media: NormalizedMedia[] = [{ type: mediaType.type, url: resolved.url, mimeType: resolved.mimeType }];
    return { ...base, media };
  }

  formatOutbound(response: NormalizedResponse, context: { recipientId: string }): LineSendRequest {
    const messages: LineMessage[] = [];
    if (response.text) messages.push({ type: "text", text: truncate(response.text, TEXT_MAX_LENGTH) });

    // LINE only fetches HTTPS image URLs — a `data:` URI can't be sent as an image message.
    const image = response.media?.find((m) => m.type === "image" && m.url?.startsWith("https://"));
    if (image) messages.push({ type: "image", originalContentUrl: image.url!, previewImageUrl: image.url! });

    // LINE rejects an empty batch, e.g. a media-only reply whose image is a `data:` URI.
    if (messages.length === 0) messages.push({ type: "text", text: "…" });

    if (response.quickReplies?.length) {
      // Quick replies render under the *last* message of the batch.
      messages[messages.length - 1]!.quickReply = buildQuickReply(response.quickReplies);
    }

    return { to: lineRecipientOf(context.recipientId), messages };
  }
}

function buildQuickReply(quickReplies: QuickReply[]): LineQuickReply {
  return {
    items: quickReplies.slice(0, QUICK_REPLY_MAX_ITEMS).map((qr) => ({
      type: "action",
      action: {
        type: "postback",
        label: truncate(qr.label, QUICK_REPLY_LABEL_MAX_LENGTH),
        data: qr.id.slice(0, POSTBACK_DATA_MAX_LENGTH),
        // What appears in the chat as the user's own message when tapped — the full label, not the truncated one.
        displayText: truncate(qr.label, TEXT_MAX_LENGTH),
      },
    })),
  };
}
