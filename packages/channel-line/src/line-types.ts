/** LINE Messaging API webhook shapes — inbound only. */

export interface LineSource {
  type: "user" | "group" | "room";
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface LineEventMessage {
  id: string;
  type: "text" | "image" | "video" | "audio" | "file" | "location" | "sticker" | (string & {});
  text?: string;
}

export interface LineEvent {
  type: "message" | "postback" | "follow" | "unfollow" | "join" | "leave" | (string & {});
  /** "standby" means another channel (e.g. a human operator module) owns the chat right now — never answer those. */
  mode?: "active" | "standby";
  timestamp: number;
  source: LineSource;
  webhookEventId?: string;
  /** Free to reply with, but only valid for about a minute and only once. */
  replyToken?: string;
  message?: LineEventMessage;
  postback?: { data: string };
  deliveryContext?: { isRedelivery: boolean };
}

export interface LineWebhookBody {
  /** The bot's own user id — which of the business's LINE Official Accounts received this. */
  destination: string;
  events: LineEvent[];
}

/**
 * What `LineChannelAdapter.parseInbound` takes: one event plus the
 * `destination` it arrived for. A LINE webhook body batches several events;
 * the router splits it so each one is normalized and answered on its own.
 */
export interface LineInboundEvent {
  destination?: string;
  event: LineEvent;
}

/** LINE Messaging API send shapes — outbound only. */

export interface LinePostbackAction {
  type: "postback";
  label: string;
  data: string;
  displayText: string;
}

export interface LineQuickReply {
  items: { type: "action"; action: LinePostbackAction }[];
}

export type LineMessage =
  | { type: "text"; text: string; quickReply?: LineQuickReply }
  | { type: "image"; originalContentUrl: string; previewImageUrl: string; quickReply?: LineQuickReply };

/** Push-shaped (`to` + `messages`) — the router sends it as a reply instead whenever a fresh reply token exists. */
export interface LineSendRequest {
  to: string;
  messages: LineMessage[];
}
