# GraceSoft Sentinel Chat

GraceSoft Sentinel's collection of AI chat agents — **Sentinel Concierge** (FAQ answering + appointment booking) and **Sentinel Cook** (dish-photo recipe generation) — rebuilt as platform-agnostic AI agents inside one pnpm monorepo.

Each agent is channel- and provider-agnostic: it depends only on small interfaces from `@gracesoft-sentinel/core` (`ChannelAdapter`, `AIProvider`, `CalendarProvider`, `SessionStore`, `RecipeSourceProvider`, ...), never on a concrete WhatsApp/Telegram/OpenAI/Google package directly. Concrete implementations live in their own packages and are wired together only at the service layer (`apps/*`). Every package is structured as if it could be split into its own repo tomorrow — own `package.json`, own `exports`, own tests — with `.dependency-cruiser.cjs` enforcing that boundary in CI.

## Status

All 11 planned milestones are complete. See [`_internal-docs/01-milestone-checklist.md`](_internal-docs/01-milestone-checklist.md) for the full build history and [`_internal-docs/05-progress-log.md`](_internal-docs/05-progress-log.md) for a narrated log of what was built and why. What's left is real infrastructure this repo can't provide on its own — live hosting, live OpenAI/Google/WhatsApp/Telegram credentials, and manual/live-LLM validation — each such item is explicitly annotated rather than silently skipped.

## Architecture

```
apps/
  concierge-service/   Sentinel Concierge — HTTP service wiring agent-concierge to every provider
  cook-service/         Sentinel Cook — HTTP service wiring agent-cook to every provider
  demo-service/          Concierge + Cook + GraceSoft Assistant behind one agent-switcher, one chat window
  assistant-service/     GraceSoft Assistant (Demo) — standalone HTTP API + minimal chat UI
  legal-site/            Static privacy-policy / terms pages for both agents

packages/
  core/                          Shared Zod contracts: NormalizedMessage, ChannelAdapter, AIProvider,
                                  CalendarProvider, SessionStore, BusinessConfig, RecipeSourceProvider, ...
  agent-concierge/               FAQ + booking agent logic — channel/provider-agnostic
  agent-cook/                    Recipe agent logic — channel/provider-agnostic
  agent-assistant/                GraceSoft Assistant (Demo) core — snapshot loader, deterministic query
                                  layer, tool-use loop over AIProvider, golden-set eval suite
  agent-switcher/                 Wraps N independently-composed agents behind one onMessage, for demo-service

  channel-whatsapp/              ChannelAdapter: WhatsApp Cloud API
  channel-telegram/              ChannelAdapter: Telegram Bot API
  channel-sms/                   ChannelAdapter: SMS/MMS via Twilio

  provider-ai-openai/            AIProvider: OpenAI (chat, vision, embeddings, Whisper transcription)
  provider-ai-gemini/            AIProvider: Google Gemini
  provider-calendar-google/      CalendarProvider: Google Calendar
  provider-session-redis/        SessionStore: Redis
  provider-recipe-pinecone/      RecipeSourceProvider: personal recipe retrieval via RAG, queried from Pinecone
  provider-drive-google/         Drive I/O only — feeds provider-recipe-pinecone's Drive→Pinecone sync job

  logging/                       Structured logging (pino) + PII redaction
  logging-postgres/               Conversation/booking audit logging to Postgres
  legal-concierge/, legal-cook/   Static legal/PDPA content packages consumed by legal-site

  config-eslint/, config-tsconfig/  Shared lint/TS config
```

**Data flow:** a channel webhook hits an `apps/*-service` route → the matching `ChannelAdapter.parseInbound()` turns it into a `NormalizedMessage` → the service layer resolves session state and business config, then calls the agent's `handleMessage()` → the agent calls whatever `AIProvider`/`CalendarProvider`/`RecipeSourceProvider` it was given → the result flows back through `ChannelAdapter.formatOutbound()` to the channel's own reply API.

Notable capabilities: multi-tenant `BusinessConfig` resolution (multiple businesses on one Concierge deployment, keyed by `NormalizedMessage.businessChannelId`), voice-note transcription, grocery-list/meal-plan generation, an opt-in "Mother's Day Edition" personal-recipe RAG lookup, and free recipe search by dish name ("recipe for chicken noodle soup" → a generic home-style recipe, no photo or personal source needed) — all documented in the progress log.

## Getting started

Requires Node.js ≥ 20 and pnpm.

```bash
pnpm install
```

Common workspace-wide commands (each runs across every package):

```bash
pnpm build        # tsc -b for every package
pnpm test         # vitest for every package
pnpm lint         # eslint for every package
pnpm typecheck    # tsc --noEmit for every package
pnpm boundaries   # dependency-cruiser package-boundary check
pnpm test:integration  # root-level cross-channel/cross-package tests (tests/)
```

