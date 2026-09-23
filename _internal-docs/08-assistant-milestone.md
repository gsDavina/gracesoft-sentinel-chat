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

- [ ] Confirm the snapshot export format (JSON or CSV, one file per table) and document the schema for every entity:
  - Desk: projects, time entries, stages, transactions, accounts, payment methods, categories, vendors, services, documents (metadata only).
  - Skylight: boards, columns, cards, labels, tags, checklists and their items, comments, notes, activity log.
- [ ] Fix the as-of date (default 10 Sep 2026 SGT) and make it a config value.
- [ ] Pick the model (Claude Haiku for cost, with Sonnet as an optional switch for harder cross-tool questions) and set a per-request token cap.
- [ ] Decide the in-memory store (plain typed arrays with indexes, or SQLite/DuckDB loaded at boot).
- [ ] Get the demo-service integration contract (see *Open questions*).
- [ ] Scaffold the monorepo: TypeScript strict mode, lint, test runner (Vitest), CI.

**Exit criteria:** the schema doc is written, config keys are defined, and the repo builds with an empty test passing in CI.

## M1: Snapshot ingestion and validation

**Goal:** load the redacted data reliably and refuse bad data loudly.

- [ ] Loader for Desk and Skylight exports into typed models, validated with Zod.
- [ ] Referential-integrity checks: time entries point to real projects and stages, transactions to real accounts, methods, categories and vendors, cards to real columns and boards, checklist items to real checklists.
- [ ] Cross-tool mapping: match Skylight boards to Desk projects by shared pseudonym, and log any that don't match.
- [ ] Date-range check: flag any record dated outside 10 Jul to 10 Sep 2026.
- [ ] Redaction scan: fail the load if raw emails, URLs, phone numbers, account numbers or file paths are found anywhere, including notes and comments.
- [ ] Normalise money (integer cents, currency), durations (minutes) and timestamps (UTC stored, SGT for day boundaries).
- [ ] Load summary on boot: record counts per entity, date span and warnings.

**Exit criteria:** the real snapshot loads with zero integrity errors, and a deliberately broken fixture fails with clear messages.

## M2: Deterministic query layer

**Goal:** a tested function for every kind of question the demo should answer. No LLM involved yet.

**Desk: time and projects**
- [ ] Hours logged (total, billable, non-billable) by period, project and stage.
- [ ] Billable value (hours × project rate) by period, project and stage.
- [ ] Current stage of a project (the rule is defined and documented, for example the stage of its most recent time entry).
- [ ] Project summary: status, dates, rate, hours to date, billable value, stage breakdown, last activity.
- [ ] Commit-derived versus manual time entries (commit tracking only exists from 1–3 Aug 2026).

