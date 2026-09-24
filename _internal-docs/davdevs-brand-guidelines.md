# davdevs.dev — Design Spec

## Overview
A personal developer portfolio for Dav, showcasing projects, skills, and experience. A secondary goal is selling a small number of ebooks, but this should feel like a natural extension of the portfolio rather than the main focus.

## Goals
- Establish credibility and showcase real project work
- Make it easy for visitors (recruiters, collaborators, clients) to see skills and get in touch
- Offer ebooks in a low-pressure, secondary spot — not a storefront-first experience

## Target Audience
- Recruiters and hiring managers
- Potential freelance clients or collaborators
- Other developers / peers
- Readers interested in the ebooks (smaller, secondary audience)

## Sitemap / Key Pages
- **Home** — intro, quick pitch, featured projects, links to everything else
- **Projects** — portfolio grid/list with case studies or write-ups
- **About** — background, skills, experience
- **Ebooks** — simple listing of available ebooks with purchase/download links
- **Contact** — email, social links, contact form (optional)

## Style Direction
- **Tone:** clean, technical, personal — not overly corporate
- **Colors:** dark-mode-first palette (ink background, cream foreground, gold accent), derived from the logo; light mode as secondary option
- **Typography:** Syne for headings/accents, Inter for body text, JetBrains Mono for code/technical accents
- **Visual style:** minimal, generous whitespace, subtle motion/hover states — avoid heavy decoration

## Typography
- **Display / Headings — Syne:** used for the logo, page titles, section headings, and standout accents (nav wordmark, hero text). Bold weights (600–800) recommended for headings.
- **Body / UI — Inter:** used for body copy, nav links, buttons, form fields, and all long-form or functional text. Regular/medium weights (400–500) for readability.
- **Monospace — JetBrains Mono:** used for code snippets, tags/labels, metadata (dates, stack/tech tags), and terminal-style accents. Built for code legibility (clear distinction between `0`/`O`, `1`/`l`/`I`) and reads as unmistakably "developer" without competing with Syne's more geometric personality. *Alternative:* Space Mono, if a more playful/retro mono feel is preferred — but it only ships in regular/bold, so it's better suited to short labels than longer inline code.
- Keep to one display font (Syne), one body font (Inter), and one mono font (JetBrains Mono) — no additional typefaces. Use Syne sparingly (headings, logo, callouts) so it retains its accent feel rather than becoming the default reading font; use the mono font for technical/code-adjacent moments only, not general UI text.

## Color System
Colors are extracted directly from the logo: **ink** (background), **cream** (wordmark), and **gold** (the accent slash). Each is expanded into a Tailwind-style 50–950 scale for use across backgrounds, text, borders, and states. The shade closest to the actual logo color is marked **(logo)**.

### Ink (background / neutral)
Base logo color: `#101011`

| Shade | Hex |
|---|---|
| 50 | #F7F7F7 |
| 100 | #EFEFF0 |
| 200 | #DDDDDE |
| 300 | #C6C6C8 |
| 400 | #A9A9AD |
| 500 | #898990 |
| 600 | #6F6F76 |
| 700 | #59595E |
| 800 | #434347 |
| 900 | #2F2F32 |
| 950 | #1E1E1F *(closest to logo — true logo hex is #101011, slightly darker)* |

### Cream (foreground / wordmark)
Base logo color: `#F5F0E8`

| Shade | Hex |
|---|---|
| 50 | #F8F8F6 |
| 100 | #F2F0ED *(logo)* |
| 200 | #E6E0D6 |
| 300 | #D7CBB6 |
| 400 | #C9B28D |
| 500 | #B9975F |
| 600 | #9F7D47 |
| 700 | #7D633B |
| 800 | #5C4A2D |
| 900 | #403421 |
| 950 | #272116 |

### Gold (accent)
Base logo color: `#D4A757`

| Shade | Hex |
|---|---|
| 50 | #F9F8F6 |
| 100 | #F4F1EC |
| 200 | #EAE1D2 |
| 300 | #E0CEAE |
| 400 | #D8B77E |
| 500 | #D09F48 *(logo)* |
| 600 | #B58531 |
| 700 | #8E6A2A |
| 800 | #684F21 |
| 900 | #473719 |
| 950 | #2C2212 |

**Usage guidance:**
- `ink-950` / `ink-900` — page background (dark mode)
- `cream-50` / `cream-100` — primary text on dark background, and page background in light mode
- `gold-500` / `gold-600` — accent: links, buttons, highlights, active states (use sparingly, as in the logo)
- Mid-range shades (300–700) of each color — borders, muted text, hover/disabled states

## Core Features
- Responsive layout (mobile, tablet, desktop)
- Project cards linking to live demos / repos / write-ups
- Ebooks section with clear pricing and a simple checkout or link-out to a payment provider
- Dark/light mode toggle
- Basic SEO (meta tags, OG image) and fast load times
- Contact method (email link or lightweight form)

## Out of Scope (for now)
- Full e-commerce cart/checkout system
- Blog/CMS (unless added later)
- User accounts or login