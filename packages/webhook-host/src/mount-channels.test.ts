import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { signLineRequest } from "@gracesoft-sentinel/channel-line";
import { signSlackRequest } from "@gracesoft-sentinel/channel-slack";
import type { NormalizedMessage } from "@gracesoft-sentinel/core";
import { channelEnvShape, refineChannelEnv, type ChannelEnv } from "./channel-env.js";
import { mountChannels, type MountedChannel } from "./mount-channels.js";

const EnvSchema = z.object(channelEnvShape).superRefine(refineChannelEnv);

const ALL_ON: Record<string, string> = {
  WHATSAPP_ENABLED: "true",
  WHATSAPP_PHONE_NUMBER_ID: "pn-1",
  WHATSAPP_ACCESS_TOKEN: "wa-token",
  WHATSAPP_APP_SECRET: "wa-secret",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "wa-verify",
  TELEGRAM_ENABLED: "true",
  TELEGRAM_BOT_TOKEN: "tg-token",
  TELEGRAM_WEBHOOK_SECRET: "tg-secret",
  SLACK_ENABLED: "true",
  SLACK_BOT_TOKEN: "xoxb-1",
  SLACK_SIGNING_SECRET: "slack-secret",
  LINE_ENABLED: "true",
  LINE_CHANNEL_ACCESS_TOKEN: "line-token",
  LINE_CHANNEL_SECRET: "line-secret",
  WEB_GRACESOFT_ENABLED: "true",
  WEB_DAVDEVS_ENABLED: "true",
};

describe("channelEnvShape / refineChannelEnv", () => {
  it("requires credentials for each enabled channel", () => {
    const result = EnvSchema.safeParse({ SLACK_ENABLED: "true", LINE_ENABLED: "true" });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET", "LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET"]));
  });

  it("rejects a service with no channel enabled", () => {
    expect(EnvSchema.safeParse({}).error?.issues[0]?.message).toMatch(/At least one channel/);
  });

  it("accepts a web-chat-only service (no platform credentials needed)", () => {
    expect(EnvSchema.safeParse({ WEB_GRACESOFT_ENABLED: "true" }).success).toBe(true);
  });

  it("treats empty values from a copied .env.example as unset, not as invalid", () => {
    const env = EnvSchema.parse({ WEB_GRACESOFT_ENABLED: "true", WEB_CHAT_ACCESS_TOKEN: "", SMS_WEBHOOK_URL: "", WEB_CHAT_PRODUCT_NAME: "" });
    expect(env.WEB_CHAT_ACCESS_TOKEN).toBeUndefined();
    expect(env.WEB_CHAT_PRODUCT_NAME).toBeUndefined();
    expect(EnvSchema.safeParse({ WEB_GRACESOFT_ENABLED: "true", WEB_CHAT_ACCESS_TOKEN: "short" }).success).toBe(false);
  });

  it("respects an explicit \"false\" rather than coercing it to true", () => {
    expect(EnvSchema.parse({ WEB_GRACESOFT_ENABLED: "true", TELEGRAM_ENABLED: "false" }).TELEGRAM_ENABLED).toBe(false);
  });
});

