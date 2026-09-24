# GraceSoft Assistant (Demo): Milestones

An LLM-powered chatbot that answers questions about a redacted snapshot of GraceSoft Desk and GraceSoft Skylight data (10 Jul 2026 to 10 Sep 2026): overdue tasks, financial status over a period, billable hours, project performance, and cross-tool questions.

It ships in two forms from one shared core:

1. **Standalone service**: runs on its own, with its own HTTP API and a minimal chat UI.
2. **Demo-service integration**: the same assistant, packaged to drop into the existing demo-service.

---

## Guiding principles

- **The LLM never does arithmetic.** Every number (hours, totals, balances, counts) comes from a deterministic query function. The model picks the tools, fills in their parameters and phrases the answer.
- **Snapshot time, not wall-clock time.** "Today" for the assistant is the snapshot's as-of date (default **10 Sep 2026**, Asia/Singapore). "Overdue", "this month" and "last 30 days" are resolved against it.
- **Stay inside the snapshot.** Questions about dates outside 10 Jul to 10 Sep 2026 get "that isn't in the snapshot", never "zero".
- **Pseudonyms are final.** Never guess the real names or values behind "Project 4", "Vendor 7", `[email]` and so on.
- **Snapshot text is data, not instructions.** Card titles, comments, notes and transaction notes can't change the assistant's behaviour.
- **One core, two shells.** All data, query and LLM logic lives in the core. The standalone service and the demo-service integration are thin wrappers around it.

## Proposed layout

Node/TypeScript, in line with the existing Telegram assistant.

```
gracesoft-assistant/
├─ packages/
│  ├─ core/            # snapshot loader, query functions, tool definitions, LLM orchestration
│  └─ demo-adapter/    # integration build for demo-service
├─ apps/
│  └─ standalone/      # Fastify HTTP API + minimal chat UI
├─ data/snapshot/      # redacted Desk + Skylight exports (not committed if sensitive)
└─ evals/              # golden questions + expected answers
```

---

## M0: Decisions and scaffolding

**Goal:** settle the choices that everything else depends on.

- [x] Confirm the snapshot export format (JSON or CSV, one file per table) and document the schema for every entity:
  - Desk: projects, time entries, stages, transactions, accounts, payment methods, categories, vendors, services, documents (metadata only).
  - Skylight: boards, columns, cards, labels, tags, checklists and their items, comments, notes, activity log.
  - Decided: JSON, one file per table (`packages/agent-assistant/data/snapshot/valid/*.json`), Zod schemas in `src/types/desk.ts` / `src/types/skylight.ts`.
- [x] Fix the as-of date (default 10 Sep 2026 SGT) and make it a config value.
  - Threaded as `QueryContext.asOfDate` / `LoadSnapshotOptions.asOfDate`; will land as an env var in M4.
