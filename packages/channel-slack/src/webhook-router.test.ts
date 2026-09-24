import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedMessage } from "@gracesoft-sentinel/core";
import { signSlackRequest } from "./signature.js";
import { SlackChannelAdapter } from "./slack-adapter.js";
import { SlackApiClient } from "./slack-api-client.js";
import { createSlackWebhookRouter } from "./webhook-router.js";

const SECRET = "signing-secret";

async function waitForAsyncProcessing(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function signedHeaders(body: string, contentType = "application/json"): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    "content-type": contentType,
    "x-slack-request-timestamp": String(timestamp),
    "x-slack-signature": signSlackRequest(body, timestamp, SECRET),
  };
}

describe("createSlackWebhookRouter", () => {
  let server: Server;
  let baseUrl: string;
  let received: NormalizedMessage[];
  let sent: unknown[];

  beforeAll(async () => {
    const apiClient = new SlackApiClient({
      botToken: "t",
      fetch: (async (_url: string | URL, init?: RequestInit) => {
        sent.push(JSON.parse(init?.body as string));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch,
    });
    const app = express();
    app.use(
      createSlackWebhookRouter({
        signingSecret: SECRET,
        adapter: new SlackChannelAdapter(),
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

  it("rejects an unsigned request", async () => {
    const res = await fetch(`${baseUrl}/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(403);
  });

  it("answers the url_verification challenge", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    const res = await fetch(`${baseUrl}/webhook`, { method: "POST", headers: signedHeaders(body), body });
    expect(await res.json()).toEqual({ challenge: "abc123" });
  });

  it("dispatches a DM event and posts the reply back to the same channel", async () => {
    const body = JSON.stringify({ type: "event_callback", team_id: "T1", event: { type: "message", channel_type: "im", user: "U1", channel: "D1", text: "hello", ts: "1746000000.1" } });
    const res = await fetch(`${baseUrl}/webhook`, { method: "POST", headers: signedHeaders(body), body });
    expect(res.status).toBe(200);
    await waitForAsyncProcessing();
    expect(received[0]!.text).toBe("hello");
    expect(sent).toEqual([{ channel: "D1", text: "echo: hello" }]);
  });

  it("dispatches a form-encoded block_actions payload (a tapped button)", async () => {
    const payload = { type: "block_actions", user: { id: "U1" }, channel: { id: "D1" }, actions: [{ action_id: "quick_reply_0", value: "slot-1", text: { type: "plain_text", text: "9am" } }] };
    const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
    const res = await fetch(`${baseUrl}/webhook`, { method: "POST", headers: signedHeaders(body, "application/x-www-form-urlencoded"), body });
    expect(res.status).toBe(200);
    await waitForAsyncProcessing();
    expect(received[0]!.quickReplyId).toBe("slot-1");
  });

  it("acks but does not re-process a Slack retry", async () => {
    const body = JSON.stringify({ type: "event_callback", event: { type: "message", channel_type: "im", user: "U1", channel: "D1", text: "again" } });
    const res = await fetch(`${baseUrl}/webhook`, { method: "POST", headers: { ...signedHeaders(body), "x-slack-retry-num": "1" }, body });
    expect(res.status).toBe(200);
    await waitForAsyncProcessing();
    expect(received).toHaveLength(0);
  });

  it("acks but ignores the app's own (bot-authored) messages", async () => {
    const body = JSON.stringify({ type: "event_callback", event: { type: "message", channel_type: "im", bot_id: "B1", user: "U1", channel: "D1", text: "echo" } });
    await fetch(`${baseUrl}/webhook`, { method: "POST", headers: signedHeaders(body), body });
    await waitForAsyncProcessing();
    expect(received).toHaveLength(0);
  });
});
