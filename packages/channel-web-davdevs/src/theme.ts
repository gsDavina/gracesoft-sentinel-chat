import { fileURLToPath } from "node:url";
import type { WebChatTheme } from "@gracesoft-sentinel/web-chat-kit";

/**
 * Dav/Devs' ink/cream/gold palette, from `_internal-docs/davdevs-brand-guidelines.md`.
 * Dark-first, as the guideline asks: ink background, cream text, gold used
 * sparingly for the accent (the logo's slash, links, the send button).
 */
const INK = {
  logo: "#101011",
  400: "#A9A9AD",
  700: "#59595E",
  800: "#434347",
  900: "#2F2F32",
  950: "#1E1E1F",
} as const;

const CREAM = {
  50: "#F8F8F6",
  100: "#F2F0ED",
  200: "#E6E0D6",
  300: "#D7CBB6",
} as const;

const GOLD = {
  400: "#D8B77E",
  500: "#D09F48",
  600: "#B58531",
  800: "#684F21",
} as const;

export const DAVDEVS_BRAND_ASSETS_DIR = fileURLToPath(new URL("../brand/", import.meta.url));

export const davDevsTheme: WebChatTheme = {
  id: "davdevs",
  brandName: "Dav/Devs",
  productName: "Assistant",
  welcomeMessage: "Hey — I'm Dav's assistant. Ask away.",
  inputPlaceholder: "Ask something…",
  footerNote: "AI assistant — answers can be wrong. Send /deletemydata to erase your data.",
  defaultScheme: "dark",
  dark: {
    background: INK.logo,
    surface: INK[950],
    surfaceAlt: INK[900],
    border: INK[800],
    text: CREAM[100],
    textMuted: INK[400],
    accent: GOLD[500],
    accentFill: GOLD[500],
    accentFillText: INK.logo,
    botBubble: INK[900],
    botBubbleText: CREAM[100],
    focusRing: GOLD[400],
  },
  light: {
    background: CREAM[50],
    surface: CREAM[100],
    surfaceAlt: CREAM[200],
    border: CREAM[300],
    text: INK.logo,
    textMuted: INK[700],
    // Gold 500 is far too light for text on cream, and even 700 dips to 3.8:1
    // on the cream-200 chip fill; 800 clears AA on every light surface.
    accent: GOLD[800],
    accentFill: GOLD[500],
    accentFillText: INK.logo,
    botBubble: CREAM[200],
    botBubbleText: INK.logo,
    focusRing: GOLD[600],
  },
  fonts: {
    body: "'Inter', system-ui, sans-serif",
    display: "'Syne', 'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
    stylesheetHref: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Syne:wght@700;800&display=swap",
  },
  radius: "14px",
  // The supplied logo set (_internal-docs/assets/DavDevs): black on cream in light mode — gold-on-cream is too faint
  // for a logo — and the brand-colour (gold) version on ink in dark mode.
  logo: { light: "DL-LGO-B-SVG.svg", dark: "DL-LGO-C-SVG.svg", alt: "davinaleong.com", height: 18 },
  favicon: "DL-ICN-C-SVG.svg",
  brandAssetsDir: DAVDEVS_BRAND_ASSETS_DIR,
};