- [x] Pick the model and set a per-request token cap.
  - Decided (deviates from the spec's "Claude Haiku/Sonnet" suggestion): this repo has no Anthropic provider (`provider-ai-openai`/`provider-ai-gemini` only), so the assistant reuses `AIProvider`/`OpenAIProvider` like every other agent here rather than adding a new provider package. Model choice and token cap are `AssistantConfig` fields (M3), defaulting to a cost-tier model.
- [x] Decide the in-memory store (plain typed arrays with indexes, or SQLite/DuckDB loaded at boot).
  - Decided: plain typed arrays + `Map` indexes, loaded once at boot (`loadSnapshot`) — matches the snapshot's size (tens, not millions, of rows).
- [x] Get the demo-service integration contract (see *Open questions*).
  - Resolved: `agent-switcher`'s `RegisteredAgent { name, label, triggers, onMessage }` — see *Open questions* below.
- [x] Scaffold the monorepo: TypeScript strict mode, lint, test runner (Vitest), CI.
  - `packages/agent-assistant` added, following the exact `agent-cook`/`agent-concierge` package shape (`config-tsconfig`, `config-eslint`, Vitest). No separate CI config needed — the root `pnpm -r run {test,lint,typecheck}` scripts already cover every workspace package.

**Exit criteria:** the schema doc is written, config keys are defined, and the repo builds with an empty test passing in CI. ✅ Done — see `packages/agent-assistant`.

## M1: Snapshot ingestion and validation

**Goal:** load the redacted data reliably and refuse bad data loudly.

- [x] Loader for Desk and Skylight exports into typed models, validated with Zod. (`src/loader/snapshot-loader.ts`)
- [x] Referential-integrity checks: time entries point to real projects and stages, transactions to real accounts, methods, categories and vendors, cards to real columns and boards, checklist items to real checklists.
- [x] Cross-tool mapping: match Skylight boards to Desk projects by shared pseudonym, and log any that don't match.
- [x] Date-range check: flag any record dated outside 10 Jul to 10 Sep 2026.
- [x] Redaction scan: fail the load if raw emails, URLs, phone numbers, account numbers or file paths are found anywhere, including notes and comments. (`src/loader/redaction-scan.ts`)
- [x] Normalise money (integer cents, currency), durations (minutes) and timestamps (UTC stored, SGT for day boundaries). (`src/loader/normalize.ts`)
- [x] Load summary on boot: record counts per entity, date span and warnings.

**Exit criteria:** the real snapshot loads with zero integrity errors, and a deliberately broken fixture fails with clear messages. ✅ Done — no separate "real" snapshot exists yet (no live Desk/Skylight export has been handed off), so a hand-built, internally-consistent fixture (`data/snapshot/valid/`) stands in for it; negative-path tests mutate copies of that fixture rather than hand-authoring a parallel broken one (`src/loader/test-support.ts`). 26 loader/redaction/normalize tests passing.

## M2: Deterministic query layer

**Goal:** a tested function for every kind of question the demo should answer. No LLM involved yet.

**Desk: time and projects**
- [x] Hours logged (total, billable, non-billable) by period and project (`hoursForPeriod`); by stage across all time (`stageBreakdown`). *Not yet combined into one period+stage grouped view — no golden question needs it; noted as a small gap in the progress log.*
- [x] Billable value (hours × project rate) by period and project (`billableValueForPeriod`); by stage across all time (`stageBreakdown`). Same stage+period gap as above.
- [x] Current stage of a project (the rule is defined and documented: the stage of its most recent time entry — `currentStage`).
- [x] Project summary: status, dates, rate, hours to date, billable value, stage breakdown, last activity. (`projectSummary`)
- [x] Commit-derived versus manual time entries (commit tracking only exists from 1–3 Aug 2026). (`commitVsManualForPeriod`, enforced at load time too)

**Desk: finance**
- [x] Income, expenses and net for a period, broken down by category, vendor, account and payment method. (`financeForPeriod` — posted transactions only; pending/outstanding are surfaced separately, see below)
- [x] Cash position and account balances as of a date. (`cashPosition`)
- [x] Pending and outstanding items. (`pendingAndOutstanding`)
- [x] Monthly summary (mirrors Desk's Monthly Summary report). (`monthlySummary`)
- [x] Vendor spend, for example SaaS spend for a given month. (`categorySpendForPeriod`) *Service-level spend deferred — the snapshot's `services` table isn't yet linked to `transactions`; nothing in the golden set needs it.*

**Skylight**
- [x] Overdue cards and cards due on a given date, relative to the as-of date. (`overdueCards`, `cardsDueOn`)
- [x] Cards by board, column, label and tag. "What's in progress on Project 4?" (`cardsBy`)
- [x] Checklist progress per card, with the remaining items listed. (`checklistProgress`)
- [x] Cards completed in a period, using activity-log moves into Done. (`cardsCompletedInPeriod` — also handles moved-in-then-out-again correctly)
- [x] Recent activity on a board or card, including comments and notes. (`recentActivity`)
- [x] Search boards by name and cards by title. (`searchBoards`, `searchCards`)

**Cross-tool**
- [x] Project health: Desk hours and billable value alongside Skylight open, overdue and done counts for the same pseudonym. (`projectHealth`)
- [x] Time spent in the period during which cards were completed on a board (clearly labelled as correlation, since the tools don't sync). (`timeVsCompletionCorrelation`)

**Shared helpers**
- [x] Period resolver: "August", "last month", "last 30 days", "Q3 so far", "this week" are turned into explicit date ranges against the as-of date and clipped to the snapshot, with a flag saying whether clipping happened. (`resolvePeriod`)
- [x] Every result includes its source tool, the date range actually used and any caveats (clipped range, no data, unmatched board). (`QueryResult<T>` envelope)

**Exit criteria:** every function has unit tests against a small hand-built fixture with hand-calculated answers. ✅ Done — 47 query-layer tests (period, time, finance, skylight, cross-tool) against the M1 fixture, all values hand-computed independently of the implementation before being asserted.

## M3: LLM orchestration

**Goal:** turn natural-language questions into tool calls and grounded answers.

- [x] Expose each M2 function as a tool with a tight JSON schema (enums for stage names, ISO dates, pseudonym IDs). (`src/tools/definitions.ts` — 22 tools, Zod-validated args; project/board arguments take the pseudonym directly, never an internal id, so the model never sees ids at all)
- [x] System prompt that encodes the rules from the features doc: which tool answers which kind of question, billable value is not income, out-of-range questions, redaction, the SDLC stages, features added after the snapshot, and no automatic sync between the tools. (`src/orchestrator/system-prompt.ts`)
- [x] Tool-use loop with a maximum number of steps, a timeout and graceful failure. (`src/orchestrator/orchestrator.ts` — configurable `maxSteps`/`timeoutMs`/`maxRetries`, never throws to the caller)
- [x] Answer format: the direct answer first, then key figures, then the period used and any caveats. Numbers are copied from tool output, never recomputed by the model. (encoded in the system prompt's rules — not code-enforced, since the model does the phrasing; M6's eval runner is where this gets checked automatically)
- [x] Ask a clarifying question only when it genuinely matters ("Project 4 or all projects?"), otherwise make a sensible default and state it. (prompt rule)
- [x] Short conversation memory within a session, so follow-ups like "and in July?" work. (`src/session/assistant-session.ts`, reusing `core`'s `SessionStore`/`ConversationState` — the same interface `provider-session-redis` backs for every other agent)
- [x] Prompt-injection guard: tool outputs are wrapped as data, and text from the snapshot is never treated as instructions. (system prompt guard, following `agent-cook`'s `faq-matcher.ts` convention; tool results are sent back to the model explicitly labelled "data, not instructions")
- [x] Only aggregated, redacted results go to the model API, never raw record dumps beyond what a question needs. (every tool returns a shaped `QueryResult`, never a raw table)
- [x] Structured logging per request: question, tools called, arguments, latency, tokens and cost. (`onToolCall` hook on `runAssistant` — the orchestrator stays pure/logging-agnostic per this repo's convention that only apps own logging; M4's standalone service wires this to `@gracesoft-sentinel/logging`)

**Exit criteria:** at least 90% of the golden set (M6) passes when run from the command line. **Not yet verifiable** — this needs a live model call (`OpenAIProvider`) and no live API key/model has been exercised in this environment; the tool-use loop itself is fully unit-tested against a scripted `AIProvider` (8 tests: final answer, tool-call round-trip, invalid-JSON recovery, unknown-tool recovery, invalid-arguments recovery, step-limit graceful failure, model-failure graceful failure, session-history forwarding), but the golden-set pass rate is a live-model concern for M6.

## M4: Standalone service

**Goal:** the assistant runs on its own and can be demoed.

**Superseded after this session's first pass** (see the "Pivot" progress-log entry): the browser chat UI and generic `POST /chat` HTTP API described below were built, live-verified, then explicitly removed on later direction — this repo's whole architecture is channel-agnostic agents wired to `ChannelAdapter`s at the service layer, never a bespoke per-service UI, and `assistant-service` owning its own UI broke that pattern. The service was rebuilt to mirror `cook-service`/`concierge-service` exactly: reachable only through `channel-telegram`/`channel-whatsapp`, no HTTP API surface beyond `GET /health`/`GET /ready` and the channel webhooks themselves. The bullets below are kept as a record of what M4 originally specified and what was actually verified at the time; they no longer describe the current code.

- [x] ~~Express app wrapping `core`~~ (**deviates from "Fastify"** — every other app in this repo is Express) — superseded: no `POST /chat`, no `GET /meta`, no `POST /sessions/:id/reset`. `GET /health`/`GET /ready` now follow the exact `cook-service` convention instead of this service's own gated-`/health` design.
- [x] ~~Minimal chat UI~~ (`public/index.html`, `app.js`, `style.css`) — built, live-verified in-browser at desktop and phone width (see the M4 progress-log entry for that verification), then **deleted** per later direction. A `channel-web` package (a proper `ChannelAdapter` + two brand themes, using the real palette from `04-brand-guidelines.md`) was built partway as a channel-shaped replacement, then also deleted — not needed yet; Telegram/WhatsApp are enough for now.
- [x] ~~Access control: a demo bearer token~~ — superseded: no bearer token, no generic HTTP access control. Per-chatter flood protection (`SessionRateLimiter`) and the daily model-call cap (`DailyCallCap`) carried over unchanged, now applied inside `on-message.ts` instead of the old HTTP handler. Per-IP limiting is still `express-rate-limit`, now in front of the webhook routes (matching `cook-service`'s own `webhookRateLimiter`).
- [x] Config by env (model, as-of date, snapshot path *or* Pinecone index, tool-loop limits), with validation on boot (`src/env.ts`, Zod, fails with the missing key named) — still true, reshaped around `WHATSAPP_ENABLED`/`TELEGRAM_ENABLED` instead of a bearer token, and around the Pinecone-search-mode branch (see the "Pivot" entry).
- [ ] Deploy to the droplet under systemd (no Docker), behind HTTPS, with the snapshot loaded at start. **Not done — needs the actual droplet, a domain/HTTPS cert and an `OPENAI_API_KEY`, none of which exist in this environment.** (HTTPS/a domain matter less now there's no browser-facing UI, but the droplet and a real `OPENAI_API_KEY` are still needed to run this for real.)

**Exit criteria (as originally written):** a fresh deploy answers every starter question correctly from a browser, and limits trigger as configured. **No longer the right exit criteria** — there is no browser anymore. What was verified before the UI was removed: the service ran live, the graceful-failure/fallback path worked end to end against a placeholder API key, and structured per-request logs were correct (see the M4 progress-log entry). **Not yet re-verified against the Telegram/WhatsApp shape** — that needs a real bot token/WhatsApp number, which this environment doesn't have; `on-message.test.ts`/`server.test.ts` cover the same logic with fakes instead.

## M5: Demo-service integration build

**Goal:** the same assistant, running inside demo-service.

- [x] Implement the integration surface agreed in M0: `createAssistantOnMessageHandler` (`apps/demo-service/src/assistant-on-message.ts`) is a `RegisteredAgent` for `agent-switcher`, exactly the shape `createConciergeOnMessageHandler`/`createCookOnMessageHandler` already use — no new demo-adapter package or embeddable module needed, since that pattern already existed and already generalizes to a third agent.
- [x] Map demo-service's session, user and auth model onto the core's session interface — reuses `agent-assistant`'s own `loadHistory`/`appendTurn` (built on `core`'s `SessionStore`) against demo-service's *existing shared* `RedisSessionStore` instance, keyed `assistant:{channel}:{senderId}` (same per-agent-prefix convention `concierge:`/`cook:`/`switcher:` already use on that one shared store).
- [x] Adopt demo-service's logging, error format and config conventions — `createLogger("demo-service")`, same Zod-validated-env-with-superRefine pattern as every other flag in `env.ts`.
- [x] Namespace routes and config so nothing collides with existing demo-service features — no new HTTP routes at all (the switcher pattern needs none); every new env var is `ASSISTANT_`-prefixed; the trigger words `/assistant`/`assistant` don't collide with `/concierge`/`concierge`/`/cook`/`cook`.
- [x] Feature flag to switch the assistant on or off in demo-service — `ASSISTANT_ENABLED` (default `false`), mirroring `WHATSAPP_ENABLED`/`TELEGRAM_ENABLED`/Pinecone's own opt-in shape. Off: `buildAssistantAgent` returns `undefined`, nothing is added to the switcher's `agents` array, `ASSISTANT_SNAPSHOT_DIR` isn't even required.
- [x] Integration test running inside demo-service's test harness — extended `switcher-integration.test.ts` (real `agent-switcher` + real `createAssistantOnMessageHandler` + the real M1 fixture snapshot, only the model is faked) and `composition.test.ts` (wires without throwing when enabled; fails boot loudly on a bad snapshot dir).

**Exit criteria:** demo-service starts with the assistant enabled, the golden set passes through demo-service's entry point, and switching the flag off removes it cleanly. **Partially met**: starting with the assistant enabled, switching via `/assistant`, and the flag-off path removing it cleanly are all verified by the tests above (26 demo-service tests green, full workspace build/typecheck/lint/boundaries clean). The golden set itself doesn't exist yet — that's M6.

## M6: Evaluation suite

**Goal:** prove the answers are right and catch regressions.

- [x] Golden set of 40–60 questions spread across Desk time, Desk finance, Skylight, cross-tool, out-of-range, redaction and adversarial cases (see `test-checklist.md`). — 40 questions, `packages/agent-assistant/src/evals/golden-set.ts`, `buildGoldenSet(ctx)`.
- [x] Expected answers generated from the query layer (not written by hand), with a numeric tolerance of zero. — every numeric `mustIncludeAll` fragment is computed by calling the same `time`/`finance`/`skylight`/`cross-tool` functions the assistant's own tools wrap, at eval-build time, against the live `QueryContext` — never hand-typed. (Guardrail categories — out-of-range/redaction/injection/misuse — check required *phrasing*, not numbers, matching the checklist's own table for those rows.)
- [x] Eval runner: calls the full stack and checks numbers, entities, the period used and the required caveats, then reports pass rate, latency and cost. — `runGoldenSet()` (`src/evals/eval-runner.ts`) runs every question through the real `runAssistant()` loop, grades by substring match (zero tolerance: any missing/forbidden fragment or graceful-failure fallback is a fail), reports overall + per-category pass rate and latency percentiles. **Cost is not reported** — `AIProvider` exposes no token usage, so there's nothing to compute it from (same limitation as M4's spend-cap proxy).
- [ ] Run in CI on every change to prompts, tools or core. **Not done — needs a live `OPENAI_API_KEY` in CI, which doesn't exist yet.** The runner and CLI (`apps/assistant-service`'s `pnpm eval`) are ready to be wired into a CI step the moment a key is available; wiring it in without a key would just fail every run.

**Exit criteria:** at least 95% pass on the golden set, 100% on the out-of-range, redaction and injection cases. **Not measurable yet** — needs a live model. What *is* verified: the grading mechanism itself (11 tests against a scripted fake model prove pass/fail/category-aggregation/history-forwarding all work correctly), and that the golden set itself is well-formed (40 questions, every category represented, every question has at least one real checkable requirement, ids are unique/sequential).

## M7: Demo readiness

**Goal:** a smooth live demo.

- [x] Demo script: 8–10 questions that show off each capability, in a good order. — [`08-assistant-demo-script.md`](08-assistant-demo-script.md), 10 questions, deliberately ending on the two guardrail questions rather than a number.
- [x] Warm-up on start (snapshot loaded, a model call made) so the first question isn't slow. — `apps/assistant-service/src/index.ts`'s `warmUp()`: fires a throwaway `chatComplete` right after boot, never blocks `app.listen`, logs success/failure. Live-verified with a deliberately-invalid API key: failed cleanly, logged a clear warning, server still started and served traffic.
- [x] Fallback plan if the model API is down: cached answers for the scripted questions, clearly labelled. — `packages/agent-assistant/src/fallback/demo-fallback.ts`, wired into `chat-handler.ts`: on a graceful failure, a matching demo-script question gets its pre-computed answer (from the query layer, not hand-typed) instead of the generic "I'm having trouble" message, always suffixed `[cached demo answer — the live model is unavailable right now]`. Live-verified: all 10 demo-script questions, asked in order against a deliberately-invalid API key, each correctly returned its labelled cached answer.
- [x] README for both versions: setup, config, how to refresh the snapshot, known limits. — new "GraceSoft Assistant (Demo)" section in the root [`README.md`](../README.md) (no per-app README convention exists elsewhere in this repo, so this follows the root README's existing per-product-section pattern rather than inventing a new one).
- [x] Final check that nothing unredacted is present in the data, logs, UI or README. — the automated redaction scanner already gates every snapshot load (M1); additionally grepped every new M4–M7 file (fixture data, UI, docs, `.env.example`s) for email/phone/absolute-local-path patterns by hand — nothing found.

**Exit criteria:** two full dry runs of the demo script through both versions with no errors. **One full live dry run done** — all 10 demo-script questions run in order through the standalone service's real chat UI in the browser pane (with a deliberately-invalid API key, so this exercised the fallback-cache path specifically), no errors, no console errors, all 10 cached answers matched the hand-verified fixture values exactly. **Not done: a second dry run, and any dry run through demo-service** — demo-service needs Redis and Postgres, neither of which exist in this environment; its `/assistant` path is instead covered by `switcher-integration.test.ts` (real switcher, real `createAssistantOnMessageHandler`, real fixture snapshot, only the model faked), which is a meaningfully different kind of verification than an actual browser dry run. One incidental finding during the browser dry run, noted for whoever runs the next one: this session's browser-automation tool's synthetic Return/Enter keypress did not trigger the chat form's submit — clicking the Send button worked every time. Standard HTML forms submit on Enter by default and nothing in `app.js` overrides that, so this reads as an automation-tool quirk, not an app bug, but it's worth a two-second check in an actual browser before a live demo.

---

## Open questions

1. **demo-service contract — resolved:** Express, via `agent-switcher`'s `RegisteredAgent { name, label, triggers, onMessage }` (see `apps/demo-service/src/composition.ts`). M5 will write a `createGraceSoftAssistantOnMessageHandler(...)` closure and add one registration entry — no new wiring pattern needed. There is no generic `POST /chat` JSON endpoint in the repo today; M4's standalone service adds its own (see its deviation note).
2. **Snapshot format — resolved:** JSON, one file per table (`data/snapshot/valid/*.json`).
3. **"Current stage" rule — resolved:** the stage of the project's most recent time entry by date.
4. **"Completed" in Skylight — resolved:** only a move into a column literally named "Done" (`Column.isDoneColumn`).
5. **Audience access:** still open — a demo token via env var is the planned default for M4, pending confirmation.