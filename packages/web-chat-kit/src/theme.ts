/**
 * The design-token contract every branded web chat fills in. `public/chat.css`
 * (the template) is written *only* against the CSS custom properties these
 * tokens become, so a new brand is a new `WebChatTheme` object, not a new
 * stylesheet.
 */
export interface WebChatColorTokens {
  /** Page background. */
  background: string;
  /** Header, composer and other raised surfaces. */
  surface: string;
  /** Hover states and the quick-reply chip fill. */
  surfaceAlt: string;
  /** Decorative dividers only — never paired with text for contrast. */
  border: string;
  text: string;
  /** Secondary text; must clear 4.5:1 on `background` and `surface`. */
  textMuted: string;
  /** Links, icons and chip labels; must clear 4.5:1 on `background` and `surface`. */
  accent: string;
  /** Primary button / user-bubble fill. */
  accentFill: string;
  /** Text on `accentFill`; must clear 4.5:1 against it. */
  accentFillText: string;
  botBubble: string;
  botBubbleText: string;
  focusRing: string;
}

export interface WebChatFonts {
  /** CSS font-family stacks. */
  body: string;
  display: string;
  mono: string;
  /** A Google Fonts stylesheet URL loading the three families above. The page's CSP only allows fonts.googleapis.com/fonts.gstatic.com. */
  stylesheetHref?: string;
}

export interface WebChatLogo {
  /** File names inside the theme's `brandAssetsDir`, served under `brand/`. */
  light: string;
  dark: string;
  alt: string;
  /** Rendered height in px; width follows the image's own aspect ratio. */
  height?: number;
}

export type WebChatColorScheme = "light" | "dark";

export interface WebChatTheme {
  /** Stable id, also the default `localStorage` namespace — e.g. "gracesoft". */
  id: string;
  /** Shown as the document title and, with no logo, as the header text. */
  brandName: string;
  /** Shown under the logo, e.g. "Sentinel Assistant". Overridable per deployment. */
  productName: string;
  /** Rendered as the chat's first (bot) message. Plain text. */
  welcomeMessage: string;
  inputPlaceholder: string;
  /** Tiny print under the composer — e.g. an AI-disclosure line. Plain text. */
  footerNote?: string;
  /** Which scheme a first-time visitor sees; "system" follows `prefers-color-scheme`. The header toggle overrides it per browser. */
  defaultScheme: WebChatColorScheme | "system";
  light: WebChatColorTokens;
  dark: WebChatColorTokens;
  fonts: WebChatFonts;
  /** Bubble/chip corner radius, e.g. "18px". */
  radius: string;
  logo?: WebChatLogo;
  /**
   * Text wordmark used when there's no `logo` — segments flagged `accent`
   * render in the accent colour (e.g. the gold slash in "Dav/Devs").
   * Falls back to `brandName` in the display font.
   */
  wordmark?: { text: string; accent?: boolean }[];
  /** File name inside `brandAssetsDir`, served under `brand/`. */
  favicon?: string;
  /** Absolute directory holding the logo/favicon files — typically the branded package's own `brand/` folder. */
  brandAssetsDir?: string;
}

const TOKEN_VARIABLES: Record<keyof WebChatColorTokens, string> = {
  background: "--chat-bg",
  surface: "--chat-surface",
  surfaceAlt: "--chat-surface-alt",
  border: "--chat-border",
  text: "--chat-text",
  textMuted: "--chat-text-muted",
  accent: "--chat-accent",
  accentFill: "--chat-accent-fill",
  accentFillText: "--chat-accent-fill-text",
  botBubble: "--chat-bot-bubble",
  botBubbleText: "--chat-bot-bubble-text",
  focusRing: "--chat-focus",
};

/** Values end up inside a stylesheet — refuse anything that could close the declaration and inject more CSS. */
function assertSafeCssValue(value: string, name: string): string {
  if (/[;{}<>]/.test(value)) throw new Error(`WebChatTheme: unsafe CSS value for ${name}: ${JSON.stringify(value)}`);
  return value;
}

function declarations(tokens: WebChatColorTokens, scheme: WebChatColorScheme): string {
  const lines = (Object.keys(TOKEN_VARIABLES) as (keyof WebChatColorTokens)[]).map(
    (key) => `  ${TOKEN_VARIABLES[key]}: ${assertSafeCssValue(tokens[key], key)};`
  );
  lines.push(`  color-scheme: ${scheme};`);
  lines.push(`  --chat-logo-light-display: ${scheme === "light" ? "block" : "none"};`);
  lines.push(`  --chat-logo-dark-display: ${scheme === "dark" ? "block" : "none"};`);
  return lines.join("\n");
}

/**
 * Renders a theme to the stylesheet served as `theme.css`: the default
 * scheme on `:root`, the other scheme behind `[data-theme]` (set by the
 * header toggle), and — for `defaultScheme: "system"` — a
 * `prefers-color-scheme: dark` block that yields to an explicit choice.
 */
export function renderThemeCss(theme: WebChatTheme): string {
  const base: WebChatColorScheme = theme.defaultScheme === "dark" ? "dark" : "light";
  const other: WebChatColorScheme = base === "dark" ? "light" : "dark";
  const shared = [
    `  --chat-font-body: ${assertSafeCssValue(theme.fonts.body, "fonts.body")};`,
    `  --chat-font-display: ${assertSafeCssValue(theme.fonts.display, "fonts.display")};`,
    `  --chat-font-mono: ${assertSafeCssValue(theme.fonts.mono, "fonts.mono")};`,
    `  --chat-radius: ${assertSafeCssValue(theme.radius, "radius")};`,
    `  --chat-logo-height: ${theme.logo?.height ?? 28}px;`,
  ].join("\n");

  const blocks = [
    `:root {\n${shared}\n${declarations(theme[base], base)}\n}`,
    `:root[data-theme="${other}"] {\n${declarations(theme[other], other)}\n}`,
  ];
  if (theme.defaultScheme === "system") {
    blocks.push(`@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n${declarations(theme.dark, "dark").replace(/^/gm, "  ")}\n  }\n}`);
  }
  return `/* Generated from the "${theme.id}" WebChatTheme. */\n${blocks.join("\n\n")}\n`;
}