To work on a single package: `pnpm --filter @gracesoft-sentinel/<name> <script>`.

> Rebuild order matters: `@gracesoft-sentinel/core` must be built before any package that depends on it (most of them), since `tsc -b` resolves workspace dependencies via their compiled `dist/*.d.ts`, not source.

## Running a service locally

Each service under `apps/` needs its own `.env` (see the `.env.example` in that directory) with real OpenAI/Google/WhatsApp/Telegram/Twilio credentials — nothing in this repo fabricates those. `docker-compose.yml` at the root brings up Redis, Postgres, and both services together:

```bash
docker compose up --build
```

## API documentation

[`docs/`](docs/index.html) has a branded HTML reference covering webhook endpoints per channel (auth requirements, payload handling), the core data contracts (`NormalizedMessage`, `BusinessConfig`, provider interfaces), and multi-tenant setup. Open `docs/index.html` directly in a browser, or serve it locally:

```bash
npx serve docs
```

## GraceSoft Assistant (Demo)

A third, separate demo product: an LLM chatbot that answers questions about a redacted snapshot of GraceSoft Desk (time/finance) and GraceSoft Skylight (kanban board) data — "What's overdue?", "How many billable hours did I log in August?", "How is Project 4 performing?" — never doing arithmetic itself, always grounding every number in a deterministic query function. Full spec, build history and current status: [`_internal-docs/08-assistant-milestone.md`](_internal-docs/08-assistant-milestone.md) / [`08-assistant-progress-log.md`](_internal-docs/08-assistant-progress-log.md) / [`08-assistant-test-checklist.md.md`](_internal-docs/08-assistant-test-checklist.md.md).

**Setup — standalone (`apps/assistant-service`):**
```bash
cp apps/assistant-service/.env.example apps/assistant-service/.env
# fill in OPENAI_API_KEY and DEMO_TOKEN
pnpm --filter @gracesoft-sentinel/agent-assistant run build
pnpm --filter @gracesoft-sentinel/assistant-service run build
pnpm --filter @gracesoft-sentinel/assistant-service run start
```
Opens a chat UI at `http://localhost:3004` (the port in `.env.example`) — paste the `DEMO_TOKEN` once when prompted. No Redis or Postgres needed: sessions are in-memory, by design, for a single-process demo.

**Setup — inside demo-service:** set `ASSISTANT_ENABLED=true` and `ASSISTANT_SNAPSHOT_DIR` in `apps/demo-service/.env` (see that file's own comments), then run demo-service as usual. Reachable via the `/assistant` trigger phrase in whichever channel demo-service is already wired to; `DEMO_DEFAULT_AGENT=assistant` makes it the default instead of Concierge.

**Config:** both versions are entirely env-driven — see each app's `.env.example` for the full list (model, as-of date, snapshot path, tool-loop limits, rate limits, the daily model-call cap). No config is hand-edited in code.

**Refreshing the snapshot:** point `SNAPSHOT_DIR`/`ASSISTANT_SNAPSHOT_DIR` at a new directory of the same 17 JSON tables (see `packages/agent-assistant/data/snapshot/valid/` for the exact shape each table must match, and `src/types/desk.ts`/`src/types/skylight.ts` for the schemas). `loadSnapshot` validates referential integrity and scans for unredacted emails/URLs/phone numbers/account numbers/file paths on every load — a bad or under-redacted snapshot fails loudly at boot, not silently at query time.

**Known limits:**
- No real Desk/Skylight export has been ingested — every number in the current snapshot comes from a hand-built fixture (`packages/agent-assistant/data/snapshot/valid/`), not a live business.
- SSE streaming (`POST /chat?stream=1`) is not token-level — `AIProvider` has no streaming capability anywhere in this repo, so it sends the finished answer as one event.
- No real spend/cost tracking — `AIProvider` exposes no token usage or pricing, so the "daily spend cap" is actually a daily call-count cap, and the eval suite reports latency, not cost.
- The golden-set eval suite (`pnpm --filter @gracesoft-sentinel/assistant-service run eval`) and demo-service's `/assistant` CI wiring both need a real `OPENAI_API_KEY`, which hasn't been exercised in this environment — see the M6 entry in the progress log for exactly what is and isn't verified without one.
- Droplet deployment (systemd, HTTPS) is not done — needs real infrastructure this repo can't provide.

## Contracts and testing philosophy

Every interface in `core` ships with a shared contract test suite (e.g. `runChannelAdapterContractTests`, `runAIProviderContractTests`) that every implementation runs against — so a WhatsApp adapter and a from-scratch SMS adapter are held to the exact same behavioral guarantees. Package boundaries (no agent importing a concrete channel/provider, no package reaching into another's internals) are enforced by `.dependency-cruiser.cjs` and checked in CI (`.github/workflows/ci.yml`).

## License

See [`LICENSE`](LICENSE).
