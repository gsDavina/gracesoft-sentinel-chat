import type { SlackPostMessageRequest } from "./slack-types.js";

const DEFAULT_API_BASE_URL = "https://slack.com/api";

export interface SlackApiClientConfig {
  /** Bot User OAuth Token (`xoxb-...`). Needs `chat:write`, plus `files:read` for inbound attachments. */
  botToken: string;
  apiBaseUrl?: string;
  /** Override point for tests — never a live network call in the test suite. */
  fetch?: typeof fetch;
}

export interface ResolvedSlackFile {
  /** A `data:` URI — `url_private` needs the bot token to fetch, so it's downloaded here rather than handed onward. */
  url: string;
  mimeType: string;
}

/** Thin wrapper over the Slack Web API — the only place in this package that makes HTTP calls to Slack. */
export class SlackApiClient {
  private readonly botToken: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: SlackApiClientConfig) {
    this.botToken = config.botToken;
    this.apiBaseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    this.fetchImpl = config.fetch ?? fetch;
  }

  async sendMessage(request: SlackPostMessageRequest): Promise<void> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/chat.postMessage`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.botToken}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(`Slack chat.postMessage failed: ${response.status} ${await response.text()}`);
    }
    // Slack reports most failures as HTTP 200 with `ok: false` — a status check alone would miss them.
    const body = (await response.json()) as { ok: boolean; error?: string };
    if (!body.ok) {
      throw new Error(`Slack chat.postMessage returned ok:false (${body.error ?? "unknown error"})`);
    }
  }

  async downloadFileAsDataUri(urlPrivate: string, mimeType: string): Promise<ResolvedSlackFile> {
    const response = await this.fetchImpl(urlPrivate, { headers: { Authorization: `Bearer ${this.botToken}` } });
    if (!response.ok) {
      throw new Error(`Slack file download failed: ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return { url: `data:${mimeType};base64,${bytes.toString("base64")}`, mimeType };
  }
}
