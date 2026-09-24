# GraceSoft Assistant — Demo Script

10 questions, in order, showing off each capability of the assistant. Every one of these has a pre-computed fallback answer (`packages/agent-assistant/src/fallback/demo-fallback.ts`) that's served automatically, clearly labelled, if the live model is unreachable mid-demo — see `runDryRun` below.

Snapshot: 10 Jul 2026 to 10 Sep 2026. As-of date: 10 Sep 2026 (Asia/Singapore).

| # | Question | Shows off |
| --- | --- | --- |
| 1 | What's overdue? | Skylight — current-state query, relative to the as-of date |
| 2 | What's due today? | Skylight — "due today" vs "overdue" distinction |
| 3 | How many billable hours did I log in August? | Desk time — period resolution, billable/non-billable split |
| 4 | Which stage is Project 4 in? | Desk time — the current-stage rule, stated explicitly |
| 5 | What's my cash position now? | Desk finance — account balances as of the as-of date |
| 6 | What did I spend on SaaS last month? | Desk finance — category-scoped spend, "last month" resolution |
| 7 | How is Project 4 performing? | Cross-tool — Desk + Skylight joined by pseudonym |
| 8 | Is anything pending or outstanding? | Desk finance — unsettled items, kept separate from totals |
| 9 | How many hours did I log in June? | Guardrail — "outside the snapshot," not zero |
| 10 | Who is User 1? | Guardrail — declines to de-redact, even asked directly |

**Why this order:** starts with Skylight (visual, immediately legible — "here's what's overdue"), moves into Desk time and finance (the numbers the demo needs to prove are trustworthy), synthesizes both in one cross-tool question, and closes on two guardrail questions — a deliberate choice to end a live demo by showing the assistant say "no" correctly, which reads as more trustworthy than ending on a number.

## Running it

- **Standalone** (`apps/assistant-service`): open the chat UI, click each starter-question chip in order (all 10 aren't shown as chips — the UI surfaces 8; #9/#10 can be typed).
- **demo-service**: send `/assistant` to switch, then send each question as a plain message.
- Both dry runs (M7's exit criterion) should be run once each before a live demo, end to end, with no errors.

## If the model is down

Every question above has a pre-computed fallback answer, built from the real query layer (not written by hand — see `demo-fallback.ts`), served automatically and labelled `[cached demo answer — the live model is unavailable right now]` whenever `runAssistant` falls back to its own graceful-failure message. Verified live in this environment (see `08-assistant-progress-log.md`'s M4 and M7 entries) with a deliberately-invalid API key: the warm-up call fails, is logged, and doesn't block startup; the first scripted question served the correct cached answer; a non-scripted question still got the ordinary "I'm having trouble reaching the model" message, not a crash.