**Desk: finance**
- [ ] Income, expenses and net for a period, broken down by category, vendor, account and payment method.
- [ ] Cash position and account balances as of a date.
- [ ] Pending and outstanding items.
- [ ] Monthly summary (mirrors Desk's Monthly Summary report).
- [ ] Vendor and service spend, for example SaaS spend for a given month.

**Skylight**
- [ ] Overdue cards and cards due on a given date, relative to the as-of date.
- [ ] Cards by board, column, label and tag. "What's in progress on Project 4?"
- [ ] Checklist progress per card, with the remaining items listed.
- [ ] Cards completed in a period, using activity-log moves into Done.
- [ ] Recent activity on a board or card, including comments and notes.
- [ ] Search boards by name and cards by title.

**Cross-tool**
- [ ] Project health: Desk hours and billable value alongside Skylight open, overdue and done counts for the same pseudonym.
- [ ] Time spent in the period during which cards were completed on a board (clearly labelled as correlation, since the tools don't sync).

**Shared helpers**
- [ ] Period resolver: "August", "last month", "last 30 days", "Q3 so far", "this week" are turned into explicit date ranges against the as-of date and clipped to the snapshot, with a flag saying whether clipping happened.
- [ ] Every result includes its source tool, the date range actually used and any caveats (clipped range, no data, unmatched board).

**Exit criteria:** every function has unit tests against a small hand-built fixture with hand-calculated answers.

## M3: LLM orchestration

**Goal:** turn natural-language questions into tool calls and grounded answers.

- [ ] Expose each M2 function as a tool with a tight JSON schema (enums for stage names, ISO dates, pseudonym IDs).
- [ ] System prompt that encodes the rules from the features doc: which tool answers which kind of question, billable value is not income, out-of-range questions, redaction, the SDLC stages, features added after the snapshot, and no automatic sync between the tools.
- [ ] Tool-use loop with a maximum number of steps, a timeout and graceful failure.
- [ ] Answer format: the direct answer first, then key figures, then the period used and any caveats. Numbers are copied from tool output, never recomputed by the model.
- [ ] Ask a clarifying question only when it genuinely matters ("Project 4 or all projects?"), otherwise make a sensible default and state it.
- [ ] Short conversation memory within a session, so follow-ups like "and in July?" work.
- [ ] Prompt-injection guard: tool outputs are wrapped as data, and text from the snapshot is never treated as instructions.
- [ ] Only aggregated, redacted results go to the model API, never raw record dumps beyond what a question needs.
- [ ] Structured logging per request: question, tools called, arguments, latency, tokens and cost.

**Exit criteria:** at least 90% of the golden set (M6) passes when run from the command line.

## M4: Standalone service

**Goal:** the assistant runs on its own and can be demoed by URL.

- [ ] Fastify app wrapping `core`:
  - `POST /chat`: takes a message and session ID, returns the answer and metadata. Streams by SSE.
  - `GET /health` and `GET /meta` (snapshot span, as-of date, record counts, model).
  - `POST /sessions/:id/reset`.
- [ ] Minimal chat UI: suggested starter questions, a snapshot-scope banner ("Data: 10 Jul to 10 Sep 2026, redacted") and a visible "Demo data" label.
- [ ] Access control: a demo token or basic auth, plus per-IP and per-session rate limits and a daily spend cap.
- [ ] Config by env (model, as-of date, snapshot path, limits), with validation on boot.
- [ ] Deploy to the droplet under systemd (no Docker), behind HTTPS, with the snapshot loaded at start.

**Exit criteria:** a fresh deploy answers every starter question correctly from a browser, and limits trigger as configured.

## M5: Demo-service integration build

**Goal:** the same assistant, running inside demo-service.

- [ ] Implement the integration surface agreed in M0, for example one of:
  - an embeddable module (a Fastify plugin or an Express router exported from `demo-adapter`), or
  - an HTTP client that demo-service calls, matching its existing request, response and auth conventions.
- [ ] Map demo-service's session, user and auth model onto the core's session interface.
- [ ] Adopt demo-service's logging, error format and config conventions.
- [ ] Namespace routes and config so nothing collides with existing demo-service features.
- [ ] Feature flag to switch the assistant on or off in demo-service.
- [ ] Integration test running inside demo-service's test harness.

**Exit criteria:** demo-service starts with the assistant enabled, the golden set passes through demo-service's entry point, and switching the flag off removes it cleanly.

## M6: Evaluation suite

**Goal:** prove the answers are right and catch regressions.

- [ ] Golden set of 40–60 questions spread across Desk time, Desk finance, Skylight, cross-tool, out-of-range, redaction and adversarial cases (see `test-checklist.md`).
- [ ] Expected answers generated from the query layer (not written by hand), with a numeric tolerance of zero.
- [ ] Eval runner: calls the full stack and checks numbers, entities, the period used and the required caveats, then reports pass rate, latency and cost.
- [ ] Run in CI on every change to prompts, tools or core.

**Exit criteria:** at least 95% pass on the golden set, 100% on the out-of-range, redaction and injection cases.

## M7: Demo readiness

**Goal:** a smooth live demo.

- [ ] Demo script: 8–10 questions that show off each capability, in a good order.
- [ ] Warm-up on start (snapshot loaded, a model call made) so the first question isn't slow.
- [ ] Fallback plan if the model API is down: cached answers for the scripted questions, clearly labelled.
- [ ] README for both versions: setup, config, how to refresh the snapshot, known limits.
- [ ] Final check that nothing unredacted is present in the data, logs, UI or README.

**Exit criteria:** two full dry runs of the demo script through both versions with no errors.

---

## Open questions

1. **demo-service contract:** what stack is it (Fastify, Express, Laravel), and should the assistant be embedded as a module or called over HTTP? This decides the M5 design.
2. **Snapshot format:** JSON or CSV, and is it one bundle or per-table files?
3. **"Current stage" rule:** most recent time entry, most hours in the last N days, or a stored project field?
4. **"Completed" in Skylight:** only moves into a column literally named Done, or any column marked as final?
5. **Audience access:** public link with a token, or only shown live by you?