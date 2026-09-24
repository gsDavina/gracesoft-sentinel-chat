import type { WebChatTheme } from "./theme.js";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderWordmark(theme: WebChatTheme): string {
  if (!theme.wordmark?.length) return escapeHtml(theme.brandName);
  return theme.wordmark
    .map((part) => (part.accent ? `<span class="chat-brand-accent">${escapeHtml(part.text)}</span>` : escapeHtml(part.text)))
    .join("");
}

export interface RenderChatPageOptions {
  requiresAccessToken: boolean;
}

/**
 * The page shell. Every URL in it is *relative* (`assets/…`, `brand/…`,
 * `api/messages`), so the same page works wherever a service mounts the
 * router — `/chat/gracesoft/`, `/`, behind a path-rewriting proxy. No inline
 * script or style: configuration rides on `data-*` attributes, which keeps
 * the Content-Security-Policy strict (`script-src 'self'`).
 */
export function renderChatPage(theme: WebChatTheme, options: RenderChatPageOptions): string {
  const title = `${theme.brandName} · ${theme.productName}`;
  const fontsLink = theme.fonts.stylesheetHref
    ? `<link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${escapeHtml(theme.fonts.stylesheetHref)}">`
    : "";
  const favicon = theme.favicon ? `<link rel="icon" href="brand/${escapeHtml(theme.favicon)}">` : "";
  const brand = theme.logo
    ? `<img class="chat-logo chat-logo--light" src="brand/${escapeHtml(theme.logo.light)}" alt="${escapeHtml(theme.logo.alt)}">
        <img class="chat-logo chat-logo--dark" src="brand/${escapeHtml(theme.logo.dark)}" alt="${escapeHtml(theme.logo.alt)}">`
    : `<span class="chat-brand-name">${renderWordmark(theme)}</span>`;
  const footer = theme.footerNote ? `<p class="chat-footnote">${escapeHtml(theme.footerNote)}</p>` : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)}</title>
  ${favicon}
  ${fontsLink}
  <link rel="stylesheet" href="assets/chat.css">
  <link rel="stylesheet" href="theme.css">
  <script src="assets/chat.js" defer></script>
</head>
<body>
  <main class="chat" id="chat"
        data-theme-id="${escapeHtml(theme.id)}"
        data-default-scheme="${escapeHtml(theme.defaultScheme)}"
        data-requires-token="${options.requiresAccessToken ? "true" : "false"}">
    <header class="chat-header">
      <div class="chat-brand">
        ${brand}
        <span class="chat-product">${escapeHtml(theme.productName)}</span>
      </div>
      <div class="chat-actions">
        <button type="button" class="chat-icon-button" id="chat-scheme" aria-label="Toggle light or dark mode" title="Toggle light or dark mode">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/></svg>
        </button>
        <button type="button" class="chat-icon-button" id="chat-reset" aria-label="Start a new conversation" title="Start a new conversation">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/></svg>
        </button>
      </div>
    </header>

    <section class="chat-log" id="chat-log" aria-live="polite" aria-label="Conversation">
      <div class="chat-row chat-row--bot">
        <p class="chat-bubble chat-bubble--bot">${escapeHtml(theme.welcomeMessage)}</p>
      </div>
    </section>

    <form class="chat-composer" id="chat-form" autocomplete="off">
      <label class="chat-attach" title="Attach a photo">
        <input type="file" id="chat-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5"/></svg>
        <span class="visually-hidden">Attach a photo</span>
      </label>
      <div class="chat-input-wrap">
        <p class="chat-attachment" id="chat-attachment" hidden></p>
        <textarea id="chat-input" rows="1" maxlength="4000" placeholder="${escapeHtml(theme.inputPlaceholder)}" aria-label="Message"></textarea>
      </div>
      <button type="submit" class="chat-send" id="chat-send">Send</button>
    </form>
    ${footer}
  </main>

  <dialog class="chat-dialog" id="chat-token-dialog">
    <form method="dialog" class="chat-dialog-form" id="chat-token-form">
      <h2>Access code</h2>
      <p>This demo is invite-only. Paste the access code you were given — it stays in this browser.</p>
      <input type="password" id="chat-token-input" required autocomplete="off" aria-label="Access code">
      <button type="submit" class="chat-send">Continue</button>
    </form>
  </dialog>
</body>
</html>
`;
}
