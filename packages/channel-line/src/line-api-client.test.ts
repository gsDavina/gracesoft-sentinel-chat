import { describe, expect, it } from "vitest";
import { LineApiClient } from "./line-api-client.js";

function recordingFetch(statusFor: (url: string) => number) {
  const calls: { url: string; body?: unknown; auth?: string }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
    });
    return new Response("{}", { status: statusFor(String(url)) });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("LineApiClient.replyOrPush", () => {
  const request = { to: "U1", messages: [{ type: "text" as const, text: "hi" }] };

  it("uses the free reply API when a token is available", async () => {
    const { calls, fetchImpl } = recordingFetch(() => 200);
    const client = new LineApiClient({ channelAccessToken: "tok", fetch: fetchImpl });
    expect(await client.replyOrPush("rt-1", request)).toBe("reply");
    expect(calls).toEqual([{ url: "https://api.line.me/v2/bot/message/reply", body: { replyToken: "rt-1", messages: request.messages }, auth: "Bearer tok" }]);
  });

  it("falls back to push when the reply token has expired", async () => {
    const { calls, fetchImpl } = recordingFetch((url) => (url.endsWith("/reply") ? 400 : 200));
    const client = new LineApiClient({ channelAccessToken: "tok", fetch: fetchImpl });
    expect(await client.replyOrPush("stale", request)).toBe("push");
    expect(calls[1]!.url).toBe("https://api.line.me/v2/bot/message/push");
    expect(calls[1]!.body).toEqual(request);
  });

  it("throws when push fails too", async () => {
    const { fetchImpl } = recordingFetch(() => 500);
    const client = new LineApiClient({ channelAccessToken: "tok", fetch: fetchImpl });
    await expect(client.replyOrPush(undefined, request)).rejects.toThrow(/500/);
  });
});

describe("LineApiClient.downloadContentAsDataUri", () => {
  it("fetches from the data API and prefers the served content type", async () => {
    const client = new LineApiClient({
      channelAccessToken: "tok",
      fetch: (async (url: string | URL) => {
        expect(String(url)).toBe("https://api-data.line.me/v2/bot/message/m-1/content");
        return new Response(new Uint8Array([7]), { status: 200, headers: { "content-type": "image/png" } });
      }) as typeof fetch,
    });
    const resolved = await client.downloadContentAsDataUri("m-1", "image/jpeg");
    expect(resolved).toEqual({ url: `data:image/png;base64,${Buffer.from([7]).toString("base64")}`, mimeType: "image/png" });
  });
});
