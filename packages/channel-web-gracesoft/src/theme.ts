import { fileURLToPath } from "node:url";
import type { WebChatTheme } from "@gracesoft-sentinel/web-chat-kit";

/**
 * GraceSoft's Purple/Black palette, from `_internal-docs/gracesoft-brand-guidelines.md`
 * (the 01 Sep 2026 revision). Dark mode follows the guideline's own role
 * table exactly; the guideline doesn't define light-mode roles, so light
 * mode reuses the same swatches with the same AA-contrast discipline.
 */
const PURPLE = {
  50: "#f2f1fb",
  100: "#e4e2f7",
  300: "#a79fe4",
  400: "#7c71d6",
  600: "#372aac",
} as const;

const BLACK = {
  50: "#f5f5f5",
  200: "#cccccc",
  300: "#b3b3b3",
  700: "#4d4d4d",
  800: "#333333",
  900: "#1a1a1a",
  950: "#000000",
} as const;

export const GRACESOFT_BRAND_ASSETS_DIR = fileURLToPath(new URL("../brand/", import.meta.url));

export const graceSoftTheme: WebChatTheme = {
  id: "gracesoft",
  brandName: "GraceSoft",
  productName: "Sentinel Chat",
  welcomeMessage: "Hi! I'm GraceSoft Sentinel. Ask me anything to get started.",
  inputPlaceholder: "Type a message…",
  footerNote: "You're chatting with an AI assistant — double-check anything important. Send /deletemydata to erase your data.",
  defaultScheme: "system",
  light: {
    background: BLACK[50],
    surface: "#ffffff",
    surfaceAlt: PURPLE[50],
    border: BLACK[200],
    text: BLACK[900],
    textMuted: BLACK[700],
    accent: PURPLE[600],
    accentFill: PURPLE[600],
    accentFillText: BLACK[50],
    botBubble: PURPLE[100],
    botBubbleText: BLACK[900],
    focusRing: PURPLE[400],
  },
  dark: {
    background: BLACK[950],
    surface: BLACK[900],
    surfaceAlt: BLACK[800],
    border: BLACK[700],
    text: BLACK[50],
    textMuted: BLACK[300],
    accent: PURPLE[300],
    accentFill: PURPLE[600],
    accentFillText: BLACK[50],
    botBubble: BLACK[800],
    botBubbleText: BLACK[50],
    focusRing: PURPLE[300],
  },
  fonts: {
    body: "'Montserrat', system-ui, sans-serif",
    display: "'Playfair Display', Georgia, serif",
    mono: "'Source Code Pro', ui-monospace, monospace",
    stylesheetHref:
      "https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,400;0,500;0,600;1,600;1,800&family=Playfair+Display:wght@600;700&family=Source+Code+Pro:wght@400;500&display=swap",
  },
  radius: "18px",
  // The company logo set (_internal-docs/assets/GraceSoft) — brand colours in light mode, white in dark. The
  // company logo rather than the "GraceSoft Sentinel" product wordmark, since the product name sits under it.
  logo: { light: "GS-LGO-C-SVG.svg", dark: "GS-LGO-W-SVG.svg", alt: "GraceSoft", height: 22 },
  favicon: "GS-ICN-PNG-S.png",
  brandAssetsDir: GRACESOFT_BRAND_ASSETS_DIR,
};