describe("mountChannels — every channel at once", () => {
  let server: Server;
  let base: string;
  let mounted: MountedChannel[];
  let received: NormalizedMessage[] = [];
  let outbound: string[] = [];
  const realFetch = globalThis.fetch;

  async function waitForAsyncProcessing(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  beforeAll(async () => {
    // Stubbed before mounting: each platform API client captures `fetch` at
    // construction. Platform calls are recorded, never sent; calls to our own
    // test server pass through.
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      if (String(url).startsWith(base)) return realFetch(url, init);
      outbound.push(String(url));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const env = EnvSchema.parse(ALL_ON) as ChannelEnv;
    const app = express();
    mounted = mountChannels(app, {
      env,
      onMessage: async (message) => {
        received.push(message);
        return { text: `echo from ${message.channel}` };
      },
      onError: (channel, err) => {
        throw new Error(`${channel}: ${String(err)}`);
      },
      webChatDefaults: { productName: "Sentinel Test" },
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    received = [];
    outbound = [];
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    server.close();
  });

  const telegramUpdate = JSON.stringify({ update_id: 1, message: { message_id: 1, date: 1746000000, chat: { id: 42 }, text: "hi telegram" } });
  const whatsappPayload = JSON.stringify({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "pn-1" }, messages: [{ from: "6591234567", id: "wamid.1", timestamp: "1746000000", type: "text", text: { body: "hi whatsapp" } }] } }] }],
  });
  const whatsappSignature = `sha256=${createHmac("sha256", "wa-secret").update(whatsappPayload).digest("hex")}`;

  function postTelegram(path: string) {
    return realFetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "tg-secret" },
      body: telegramUpdate,
    });
  }

  function postWhatsApp(path: string) {
    return realFetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": whatsappSignature },
      body: whatsappPayload,
    });
  }

  it("reports every mounted channel and where it lives", () => {
    expect(mounted.map((m) => m.path)).toEqual([
      "/whatsapp/webhook",
      "/telegram/webhook",
      "/slack/webhook",
      "/line/webhook",
      "/chat/gracesoft/",
      "/chat/davdevs/",
    ]);
  });

  it("delivers WhatsApp and Telegram on their own paths while both are enabled (the old shared-path bug)", async () => {
    expect((await postWhatsApp("/whatsapp/webhook")).status).toBe(200);
    expect((await postTelegram("/telegram/webhook")).status).toBe(200);
    await waitForAsyncProcessing();
    expect(received.map((m) => m.channel).sort()).toEqual(["telegram", "whatsapp"]);
    expect(outbound.some((url) => url.includes("graph.facebook.com"))).toBe(true);
    expect(outbound.some((url) => url.includes("api.telegram.org"))).toBe(true);
  });

  it("keeps the legacy shared /webhook working for every platform, routed by signature header", async () => {
    expect((await postTelegram("/webhook")).status).toBe(200);
    expect((await postWhatsApp("/webhook")).status).toBe(200);

    const slackBody = JSON.stringify({ type: "event_callback", event: { type: "message", channel_type: "im", user: "U1", channel: "D1", text: "hi slack" } });
    const ts = Math.floor(Date.now() / 1000);
    const slack = await realFetch(`${base}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-slack-request-timestamp": String(ts), "x-slack-signature": signSlackRequest(slackBody, ts, "slack-secret") },
      body: slackBody,
    });
    expect(slack.status).toBe(200);

    const lineBody = JSON.stringify({ destination: "Ubot", events: [{ type: "message", timestamp: 1, source: { type: "user", userId: "U9" }, replyToken: "rt", message: { id: "m", type: "text", text: "hi line" } }] });
    const line = await realFetch(`${base}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-line-signature": signLineRequest(lineBody, "line-secret") },
      body: lineBody,
    });
    expect(line.status).toBe(200);

    await waitForAsyncProcessing();
    expect(received.map((m) => m.channel).sort()).toEqual(["line", "slack", "telegram", "whatsapp"]);
  });

  it("still answers WhatsApp's GET verification handshake on the legacy path", async () => {
    const res = await realFetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=wa-verify&hub.challenge=12345`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("12345");
  });

  it("403s an unsigned POST to the legacy path, same as before", async () => {
    const res = await realFetch(`${base}/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(403);
  });

  it("serves both branded web chats, each answering through the same onMessage with its own channel id", async () => {
    for (const [name, channel] of [["gracesoft", "web-gracesoft"], ["davdevs", "web-davdevs"]] as const) {
      const page = await realFetch(`${base}/chat/${name}/`);
      expect(await page.text()).toContain("Sentinel Test");
      const res = await realFetch(`${base}/chat/${name}/api/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "abcdefabcdefabcdef", text: "hi" }),
      });
      expect(await res.json()).toEqual({ reply: { text: `echo from ${channel}` } });
    }
  });
});

describe("mountChannels — nothing extra when channels are off", () => {
  it("mounts no legacy /webhook when only a web chat is enabled", async () => {
    const app = express();
    const mounted = mountChannels(app, {
      env: EnvSchema.parse({ WEB_GRACESOFT_ENABLED: "true", WEB_CHAT_ACCESS_TOKEN: "a-long-code" }) as ChannelEnv,
      onMessage: async () => ({ text: "x" }),
      onError: () => {},
    });
    expect(mounted).toEqual([{ name: "web-gracesoft", path: "/chat/gracesoft/", kind: "web-chat", gated: true }]);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook`, { method: "POST" });
    expect(res.status).toBe(404);
    server.close();
  });
});
