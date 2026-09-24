import type { WebChatColorScheme, WebChatColorTokens, WebChatTheme } from "./theme.js";

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`contrastRatio: expected a #rrggbb colour, got ${JSON.stringify(hex)}`);
  const n = parseInt(match[1]!, 16);
  return 0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff);
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colours (1–21). */
export function contrastRatio(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x) as [number, number];
  return (a + 0.05) / (b + 0.05);
}

/** Every text-on-surface pairing the template actually renders. */
const TEXT_PAIRS: [keyof WebChatColorTokens, keyof WebChatColorTokens][] = [
  ["text", "background"],
  ["text", "surface"],
  ["textMuted", "background"],
  ["textMuted", "surface"],
  ["accent", "background"],
  ["accent", "surface"],
  ["accent", "surfaceAlt"],
  ["accentFillText", "accentFill"],
  ["botBubbleText", "botBubble"],
];

export interface ContrastFailure {
  scheme: WebChatColorScheme;
  foreground: keyof WebChatColorTokens;
  background: keyof WebChatColorTokens;
  ratio: number;
}

/**
 * Checks a theme's body-text pairings against WCAG AA (4.5:1) in both
 * schemes. Branded packages run this in their tests, so a palette tweak
 * that breaks legibility fails CI instead of shipping.
 */
export function auditThemeContrast(theme: WebChatTheme, minimum = 4.5): ContrastFailure[] {
  const failures: ContrastFailure[] = [];
  for (const scheme of ["light", "dark"] as const) {
    for (const [fg, bg] of TEXT_PAIRS) {
      const ratio = contrastRatio(theme[scheme][fg], theme[scheme][bg]);
      if (ratio < minimum) failures.push({ scheme, foreground: fg, background: bg, ratio: Math.round(ratio * 100) / 100 });
    }
  }
  return failures;
}
