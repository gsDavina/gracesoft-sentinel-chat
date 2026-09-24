import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NormalizedMessage } from "@gracesoft-sentinel/core";
import { createWebChatChannel } from "./index.js";
import { TEST_THEME } from "./test-theme.js";

const SESSION = "0123456789abcdef0123";

describe("createWebChatRouter (mounted under a prefix)", () => {
  let server: Server;
  let base: string;
  const received: NormalizedMessage[] = [];
  const errors: unknown[] = [];

  beforeAll(async () => {
    const open = createWebChatChannel("web-test", TEST_THEME, {
      onMessage: async (message) => {
        received.push(message);
        if (message.text === "explode") throw new Error("agent failed");
        return { text: `echo: ${message.text}`, quickReplies: [{ id: "q1", label: "Again" }] };
      },
      onError: (err) => errors.push(err),
      copy: { productName: "Overridden Product" },
    });
    const gated = createWebChatChannel("web-gated", TEST_THEME, { onMessage: async () => ({ text: "secret" }), accessToken: "letmein" });

    const app = express();
    app.use("/chat/open", open.router);
    app.use("/chat/gated", gated.router);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  function postMessage(path: string, body: unknown, headers: Record<string, string> = {}) {
    return fetch(`${base}${path}/api/messages`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  }

  it("redirects the bare prefix to its trailing-slash form so relative URLs resolve under it", async () => {
    const res = await fetch(`${base}/chat/open`, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/chat/open/");
  });

  it("serves the themed page with a strict CSP and per-deployment copy overrides", async () => {
    const res = await fetch(`${base}/chat/open/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
    const html = await res.text();
    expect(html).toContain("Overridden Product");
    expect(html).toContain('data-requires-token="false"');
  });

  it("serves the generated theme stylesheet and the template's static assets", async () => {
    expect(await (await fetch(`${base}/chat/open/theme.css`)).text()).toContain("--chat-accent");
    const js = await fetch(`${base}/chat/open/assets/chat.js`);
    expect(js.status).toBe(200);
    expect(await js.text()).toContain("textContent");
    expect((await fetch(`${base}/chat/open/assets/chat.css`)).status).toBe(200);
    expect((await fetch(`${base}/chat/open/assets/../src/router.ts`)).status).toBe(404);
  });

  it("answers a message synchronously with the agent's reply", async () => {
    const res = await postMessage("/chat/open", { sessionId: SESSION, text: "hello" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: { text: "echo: hello", quickReplies: [{ id: "q1", label: "Again" }] } });
    expect(received.at(-1)).toMatchObject({ channel: "web-test", senderId: SESSION });
  });

  it("returns 400 for an invalid message and a JSON error for malformed JSON", async () => {
    expect((await postMessage("/chat/open", { sessionId: "short", text: "hi" })).status).toBe(400);
    const malformed = await fetch(`${base}/chat/open/api/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid_message" });
  });

  it("returns a graceful 500 when the agent throws, without leaking the error", async () => {
    const res = await postMessage("/chat/open", { sessionId: SESSION, text: "explode" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("agent failed");
    expect(errors).toHaveLength(1);
  });

  it("requires the access code on a gated chat", async () => {
    expect((await postMessage("/chat/gated", { sessionId: SESSION, text: "hi" })).status).toBe(401);
    expect((await postMessage("/chat/gated", { sessionId: SESSION, text: "hi" }, { authorization: "Bearer nope" })).status).toBe(401);
    const ok = await postMessage("/chat/gated", { sessionId: SESSION, text: "hi" }, { authorization: "Bearer letmein" });
    expect(ok.status).toBe(200);
    expect(await (await fetch(`${base}/chat/gated/`)).text()).toContain('data-requires-token="true"');
  });
});
