import type { WebChatColorTokens, WebChatTheme } from "./theme.js";

const light: WebChatColorTokens = {
  background: "#ffffff",
  surface: "#fafafa",
  surfaceAlt: "#eeeeee",
  border: "#dddddd",
  text: "#111111",
  textMuted: "#555555",
  accent: "#0044cc",
  accentFill: "#0044cc",
  accentFillText: "#ffffff",
  botBubble: "#eeeeee",
  botBubbleText: "#111111",
  focusRing: "#0044cc",
};

/** A deliberately plain theme for the kit's own tests — branded packages supply real ones. */
export const TEST_THEME: WebChatTheme = {
  id: "test",
  brandName: "Test <Brand>",
  productName: "Test Chat",
  welcomeMessage: "Hi! <b>not bold</b>",
  inputPlaceholder: "Say something",
  defaultScheme: "system",
  light,
  dark: { ...light, background: "#000000", text: "#ffffff" },
  fonts: { body: "system-ui, sans-serif", display: "system-ui, sans-serif", mono: "monospace" },
  radius: "16px",
};
