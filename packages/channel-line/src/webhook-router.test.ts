import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedMessage } from "@gracesoft-sentinel/core";
import { LineChannelAdapter } from "./line-adapter.js";
import { LineApiClient } from "./line-api-client.js";
import { signLineRequest, verifyLineSignature } from "./signature.js";
import { createLineWebhookRouter } from "./webhook-router.js";

const SECRET = "channel-secret";

async function waitForAsyncProcessing(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("verifyLineSignature", () => {
  it("accepts LINE's base64 HMAC and rejects anything else", () => {
    expect(verifyLineSignature("body", signLineRequest("body", SECRET), SECRET)).toBe(true);
    expect(verifyLineSignature("body!", signLineRequest("body", SECRET), SECRET)).toBe(false);
    expect(verifyLineSignature("body", undefined, SECRET)).toBe(false);
    expect(verifyLineSignature("body", "short", SECRET)).toBe(false);
  });
});

describe("createLineWebhookRouter", () => {
  let server: Server;
  let baseUrl: string;
  let received: NormalizedMessage[];
  let sent: { url: string; body: unknown }[];

  beforeAll(async () => {
    const apiClient = new LineApiClient({
      channelAccessToken: "tok",
      fetch: (async (url: string | URL, init?: RequestInit) => {
        sent.push({ url: String(url), body: JSON.parse(init?.body as string) });
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    const app = express();
    app.use(
      createLineWebhookRouter({
        channelSecret: SECRET,
        adapter: new LineChannelAdapter(),
        apiClient,
        onMessage: async (message) => {
          received.push(message);
          return { text: `echo: ${message.text}` };
        },
        onError: (err) => {
          throw err;
        },
      })
    );
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    received = [];
    sent = [];
  });

  afterAll(() => {
    server.close();
  });

  function post(body: string, signature = signLineRequest(body, SECRET)) {
    return fetch(`${baseUrl}/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-line-signature": signature }, body });
  }

  it("rejects a bad signature", async () => {
    expect((await post("{}", "bad")).status).toBe(403);
  });

  it("acks the console's empty verification request", async () => {
    expect((await post(JSON.stringify({ destination: "Ubot", events: [] }))).status).toBe(200);
  });

  it("answers every actionable event in a batch via the reply API, skipping the rest", async () => {
    const event = (id: string, text: string) => ({
      type: "message",
      mode: "active",
      timestamp: 1746000000000,
      source: { type: "user", userId: id },
      replyToken: `rt-${id}`,
      message: { id: `m-${id}`, type: "text", text },
    });
    const body = JSON.stringify({
      destination: "Ubot",
      events: [event("U1", "one"), { type: "follow", timestamp: 1, source: { type: "user", userId: "U3" } }, event("U2", "two")],
    });
    expect((await post(body)).status).toBe(200);
    await waitForAsyncProcessing();
    expect(received.map((m) => m.text).sort()).toEqual(["one", "two"]);
    expect(sent.map((s) => s.url)).toEqual(["https://api.line.me/v2/bot/message/reply", "https://api.line.me/v2/bot/message/reply"]);
  });
});
