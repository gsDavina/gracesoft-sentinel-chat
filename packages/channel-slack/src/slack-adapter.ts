import type { ChannelAdapter, MediaType, NormalizedMedia, NormalizedMessage, NormalizedResponse, QuickReply } from "@gracesoft-sentinel/core";
import type {
  SlackBlock,
  SlackBlockActionsPayload,
  SlackEventCallbackPayload,
  SlackFile,
  SlackInboundPayload,
  SlackMessageEvent,
  SlackPostMessageRequest,
} from "./slack-types.js";

/** Slack's own documented limits for a section block's text and a button's label. */
const SECTION_TEXT_MAX_LENGTH = 3000;
const BUTTON_TEXT_MAX_LENGTH = 75;
const MAX_BUTTONS_PER_ACTIONS_BLOCK = 25;

export interface SlackChannelAdapterConfig {
  /** Downloads a Slack file's `url_private` (bot-token-authenticated), inlined as a `data:` URI — see `slack-api-client.ts`. */
  resolveMedia?: (urlPrivate: string, mimeType: string) => Promise<{ url: string; mimeType: string }>;
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

/**
 * `senderId` is `{slackChannelId}:{slackUserId}` — both halves are needed:
 * the channel is where a reply has to be posted (a DM's channel id is not
 * the user's id), and the user keeps two people @-mentioning the app in the
 * same public channel from sharing one conversation state.
 */
export function toSlackSenderId(channelId: string, userId: string): string {
  return `${channelId}:${userId}`;
}

export function slackChannelOf(senderId: string): string {
  const separator = senderId.indexOf(":");
  return separator === -1 ? senderId : senderId.slice(0, separator);
}

function mediaTypeOf(mimeType: string): MediaType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

/** Strips the leading `<@U123ABC>` an `app_mention` event's text always starts with. */
function stripMention(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  return text.replace(/^\s*<@[A-Z0-9]+>\s*/i, "").trim();
}

/**
 * Which Events API deliveries are actually a person talking to the app.
 * DMs arrive as `message` with `channel_type: "im"`; in shared channels the
 * app only responds to `app_mention` (a subscribed `message.channels` event
 * for the same post is ignored, or every mention would be answered twice).
 * Anything bot-authored — including this app's own replies — or carrying a
 * subtype other than `file_share` (edits, joins, deletions) is dropped.
 */
export function isActionableSlackEvent(event: SlackMessageEvent | undefined): boolean {
  if (!event || event.bot_id || !event.user || !event.channel) return false;
  if (event.subtype && event.subtype !== "file_share") return false;
  if (event.type === "app_mention") return true;
  return event.type === "message" && event.channel_type === "im";
}

/**
 * `ChannelAdapter` for Slack — the only place in `channel-slack` that knows
 * Slack's own payload shapes. Handles both Events API deliveries (messages,
 * mentions) and interactivity payloads (a tapped quick-reply button), since
 * the router funnels both through the same signed endpoint.
 */
export class SlackChannelAdapter implements ChannelAdapter {
  readonly channel = "slack";
  private readonly resolveMedia: (urlPrivate: string, mimeType: string) => Promise<{ url: string; mimeType: string }>;

  constructor(config: SlackChannelAdapterConfig = {}) {
    this.resolveMedia =
      config.resolveMedia ??
      (() => {
        throw new Error("SlackChannelAdapter: no `resolveMedia` configured — cannot handle an incoming file");
      });
  }

  async parseInbound(payload: unknown): Promise<NormalizedMessage> {
    const inbound = payload as SlackInboundPayload;
    if (inbound?.type === "block_actions") return this.parseBlockActions(inbound);
    if (inbound?.type === "event_callback") return this.parseEvent(inbound);
    throw new Error("SlackChannelAdapter.parseInbound: payload is neither an event_callback nor a block_actions payload");
  }

  private parseBlockActions(payload: SlackBlockActionsPayload): NormalizedMessage {
    const action = payload.actions[0];
    if (!action || !payload.channel?.id) {
      throw new Error("SlackChannelAdapter.parseInbound: block_actions payload has no action or channel");
    }
    return {
      id: payload.trigger_id ?? `${payload.user.id}:${action.action_id}:${Date.now()}`,
      channel: this.channel,
      senderId: toSlackSenderId(payload.channel.id, payload.user.id),
      timestamp: new Date().toISOString(),
      text: action.text?.text ?? action.value,
      quickReplyId: action.value,
      businessChannelId: payload.team?.id,
      raw: payload,
    };
  }

  private async parseEvent(payload: SlackEventCallbackPayload): Promise<NormalizedMessage> {
    const event = payload.event;
    if (!isActionableSlackEvent(event)) {
      throw new Error("SlackChannelAdapter.parseInbound: event is not a user message addressed to the app");
    }

    const media = await this.resolveFiles(event.files);
    const text = event.type === "app_mention" ? stripMention(event.text) : event.text;

    return {
      id: payload.event_id ?? event.ts ?? `${event.channel}:${Date.now()}`,
      channel: this.channel,
      senderId: toSlackSenderId(event.channel!, event.user!),
      timestamp: event.ts ? new Date(Number(event.ts) * 1000).toISOString() : new Date().toISOString(),
      text: text || undefined,
      media,
      businessChannelId: payload.team_id,
      raw: payload,
    };
  }

  private async resolveFiles(files: SlackFile[] | undefined): Promise<NormalizedMedia[] | undefined> {
    // Only the first file, matching every other channel's one-attachment-per-message shape.
    const file = files?.find((f) => f.url_private);
    if (!file) return undefined;
    const mimeType = file.mimetype ?? "application/octet-stream";
    const resolved = await this.resolveMedia(file.url_private!, mimeType);
    return [{ type: mediaTypeOf(mimeType), url: resolved.url, mimeType: resolved.mimeType }];
  }

  formatOutbound(response: NormalizedResponse, context: { recipientId: string }): SlackPostMessageRequest {
    const channel = slackChannelOf(context.recipientId);
    const text = response.text ?? "";
    const blocks: SlackBlock[] = [];

    // Slack can only render a publicly fetchable image URL — a `data:` URI
    // (what every inbound media path in this repo produces) is skipped
    // rather than sent as a broken block.
    const image = response.media?.find((m) => m.type === "image" && m.url && /^https?:\/\//.test(m.url));

    if (response.quickReplies?.length || image) {
      if (text) blocks.push({ type: "section", text: { type: "mrkdwn", text: truncate(text, SECTION_TEXT_MAX_LENGTH) } });
      if (image) blocks.push({ type: "image", image_url: image.url!, alt_text: image.caption ?? "image" });
      if (response.quickReplies?.length) blocks.push({ type: "actions", elements: buildButtons(response.quickReplies) });
    }

    return blocks.length > 0 ? { channel, text, blocks } : { channel, text };
  }
}

function buildButtons(quickReplies: QuickReply[]) {
  return quickReplies.slice(0, MAX_BUTTONS_PER_ACTIONS_BLOCK).map((qr, index) => ({
    type: "button" as const,
    // action_id must be unique within the block; the quick-reply id rides in `value`.
    action_id: `quick_reply_${index}`,
    text: { type: "plain_text" as const, text: truncate(qr.label, BUTTON_TEXT_MAX_LENGTH) },
    value: qr.id,
  }));
}
