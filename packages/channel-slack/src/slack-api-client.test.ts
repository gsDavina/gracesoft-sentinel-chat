import { describe, expect, it } from "vitest";
import { SlackApiClient } from "./slack-api-client.js";

describe("SlackApiClient.sendMessage", () => {
  it("POSTs chat.postMessage with the bot token", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const client = new SlackApiClient({
      botToken: "xoxb-test",
      fetch: (async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch,
    });
    await client.sendMessage({ channel: "D1", text: "hi" });
    expect(calls[0]!.url).toBe("https://slack.com/api/chat.postMessage");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer xoxb-test");
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({ channel: "D1", text: "hi" });
  });

  it("throws on Slack's HTTP-200-but-ok:false error shape", async () => {
    const client = new SlackApiClient({
      botToken: "t",
      fetch: (async () => new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), { status: 200 })) as typeof fetch,
    });
    await expect(client.sendMessage({ channel: "D1", text: "hi" })).rejects.toThrow(/channel_not_found/);
  });
});

describe("SlackApiClient.downloadFileAsDataUri", () => {
  it("downloads with the bot token and inlines the bytes", async () => {
    let authHeader: string | undefined;
    const client = new SlackApiClient({
      botToken: "xoxb-test",
      fetch: (async (_url: string | URL, init?: RequestInit) => {
        authHeader = (init?.headers as Record<string, string>).Authorization;
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }) as typeof fetch,
    });
    const resolved = await client.downloadFileAsDataUri("https://files.slack.com/x", "image/png");
    expect(authHeader).toBe("Bearer xoxb-test");
    expect(resolved.url).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`);
  });
});
