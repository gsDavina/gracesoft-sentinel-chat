import { describe, expect, it } from "vitest";
import { runChannelAdapterContractTests } from "@gracesoft-sentinel/core/testing";
import { renderChatPage } from "./page.js";
import { renderThemeCss } from "./theme.js";
import { TEST_THEME } from "./test-theme.js";
import { WebChatChannelAdapter } from "./web-chat-adapter.js";

const SESSION = "0123456789abcdef0123";
const PNG = "data:image/png;base64,iVBORw0KGgo=";

runChannelAdapterContractTests("WebChatChannelAdapter", () => ({
  adapter: new WebChatChannelAdapter({ channel: "web-test" }),
  sampleInboundPayload: { sessionId: SESSION, text: "hello" },
  sampleResponse: { text: "hi", quickReplies: [{ id: "a", label: "A" }] },
  recipientId: SESSION,
}));

describe("WebChatChannelAdapter.parseInbound", () => {
  const adapter = new WebChatChannelAdapter({ channel: "web-test" });

  it("uses the browser session id as the sender and carries quick replies through", () => {
    const message = adapter.parseInbound({ sessionId: SESSION, text: " 9am ", quickReplyId: "slot-1" });
    expect(message).toMatchObject({ channel: "web-test", senderId: SESSION, text: "9am", quickReplyId: "slot-1" });
  });

  it("accepts an image data URI as media but keeps it out of `raw`", () => {
    const message = adapter.parseInbound({ sessionId: SESSION, image: PNG });
    expect(message.media).toEqual([{ type: "image", url: PNG, mimeType: "image/png" }]);
    expect((message.raw as { image?: string }).image).toBe("[image]");
  });

  it("rejects an empty message, a malformed session id, and a non-image data URI", () => {
    expect(() => adapter.parseInbound({ sessionId: SESSION, text: "   " })).toThrow();
    expect(() => adapter.parseInbound({ sessionId: "../../etc", text: "hi" })).toThrow(/sessionId/);
    expect(() => adapter.parseInbound({ sessionId: SESSION, image: "data:text/html;base64,PHNjcmlwdD4=" })).toThrow(/image/);
  });
});

describe("WebChatChannelAdapter.formatOutbound", () => {
  it("passes through only images the page can display safely", () => {
    const reply = new WebChatChannelAdapter({ channel: "web-test" }).formatOutbound(
      {
        text: "here",
        media: [
          { type: "image", url: "https://example.com/a.jpg" },
          { type: "image", url: "http://insecure.example.com/b.jpg" },
          { type: "image", url: "javascript:alert(1)" },
          { type: "image", url: PNG },
        ],
      },
      { recipientId: SESSION }
    );
    expect(reply.images).toEqual(["https://example.com/a.jpg", PNG]);
  });
});

describe("renderThemeCss", () => {
  it("renders the default scheme on :root, the other behind data-theme, and a system media query", () => {
    const css = renderThemeCss(TEST_THEME);
    expect(css).toContain(":root {");
    expect(css).toContain("--chat-bg: #ffffff;");
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root:not([data-theme="light"])');
  });

  it("puts a dark-first theme's dark tokens on :root with no system media query", () => {
    const css = renderThemeCss({ ...TEST_THEME, defaultScheme: "dark" });
    expect(css.split(':root[data-theme="light"]')[0]).toContain("--chat-bg: #000000;");
    expect(css).not.toContain("@media");
  });

  it("refuses a token value that could break out of its declaration", () => {
    expect(() => renderThemeCss({ ...TEST_THEME, radius: "4px; } body { display:none" })).toThrow(/unsafe CSS value/);
  });
});

describe("renderChatPage", () => {
  it("escapes every piece of theme copy", () => {
    const html = renderChatPage(TEST_THEME, { requiresAccessToken: false });
    expect(html).toContain("Test &lt;Brand&gt;");
    expect(html).toContain("Hi! &lt;b&gt;not bold&lt;/b&gt;");
    expect(html).not.toContain("<b>not bold</b>");
  });

  it("uses only relative URLs so the router can be mounted under any prefix", () => {
    const html = renderChatPage(TEST_THEME, { requiresAccessToken: true });
    expect(html).toContain('href="assets/chat.css"');
    expect(html).toContain('src="assets/chat.js"');
    expect(html).toContain('data-requires-token="true"');
    expect(html).not.toMatch(/(?:href|src)="\/(?!\/)/);
  });
});

describe("contrastRatio / auditThemeContrast", () => {
  it("matches WCAG's reference values", async () => {
    const { contrastRatio } = await import("./contrast.js");
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("flags a pairing below AA", async () => {
    const { auditThemeContrast } = await import("./contrast.js");
    const failures = auditThemeContrast({ ...TEST_THEME, light: { ...TEST_THEME.light, textMuted: "#bbbbbb" } });
    expect(failures.some((f) => f.scheme === "light" && f.foreground === "textMuted")).toBe(true);
  });
});
