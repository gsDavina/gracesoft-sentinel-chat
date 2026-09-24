/** Slack Events API / interactivity payload shapes — inbound only. */

export interface SlackFile {
  id: string;
  mimetype?: string;
  /** Requires the bot token as a Bearer header to download — never handed onward as-is. */
  url_private?: string;
}

export interface SlackMessageEvent {
  type: "message" | "app_mention" | (string & {});
  /** Present on bot-authored messages (including this app's own replies) — always ignored. */
  bot_id?: string;
  /** Edits, joins, deletions etc. all carry a subtype; only `file_share` is a real user message. */
  subtype?: string;
  user?: string;
  text?: string;
  channel?: string;
  /** "im" for a direct message to the app; "channel"/"group"/"mpim" otherwise. */
  channel_type?: string;
  ts?: string;
  files?: SlackFile[];
}

export interface SlackUrlVerificationPayload {
  type: "url_verification";
  challenge: string;
}

export interface SlackEventCallbackPayload {
  type: "event_callback";
  team_id?: string;
  event_id?: string;
  event_time?: number;
  event: SlackMessageEvent;
}

export interface SlackBlockAction {
  action_id: string;
  value?: string;
  text?: { type: string; text: string };
}

/** Delivered to the interactivity URL, form-encoded as `payload=<json>`. */
export interface SlackBlockActionsPayload {
  type: "block_actions";
  user: { id: string };
  channel?: { id: string };
  team?: { id: string };
  trigger_id?: string;
  actions: SlackBlockAction[];
}

export type SlackInboundPayload = SlackEventCallbackPayload | SlackBlockActionsPayload;

/** Slack Web API `chat.postMessage` body — outbound only. */
export interface SlackPostMessageRequest {
  channel: string;
  /** Always set, even alongside `blocks` — Slack uses it for notifications and as the accessibility fallback. */
  text: string;
  blocks?: SlackBlock[];
}

export type SlackBlock =
  | { type: "section"; text: { type: "mrkdwn" | "plain_text"; text: string } }
  | { type: "image"; image_url: string; alt_text: string }
  | { type: "actions"; elements: SlackButtonElement[] };

export interface SlackButtonElement {
  type: "button";
  action_id: string;
  text: { type: "plain_text"; text: string };
  value: string;
}
