import { existsSync } from "node:fs";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditThemeContrast } from "@gracesoft-sentinel/web-chat-kit";
import { createGraceSoftWebChat, graceSoftTheme } from "./index.js";

describe("graceSoftTheme", () => {
  it("keeps every text pairing at WCAG AA in both light and dark mode", () => {
    expect(auditThemeContrast(graceSoftTheme)).toEqual([]);
  });

  it("ships every brand asset it references", () => {
    const files = [graceSoftTheme.favicon, graceSoftTheme.logo?.light, graceSoftTheme.logo?.dark].filter((f): f is string => Boolean(f));
    for (const file of files) expect(existsSync(join(graceSoftTheme.brandAssetsDir!, file)), file).toBe(true);
  });
});

describe("createGraceSoftWebChat", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const { adapter, router } = createGraceSoftWebChat({ onMessage: async (m) => ({ text: `echo: ${m.text}` }) });
    expect(adapter.channel).toBe("web-gracesoft");
    const app = express();
    app.use("/chat", router);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("serves the branded page, its brand assets, and a working message endpoint", async () => {
    const html = await (await fetch(`${base}/chat/`)).text();
    expect(html).toContain(`brand/${graceSoftTheme.logo!.light}`);
    expect((await fetch(`${base}/chat/brand/GS-LGO-C-SVG.svg`)).status).toBe(200);
    const res = await fetch(`${base}/chat/api/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "abcdefabcdefabcdef", text: "hi" }),
    });
    expect(await res.json()).toEqual({ reply: { text: "echo: hi" } });
  });
});
