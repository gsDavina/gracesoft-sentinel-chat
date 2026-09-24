import type { LineSendRequest } from "./line-types.js";

const DEFAULT_API_BASE_URL = "https://api.line.me/v2/bot";
const DEFAULT_DATA_API_BASE_URL = "https://api-data.line.me/v2/bot";

export interface LineApiClientConfig {
  /** Long-lived channel access token from the LINE Developers console. */
  channelAccessToken: string;
  apiBaseUrl?: string;
  dataApiBaseUrl?: string;
  /** Override point for tests — never a live network call in the test suite. */
  fetch?: typeof fetch;
}

export interface ResolvedLineContent {
  /** A `data:` URI — content downloads need the channel access token, so they're inlined here rather than handed onward. */
  url: string;
  mimeType: string;
}

/** Thin wrapper over the LINE Messaging API — the only place in this package that makes HTTP calls to LINE. */
export class LineApiClient {
  private readonly channelAccessToken: string;
  private readonly apiBaseUrl: string;
  private readonly dataApiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: LineApiClientConfig) {
    this.channelAccessToken = config.channelAccessToken;
    this.apiBaseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    this.dataApiBaseUrl = config.dataApiBaseUrl ?? DEFAULT_DATA_API_BASE_URL;
    this.fetchImpl = config.fetch ?? fetch;
  }

  private async post(path: string, body: unknown): Promise<void> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.channelAccessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`LINE ${path} failed: ${response.status} ${await response.text()}`);
    }
  }

  /** Push API — counts against the account's monthly message quota, so only used when a reply token can't be. */
  async sendMessage(request: LineSendRequest): Promise<void> {
    await this.post("/message/push", request);
  }

  /** Reply API — free, but the token is single-use and expires about a minute after the event. */
  async replyMessage(replyToken: string, request: LineSendRequest): Promise<void> {
    await this.post("/message/reply", { replyToken, messages: request.messages });
  }

  /**
   * Replies when a token is available and falls back to push when the reply
   * fails — the usual cause being a slow LLM answer outliving the token's
   * roughly one-minute lifetime.
   */
  async replyOrPush(replyToken: string | undefined, request: LineSendRequest): Promise<"reply" | "push"> {
    if (replyToken) {
      try {
        await this.replyMessage(replyToken, request);
        return "reply";
      } catch {
        // fall through to push
      }
    }
    await this.sendMessage(request);
    return "push";
  }

  async downloadContentAsDataUri(messageId: string, mimeType: string): Promise<ResolvedLineContent> {
    const response = await this.fetchImpl(`${this.dataApiBaseUrl}/message/${encodeURIComponent(messageId)}/content`, {
      headers: { Authorization: `Bearer ${this.channelAccessToken}` },
    });
    if (!response.ok) {
      throw new Error(`LINE content download failed: ${response.status}`);
    }
    const actualType = response.headers.get("content-type") ?? mimeType;
    const bytes = Buffer.from(await response.arrayBuffer());
    return { url: `data:${actualType};base64,${bytes.toString("base64")}`, mimeType: actualType };
  }
}
