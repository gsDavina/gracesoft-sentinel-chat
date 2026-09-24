# Progress Log

Companion to `01-milestone-checklist.md`. One entry per work session, newest first. Records what was actually built, decisions made, and anything deferred that needs a human (accounts, credentials, deployment).

---

## 2026-09-24 — TODO sweep: concurrent channels, Slack, LINE, branded web chats, user data deletion, demo service map

**Status:** Every open item in `00-todo.md` built, tested, and verified across the whole workspace. Two items were ambiguous and got clarified up front: "Link Channel" means **LINE** messenger, and "Service map" means **a map of every agent behind the demo switcher**.

**1. All adapters concurrently — a real bug, not just a missing feature.** Every channel router registers `POST /webhook`, and every service mounted each router at the root. With WhatsApp *and* Telegram enabled, WhatsApp's router (first in line) answered every Telegram delivery with a 403 on its failed signature check, so Telegram silently never worked. `docs/webhooks.html` documented this as "one channel per instance"; SMS was never wired into any service at all.
- New package `packages/webhook-host`: `channelEnvShape`/`refineChannelEnv` (every channel's env vars and cross-field checks in one place, replacing four copies of the WhatsApp/Telegram block) and `mountChannels(app, …)`, which mounts every enabled channel at its own path (`/whatsapp/webhook`, `/telegram/webhook`, `/sms/webhook`, `/slack/webhook`, `/line/webhook`, `/chat/gracesoft/`, `/chat/davdevs/`), with a per-IP limiter on each.
- **Backwards compatible for the live Railway deployments:** the shared `/webhook` path stays and routes each request by the platform's own signature header (`X-Hub-Signature-256`, `X-Telegram-Bot-Api-Secret-Token`, `X-Twilio-Signature`, `X-Slack-Signature`, `X-Line-Signature`) plus WhatsApp's GET handshake. Already-registered webhook URLs don't need touching; an unsigned POST still gets 403 exactly as before.
- All four services' `server.ts` are now the same ~40 lines around `mountChannels`, and SMS is finally wired in (`SMS_ENABLED` + Twilio vars + `SMS_WEBHOOK_URL`). Named `webhook-host`, not `channel-*`, because it must import every channel, which the `no-channel-to-channel` boundary rule forbids for channel packages.
- Empty `KEY=` lines from a copied `.env.example` are treated as unset. Otherwise `WEB_CHAT_ACCESS_TOKEN=` would fail its 8-character minimum on a fresh setup. This was caught by loading each app's actual `.env.example` through its own `loadEnv`.

**2. `packages/channel-slack`.** Events API + interactivity on one signed `POST /webhook`: v0 HMAC over `v0:{ts}:{raw body}` with 5-minute replay protection, `url_verification` challenge, DMs (`message` with `channel_type: im`) and `app_mention`s (mention stripped). It drops bot/own messages, edits and Slack's automatic retries (acked before processing, so a retry would double-answer). Quick replies become Block Kit buttons, and a tapped button comes back form-encoded as `block_actions`. `senderId` is `{channel}:{user}`, so two people mentioning the app in one channel keep separate sessions. Files are downloaded with the bot token and inlined as `data:` URIs, like every other channel. 27 tests.

**3. `packages/channel-line` (LINE Messaging API).** Base64 HMAC signature over the raw body; each event in a batch is answered independently. Skips standby mode and redeliveries. Replies use the free Reply API and fall back to Push when the ~1-minute reply token has expired (a slow model answer can outlive it). Quick replies are postback actions, with labels truncated to LINE's 20 characters. Group chats are keyed `{group}:{user}`. Media is fetched from the data API. 20 tests.

**4. Two branded web channels plus a template other UIs can build on.** Unlike the earlier `channel-web` attempt that was deleted, this one is split into a template and themes:
- `packages/web-chat-kit`: the template. A `WebChatTheme` token contract (12 colour roles × light/dark, fonts, radius, logo/wordmark, copy), `renderThemeCss` (default scheme on `:root`, the other behind `[data-theme]`, optional `prefers-color-scheme`), a vanilla, no-build page (`public/chat.css` written only against `--chat-*` variables; `public/chat.js` renders everything via `textContent`). The page has quick-reply chips, photo attach (≤4 MB), a light/dark toggle, a new-conversation button and an optional access-code gate. Plus `WebChatChannelAdapter` (Zod-validated inbound, random-session-id `senderId`, only https/`data:image` images passed back) and `createWebChatRouter`: strict CSP (`script-src 'self'`, no inline script/style), relative URLs only so it mounts under any prefix, synchronous JSON reply. `auditThemeContrast` checks every rendered text pairing against WCAG AA in both schemes. A new brand is "write a `WebChatTheme`, call `createWebChatChannel`".
- `packages/channel-web-gracesoft`: Purple/Black palette and roles from `gracesoft-brand-guidelines.md` (dark mode follows its role table exactly), Montserrat/Playfair/Source Code Pro, and the new company logo set (`GS-LGO-C`/`-W`, `GS-ICN` favicon).
- `packages/channel-web-davdevs`: dark-first ink/cream/gold palette from `davdevs-brand-guidelines.md`, Syne/Inter/JetBrains Mono, and the new logo set (`DL-LGO-B` on cream, `DL-LGO-C` gold on ink, `DL-ICN-C` favicon). The contrast audit caught Gold 700 at 3.8:1 on the cream chip fill, so light mode uses Gold 800.
- Both branded packages' tests run the contrast audit and check every referenced brand file exists.

**5. assistant-service's UI now comes from the channel packages.** Its bespoke UI was already removed in the pivot session. Its web UI now comes from `WEB_GRACESOFT_ENABLED`/`WEB_DAVDEVS_ENABLED` like every other service, with nothing assistant-specific in the service beyond default copy.

**6. User data deletion.** New package `packages/user-data-deletion`: `withUserDataDeletion(onMessage, { erasers, … })` wraps a service's outermost `onMessage`. `/deletemydata` (also "delete my data", `/forgetme`) only *asks*: it names exactly what goes and what doesn't, with Yes/Cancel buttons. Only a confirmation (the button, or typing `DELETE`) within 5 minutes erases anything. Any other reply cancels and is answered normally. Every eraser runs even if one fails, and a partial failure is reported as a failure with the contact address, never as "done". The command is never forwarded to an agent or logged.
- `sessionStoreEraser` / `conversationLogEraser` (structural interface, so no Postgres dependency). `logging-postgres` gained `ConversationDataEraser.deleteSessionData(ids)`, a real `DELETE … WHERE session_id = ANY($1)` on both tables with counts via `RETURNING`.
- Wired into all four services. Each on-message module now exports its `sessionIdFor`, so erasure uses the exact keys the handler writes. Concierge is tenant-scoped, like its keys. demo-service erases the concierge, cook, assistant *and* switcher keys (`demoSessionIds`, pinned by an integration test that chats with all three real agents and then checks no key or log row for that chatter survives, and that nobody else's does). assistant-service is in-memory only.
- **Deliberately not deleted:** appointments already on the business's Google Calendar. The prompt tells the chatter to cancel them first. Automatically deleting real calendar bookings is a business decision, not a side effect.
- Privacy policies (`legal-concierge`/`legal-cook`/`legal-demo`) gained a paragraph on the in-chat command, version 1.1.0, effective 24 September 2026. They're still DRAFT and still need legal review.

**7. Demo service map.** `agent-switcher` gained `description` on `RegisteredAgent`, `renderServiceMap`, and `serviceMapTriggers` (`/services`, `services`, `/menu`, `menu`). The map lists every agent with its description and command, marks the one you're on, and offers one quick-reply button per agent. Switching now also matches the tapped quick-reply id, because WhatsApp/Slack put the button *label* in `text`. The switch confirmation now points at `/services`. demo-service registers descriptions for Concierge, Cook and the Assistant, plus a `/deletemydata` footer.

**Verified locally (all green) across the whole workspace:** `pnpm build`, `pnpm test` (every project), `pnpm lint`, `pnpm typecheck`, `pnpm boundaries` (0 violations), `pnpm lint:integration`/`typecheck:integration`/`test:integration`. The cross-channel parity suite now also proves Slack, LINE and the web chat render the same booking offer and return the same `quickReplyId` for a tapped slot. **Live browser check** (throwaway echo server over the real `webhook-host`, `agent-switcher` and deletion wrapper): both branded chats at desktop and 375px (no horizontal scroll), light and dark, logos swapping per scheme, `/services` map and tap-to-switch, booking chips, photo attach, the full `/deletemydata` confirm flow, and the access-code dialog (a wrong code re-prompts; the right code sends the queued message). No console/CSP errors. It found and fixed two real bugs: the composer textarea clipped 2px under `border-box` (a stray scrollbar), and kit assets were cached for an hour, so a redeploy wouldn't reach browsers (now `max-age=0` + ETag).

**Needs a human / not verifiable here:**
- **No live Slack or LINE app exists.** Both channels are tested against their documented wire formats and signature schemes, not a real workspace/Official Account. Creating the Slack app (scopes above) and the LINE channel, then pointing them at `/slack/webhook` / `/line/webhook`, is the user's.
- Registering the new per-channel paths with WhatsApp/Telegram is optional, because the legacy `/webhook` keeps working. Do it at your convenience.
- Set `WEB_CHAT_ACCESS_TOKEN` before exposing a web chat publicly (the service logs a warning at boot if you don't).
- The Dav/Devs chat's page title says "Dav/Devs" while the supplied logo reads "davinaleong.com". Change `brandName` in `channel-web-davdevs/src/theme.ts` if the title should match.

---

## 2026-08-24 — Cook: free recipe search by dish name

**Status:** New Cook capability — "recipe for chicken noodle soup" now returns a generated recipe, no photo or personal recipe source required.

**The gap:** Cook could only produce a recipe two ways — a dish photo (`handlePhoto`), or a personal-source RAG lookup gated behind a possessive word ("my recipe for X", "mom's recipe") *and* a configured `recipeSourceProvider`. A bare "recipe for chicken noodle soup" (no possessive, no photo) matched neither path and dead-ended into the generic "send me a dish photo" prompt — a real gap for a chat-based cooking assistant, where typing a dish name is at least as natural as sending a photo.

**What was built:**
- `recipe-search.ts` — `extractRecipeSearchDishName(text)` / `isRecipeSearchRequest(text)`, deterministic pattern matching in the same style as `personal-recipe.ts`/`grocery-list.ts`: `"recipe for/of X"` and `"how do I/can I/to make X"`. Deliberately narrow (two clear phrasings, not a bare "X recipe" pattern that would false-trigger on any sentence merely containing the word "recipe") — a miss just falls through to the existing photo prompt, so precision was preferred over recall.
- `generateRecipe()` (in `recipe-generator.ts`) gained an optional `homeStyle` flag: when set, the user prompt explicitly asks for "a generic, home-style recipe — approachable for an everyday home cook ... not a restaurant/chef-style presentation," rather than the bare "provide the full recipe" the photo/dietary-adjustment paths use. Free recipe search has no photo to anchor accuracy to, so leaning generic/approachable is the right default (`homeStyle: true` is only set by the new search path; photo and dietary-adjustment behavior is unchanged).
- `handle-message.ts`: new `handleRecipeSearchRequest`, wired into the dispatch chain *after* the personal-recipe check and *before* the grocery-list check — so a possessive phrasing ("my mom's recipe for X") still prefers a configured personal source when one exists, and free search only ever fires as the fallback. Needs no `recipeSourceProvider` at all; this is a core Cook capability, not Milestone-11 opt-in.

**A real regression this surfaced:** two existing tests (`agent-cook`'s own `handle-message.test.ts` and `demo-service`'s `switcher-integration.test.ts`) asserted that `"do you have my mom's recipe for chicken curry?"` falls through to the photo prompt when no `recipeSourceProvider` is configured — true before this change, but that exact phrasing also contains "recipe for chicken curry" and now legitimately matches free search instead, generating a recipe rather than dead-ending. Fixed by rephrasing both tests to a possessive-only phrasing with the dish name *before* "recipe" ("my mom's chicken curry recipe") that doesn't also satisfy the new pattern, correctly isolating "no provider configured" from "the phrasing happens to be generically searchable" — the *behavior* change itself is the intended improvement, not a bug.

**Verified locally (all green):** `pnpm lint`, `pnpm typecheck`, `pnpm boundaries` (0 violations, 578 modules/1266 dependencies), `pnpm build`, `pnpm test` — full workspace green, including 9 new tests in `recipe-search.test.ts` and 5 new `handleMessage`-level tests (generic generation, home-style prompt wording, possessive-still-wins-when-configured, graceful failure, non-matching text still falls through).

**Nothing deferred to the user** — no live credentials needed; this reuses the existing `generateRecipe`/`AIProvider.chatComplete` path the photo flow already depends on.

---

## 2026-08-24 — Mother's Day Edition: refactor from in-memory Drive RAG to a Pinecone index

**Status:** Requested refactor of an already-shipped Milestone 11 feature — recipes are now retrieved from Pinecone at chat time, not by rebuilding an in-memory index from Google Drive on every process.

**Why:** the original `GoogleDriveRecipeProvider` listed the whole Drive folder, downloaded every document, and re-embedded all of it into an in-memory `RecipeEmbeddingsIndex` — the first time any process needed it, and again on every fresh process (no shared state across replicas). Fine for a demo with one instance and a handful of documents; doesn't hold up once there's more than one running instance, or if the recipe folder ever gets large. A real vector index makes retrieval a plain query, and separates "index maintenance" (occasional, batch) from "query" (every chat message).

**What changed:**
- **`provider-drive-google` trimmed to pure Drive I/O.** Removed `GoogleDriveRecipeProvider` and `RecipeEmbeddingsIndex` entirely — this package no longer implements `RecipeSourceProvider` or touches `AIProvider` at all. What's left: the `GoogleDriveClient` wrapper plus a new exported `listRecipeDocuments(client, folderId)` (the file-listing/Google-Docs-export logic that used to live inline in the old provider, now a reusable building block). Dropped the now-unused `@gracesoft-sentinel/core` dependency.
- **New package `provider-recipe-pinecone`.** `createPineconeClient()` wraps the real `@pinecone-database/pinecone` SDK behind our own minimal `PineconeClient` interface (`query`/`upsert`) — unlike the REST-ish clients elsewhere in this repo (`googleapis`, Twilio), Pinecone's SDK doesn't structurally cast onto a flat interface (namespace scoping is method-chained, `upsert` takes `{records, namespace}`), so this one wraps the SDK object internally instead of casting it. `PineconeRecipeProvider implements RecipeSourceProvider` — embeds the query via the injected `AIProvider.embed`, queries Pinecone, maps matches' `metadata.title`/`metadata.content` back to `RecipeSourceResult`. `syncDriveRecipesToPinecone()` is the ingestion half: reads a Drive folder via `provider-drive-google`'s `listRecipeDocuments`, embeds each document, upserts into Pinecone keyed by Drive file id (safe to re-run — an edit just overwrites its own vector). `sync-cli.ts` is a runnable entry point (`pnpm --filter @gracesoft-sentinel/provider-recipe-pinecone run sync`) reading its own env vars, meant to run out-of-band — not invoked by any service automatically.
- **`cook-service`/`demo-service` composition swapped** `GoogleDriveRecipeProvider`/`GOOGLE_DRIVE_RECIPES_FOLDER_ID` for `PineconeRecipeProvider`/`PINECONE_INDEX_NAME` (+ `PINECONE_API_KEY`, optional `PINECONE_NAMESPACE`). Same opt-in shape as before — unset, and `agent-cook`'s `recipeSourceProvider` param is `undefined`, behavior unchanged. `agent-cook` itself needed zero changes: it only ever depended on the `RecipeSourceProvider` interface, never the concrete Drive implementation, so swapping which provider the composition root constructs is exactly the kind of change this architecture exists to make cheap.
- **Docs updated**: `README.md`, `docs/contracts.html`, `docs/getting-started.html` all reflect the new package/env vars and the query-vs-ingest split.

**Verified locally (all green):** `pnpm lint`, `pnpm typecheck`, `pnpm boundaries` (0 violations, 567 modules/1248 dependencies), `pnpm build`, `pnpm test` — full workspace green including 6 tests in the trimmed `provider-drive-google` (was testing the removed provider/index; now tests `listRecipeDocuments` directly) and 11 new tests in `provider-recipe-pinecone` (client construction, provider query behavior including a custom `topK` and missing-metadata degradation, and the sync job including a round-trip "synced recipes are then queryable" test). `pnpm test:integration` green (3 tests).

**Nothing deferred to the user for the code itself** — everything is unit-tested against fakes, no live Pinecone/Drive/OpenAI credentials needed. What *does* need the user: an actual Pinecone account/index and API key to run this for real, and running the sync job at least once (nothing populates the index automatically).

**Next:** nothing outstanding — this was a refactor of an already-complete milestone item, not new milestone scope.

---

## 2026-08-18 — Milestone 11 (6/6): Mother's Day Edition — personal recipe RAG

**Status:** Six of six optional/future items done — Milestone 11, and both checklists, are now complete: every remaining item on `01-milestone-checklist.md` and `02-test-checklist.md` is either checked or explicitly annotated as blocked on something this environment doesn't have (live hosting, live credentials, a real WhatsApp Business/Telegram account for manual E2E validation).

**New package: `provider-drive-google`**, implementing the `RecipeSourceProvider` interface that's existed in `core` since Milestone 1 as a deliberately-minimal placeholder for exactly this feature:
- `google-drive-client.ts` — minimal `GoogleDriveClient` interface (`files.list`/`files.get`/`files.export`) + `createGoogleDriveClient()`, same "our own small SDK slice, not the full `googleapis` surface" pattern as `provider-calendar-google`'s `GoogleCalendarClient`. Service-account JWT scoped read-only to Drive.
- `recipe-embeddings-index.ts` — the actual RAG core: `cosineSimilarity()` (pure function, handles zero-vectors without dividing by zero) and `RecipeEmbeddingsIndex`, an in-memory nearest-neighbor search. Deliberately not a real vector database — a personal recipe folder is dozens of documents, not millions, so a linear scan is the right amount of engineering for the actual problem size.
- `google-drive-recipe-provider.ts` — `GoogleDriveRecipeProvider implements RecipeSourceProvider`: lists the configured Drive folder, downloads each file (handling the Google Docs case separately via `files.export` — `files.get` doesn't work on those), embeds every document via the injected `AIProvider.embed`, and indexes it. `findRecipes()` embeds the query the same way and does cosine-similarity search. The index is built lazily on first call and cached (`ensureIndex()`), not rebuilt per-request.
- Fully unit-tested with fakes (`FakeGoogleDriveClient`, and a `FakeEmbeddingAiProvider` whose "embedding" is a small fixed-vocabulary bag-of-words count — deterministic, and similarity ranking still behaves meaningfully in tests without a live embeddings model) — no live Drive/OpenAI credentials needed or used. 13 tests, all passing on the first `vitest run`.

**Wired into `agent-cook`:** `CookHandleMessageInput` gained an optional `recipeSourceProvider` param — a personal-recipe request ("do you have my mom's recipe for laksa?", detected by `isPersonalRecipeRequest()`, same deterministic-keyword-match philosophy as `isDietaryAdjustmentRequest`/`isGroceryListRequest`) triggers `findPersonalRecipe()`, which returns the top RAG match's title and raw content. Unlike the AI-generated `Recipe` type, this content is the user's own free text (whatever they wrote in the Drive doc) — there's no structured ingredients/steps shape to validate, so `formatPersonalRecipe()` just displays it verbatim rather than routing through `formatRecipe()`. A miss returns a clear not-found message; a lookup failure degrades gracefully rather than crashing (same pattern as every other agent-cook failure path). When no `recipeSourceProvider` is configured, this branch simply never triggers — zero behavior change for any existing deployment.

**Wired into `cook-service`, fully opt-in:** three new optional env vars (`GOOGLE_DRIVE_RECIPES_FOLDER_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`) — `env.ts`'s `superRefine` requires the latter two only when the folder id is set, mirroring the existing `WHATSAPP_ENABLED`-gates-its-own-vars pattern. `composition.ts`'s `buildRecipeSourceProvider()` returns `undefined` when unconfigured, so every deployment without a Drive folder is completely unaffected — construction itself makes no network call either way, matching every other provider in this composition root.

**Verified locally (all green):** `pnpm lint`, `pnpm typecheck`, `pnpm boundaries` (0 violations, 464 modules/993 dependencies), `pnpm build`, `pnpm test` — 395 workspace tests + 3 root integration tests = 398/398, including the new `provider-drive-google` suite, `agent-cook`'s personal-recipe branch (match found / no match / provider absent / lookup failure), and `cook-service`'s opt-in wiring (composition constructs cleanly when configured, `on-message.ts` threads the provider through end-to-end).

**Also swept both checklists for stale unchecked boundary-enforcement items** that were actually already satisfied (agent-concierge/agent-cook zero imports from channel-*/provider-*, no cross-package internal imports, CI enforcement) — `.dependency-cruiser.cjs`'s rules and `.github/workflows/ci.yml`'s `pnpm boundaries` step already cover all four; they'd just never been marked done.

**Nothing deferred to the user for this item** — no live Drive/OpenAI credentials needed or used; this is pure wiring/RAG-logic work, fully verifiable with fakes.

**Next:** nothing — Milestone 11 was the last milestone, and every item across both checklists is now either checked or explicitly annotated as blocked on real hosting/credentials/accounts this environment doesn't have. Remaining work is genuinely the user's: provision live infrastructure and credentials, deploy, and run the manual/live-LLM E2E validation passes documented in `02-test-checklist.md` sections 3–5.

---

## 2026-08-18 — Milestone 11 (5/6): Multi-tenant `BusinessConfig` support

**Status:** Five of six optional/future items done.

**The core question:** how does one `concierge-service` deployment know which business an inbound message belongs to? The channel-layer already carries the answer, just unused until now — WhatsApp Cloud API's webhook payload includes `metadata.phone_number_id` (which of the business's registered numbers received the message), and Twilio's inbound webhook includes `To` (which of the business's Twilio numbers). Both can route multiple numbers to the same webhook URL under one app/account, which is exactly the multi-tenant case. Telegram doesn't have an equivalent: a bot's identity is implicit in its webhook URL/token, not present in the update payload itself, so true Telegram multi-tenancy would mean mounting multiple bot configs at different routes — out of scope here, left as a documented gap.

**Core change:** added `NormalizedMessage.businessChannelId?: string` (`packages/core/src/message.ts`) — deliberately *not* named `recipientId`, since `ChannelAdapter.formatOutbound`'s existing `context.recipientId` already means the opposite direction (the customer's id to reply *to*). `businessChannelId` is which of the *business's own* identities received the message. `WhatsAppChannelAdapter.parseInbound` populates it from `metadata.phone_number_id`; `SmsChannelAdapter.parseInbound` from `To`; `TelegramChannelAdapter` leaves it `undefined` (documented, not a bug).

**Service-layer resolution (`apps/concierge-service`):**
- `business-config-loader.ts` gained `loadBusinessConfigRegistry(dir)` — reads every `<businessChannelId>.json` file directly inside a directory (non-recursive `readdirSync`), keyed by filename stem. Each business's FAQ blueprint must live in a nested subdirectory (e.g. `./faq-blueprints/<id>.json`) so it isn't itself misread as a business config file.
- `env.ts`: `BUSINESS_CONFIG_PATH` is now optional; new optional `BUSINESS_CONFIGS_DIR` (a directory, for multi-tenant); `superRefine` requires at least one of the two.
- `on-message.ts`: `OnMessageDeps` now takes `resolveTenant: (message) => TenantContext | undefined` instead of flat `businessConfig`/`faqBlueprint`/`calendarProvider` fields — single-tenant mode is just a resolver that always returns the same `TenantContext` regardless of input, so there's no special-casing between the two modes inside the handler itself. An unresolved tenant (unrecognized `businessChannelId`) gets a safe fallback reply, not a crash or silent misrouting. Session ids are now tenant-scoped (`concierge:${tenant}:${channel}:${senderId}`) — without this, the same customer messaging two different businesses on a multi-tenant deployment would collide onto one shared conversation state, since `senderId` (their own phone number) is the same across both.
- `composition.ts`: `buildTenantResolver()` builds either a registry of `GoogleCalendarProvider`s (multi-tenant, one per business, all sharing one `GoogleCalendarClient` since the calendar API itself is business-agnostic — only `calendarId` and `businessHours`, both already per-`BusinessConfig`, differ) or a single one (single-tenant, unchanged behavior).

**Verified locally (all green):** `pnpm lint`, `pnpm typecheck`, `pnpm boundaries` (0 violations, 440 modules/935 dependencies), `pnpm build`, `pnpm test` — 372/372 workspace-wide (369 package tests + 3 root integration tests), including new coverage for: `businessChannelId` extraction in both `WhatsAppChannelAdapter` and `SmsChannelAdapter`, `loadBusinessConfigRegistry` (multi-file load, subdirectory FAQ resolution, ignoring non-conforming top-level entries), tenant-scoped session isolation, and the unresolved-tenant fallback path.

**Nothing deferred to the user for this item** — no live credentials needed; this is pure wiring/config-shape work.

**Next:** the Mother's Day Edition (`provider-drive-google` + embeddings/RAG for personal recipe retrieval) — the last Milestone 11 item, and the last item on either checklist.

---

## 2026-08-13 — Milestone 11 (4/6): Meal planning / grocery list generation (Cook)

**Status:** Four of six optional/future items done.

**What was built:** entirely within `agent-cook` — no core interface change this time, unlike the last two items.
- `CookContext` gained `recentRecipes?: Recipe[]` alongside the existing `lastRecipe` — every successfully identified dish photo appends to it (capped at 7, a week's worth), and a dietary adjustment *replaces* the last entry rather than adding a second one (it's still the same dish, just modified — counting it twice in a grocery list would double the ingredients).
- `grocery-list.ts` — `isGroceryListRequest()` (deterministic keyword match: "grocery list", "shopping list", "what do I need to buy", "meal plan" — same philosophy as `dietary-adjustment.ts`), and `generateGroceryList(recipes, aiProvider)` which sends all the accumulated recipes' ingredient lists to `AIProvider.chatComplete` for consolidation. This one genuinely needs an LLM rather than a deterministic string-dedupe: combining "2 cloves garlic" from one recipe with "2 cloves garlic" from another into "4 cloves garlic" is a natural-language quantity-merging task, not a set operation. Carries the same prompt-injection guard pattern established in Milestone 10 (recipe names/ingredients are untrusted user-sourced input, not instructions).
- `handleMessage`'s branch order: photo (always wins) → voice-note transcription → dietary adjustment (if `lastRecipe` exists) → **grocery list (if `recentRecipes` is non-empty)** → prompt-for-photo fallback. A grocery-list request with no recent recipes falls through to the ordinary "send me a photo" prompt rather than a confusing empty list.

**Verified locally (all green):** `pnpm lint`, `pnpm typecheck`, `pnpm boundaries` (0 violations, 440 modules/933 dependencies), `pnpm build`, `pnpm test` — 10 new tests (accumulation-and-cap across successive photos, consolidation request-shaping, empty-recipes fallback, graceful failure), 362/362 workspace-wide (365 with the 3 root integration tests).

**Nothing deferred to the user for this item** — no live AI provider credentials were needed or used.

**Next:** multi-tenant `BusinessConfig` and the Mother's Day Edition (Drive + RAG) — the last two Milestone 11 items.

---

## 2026-08-13 — Milestone 11 (3/6): Voice note input handling

**Status:** Three of six optional/future items done.

**A real core interface change, done through the actual Changesets flow:** added `transcribeAudio(input): Promise<TranscribeAudioResult>` to `AIProvider` itself (+ `TranscribeAudioInput`/`TranscribeAudioResult` Zod schemas), rather than inventing a side-channel "transcription service" concept — voice notes are just another `AIProvider` capability, same tier as `chatComplete`/`visionAnalyze`/`embed`. `runAIProviderContractTests` now exercises it too, which is exactly why this ripples everywhere: **every** existing `AIProvider` implementation and test double had to add the method before anything would compile again — `provider-ai-openai`, `provider-ai-gemini`, `EchoAiProvider` (the Milestone 4 stub), and five separate `FakeAiProvider`/`UnusedAiProvider` test doubles across `agent-concierge`, `agent-cook`, both services, and the root cross-channel-parity test. TypeScript caught every single one at compile time — nothing was found by running tests, all of it by `tsc` refusing to build. `.changeset/transcribe-audio.md` → `pnpm changeset version`: core `0.2.0` → `0.3.0` (minor), dependents patch-bumped automatically, same flow as the `SessionStore` addition in Milestone 8.

**Real implementations:**
- `provider-ai-openai`: Whisper via `client.audio.transcriptions.create()`. The SDK wants a `File`-like object (`openai`'s own `toFile()` helper), not a URL, so a `{url}` input is downloaded first — same "fetch first, hand bytes to the SDK" shape as `visionAnalyze`'s `{url}` case. Verified against real SDK method/type names on the first `tsc` pass (no guessing needed a second try, unlike a couple of earlier milestones).
- `provider-ai-gemini`: `generateContent` with the audio as inline data plus an explicit "transcribe this verbatim, output only the text" instruction — Gemini has no separate transcription endpoint, but audio-as-input to the same multimodal call works. Shares the `{url}|{base64,mimeType}` → inline-data resolution helper with `visionAnalyze` now (`toInlineDataPart`, generalized from what was `toInlineImagePart`).

**Wired into both agents, each mirroring how it already handles its other media type:**
- `agent-concierge`: a voice note with no `text` gets transcribed at the top of `handleMessage`, then flows through the *exact same* pipeline as typed text — including the free-text slot-selection fallback, so a spoken "I'll take the second one" resolves a booking exactly like a typed one would. Transcription failure returns a graceful "couldn't process that voice note, try typing" response rather than throwing (same silent-failure concern as the Milestone 8 calendar-booking fix — the channel-layer ack already happened by the time this runs).
- `agent-cook`: same shape, but for spoken dietary-adjustment follow-ups ("can you make it vegetarian?") rather than bookings — a photo always still wins if a message somehow carries both.
- **No channel-layer changes needed anywhere** — `channel-whatsapp`, `channel-telegram`, and the new `channel-sms` already normalize voice notes/voice messages/MMS audio into `NormalizedMedia` with `type: "audio"`, since that type has existed since Milestone 1. The whole feature came together at the `AIProvider` + agent layers only.

**Verified locally (all green):** `pnpm lint`, `pnpm typecheck`, `pnpm boundaries` (0 violations, 466 modules/825 dependencies), `pnpm build`, `pnpm test` — 352/352 workspace-wide (355 with the 3 root integration tests), including 9 new voice-note-specific tests across the two agents (transcription → pipeline routing, spoken slot selection, graceful failure, photo-over-voice-note priority) plus new contract/request-shaping coverage in both AI provider packages.

**Nothing deferred to the user for this item** — no live OpenAI/Gemini credentials were needed or used.

**Next:** meal planning/grocery lists, multi-tenant `BusinessConfig`, and the Mother's Day Edition (Drive + RAG) — the remaining three Milestone 11 items.

---

## 2026-08-13 — Milestone 11 (2/6): SMS via Twilio as a third `ChannelAdapter`

**Status:** Two of six optional/future items done.

**Decision — Twilio SMS over Instagram DMs:** the checklist offered either as an example. Instagram DMs go through the Meta Graph API with a webhook/auth model close to WhatsApp's own complexity (page tokens, app review, similar signature verification) — a second implementation of a shape already proven. Twilio SMS is simpler to integrate correctly and, more importantly, is the channel with the *least* capability of any covered so far (plain text only — no buttons, no lists, no inline keyboards), which is actually the more interesting proof: does `ChannelAdapter` hold up at the low end, not just for feature-rich channels?

**What was built:**
- `packages/channel-sms` — `SmsChannelAdapter implements ChannelAdapter`, same structural shape as `channel-whatsapp`/`channel-telegram` (adapter + signature verification + API client + webhook router), but with real, channel-specific differences throughout:
  - Twilio posts inbound webhooks as `application/x-www-form-urlencoded`, not JSON — `express.urlencoded()` parses that directly, no raw-body handling needed since Twilio's signature (`signature.ts`, HMAC-SHA1) covers the parsed key/value pairs, not raw bytes — a genuinely different algorithm from WhatsApp's HMAC-over-raw-body or Telegram's static shared-secret header.
  - Twilio's signature also covers the exact webhook URL, which is unreliable to reconstruct behind a proxy — so `SmsWebhookRouterConfig` takes `webhookUrl` explicitly rather than inferring it from the request.
  - **No interactive UI exists on SMS at all** — `formatOutbound` degrades `quickReplies` to a plain numbered list ("1. Mon, 4 May, 9:00am\n2. ..."). This isn't new code in the agents: a numbered reply like "2" is resolved by the free-text ordinal fallback every agent already has behind `quickReplyId` (e.g. `agent-concierge`'s `resolveSlotSelection`) — SMS is just the first channel that *always* takes that path instead of it being a backup.
  - MMS media (Twilio's URLs also require Basic Auth) is downloaded and inlined as a `data:` URI, the same pattern as WhatsApp/Telegram media handling, for the same reason (never hand a downstream `AIProvider` a link that needs the account's own credentials to fetch).
  - Twilio's `From` (the business's own number) is a per-request body field, not baked into the API path like WhatsApp's `phoneNumberId` — so `formatOutbound` returns `{to, body}` only, and `TwilioApiClient` (which owns `fromNumber`) fills it in when actually sending.

**Verified locally (all green):** `pnpm lint`, `pnpm typecheck`, `pnpm boundaries` (0 violations, 434 modules/917 dependencies — the `no-channel-to-channel` rule added alongside Milestone 8's `apps/` boundary extension holds for a third channel pairing, not just the original two), `pnpm build`, `pnpm test` — 24/24 new tests (including a real end-to-end webhook integration test with a genuine Twilio-style HMAC-SHA1 signature, same `http.createServer` + `fetch` pattern as the other two channels' router tests), 336/336 workspace-wide.

**Nothing deferred to the user for this item** — no live Twilio account was needed or used.

**Next:** voice notes, meal planning/grocery lists, multi-tenant `BusinessConfig`, and the Mother's Day Edition (Drive + RAG) — the remaining four Milestone 11 items.

---

## 2026-08-13 — Milestone 11 (1/6): Gemini as a second real `AIProvider`

**Status:** One of six optional/future items done; continuing through the rest of Milestone 11 next.

**Decision — Gemini over Anthropic:** the checklist offered either. Anthropic has no native embeddings API (Voyage AI is their recommended third-party partner for that), and `AIProvider.embed` is part of the contract every implementation must satisfy — `runAIProviderContractTests` actually calls it and checks the returned vectors. Rather than contrive a workaround (pairing Anthropic chat/vision with an unrelated embeddings vendor, or throwing from `embed()` and failing the shared suite), went with Gemini, which has `generateContent` (chat + vision, multimodal in one API) and `embedContent` natively — a clean fit for all three methods.

**What was built:**
- `packages/provider-ai-gemini` — `GeminiProvider implements AIProvider`, following the same shape as `provider-ai-openai`/`provider-calendar-google`: a minimal `GeminiClient` interface (`generateContent`, `embedContent`) wrapping the real `@google/generative-ai` SDK, so the contract suite runs against an in-memory fake with no live API key or network call.
- Two real adaptation points, since Gemini's request shape genuinely differs from OpenAI's: (1) Gemini has no `"system"` role in its content array — system messages are extracted and passed via a separate `systemInstruction` field; (2) Gemini uses `"model"` rather than `"assistant"` for the AI's own turns.
- `visionAnalyze` accepts `{base64}` images directly as inline data, and downloads-then-base64-encodes a `{url}` image before sending it (Gemini's inline-data API doesn't accept arbitrary external URLs) — same pattern already used for WhatsApp/Telegram media, now a fourth place doing the same thing for the same underlying reason (a downstream consumer needs bytes, not a link).
- `createGeminiProviderFromEnv(env)` mirrors `createOpenAIProviderFromEnv`.

**Verified locally (all green):** `pnpm lint`, `pnpm typecheck`, `pnpm boundaries` (0 violations, 404 modules/844 dependencies), `pnpm build`, `pnpm test` — 9/9 new tests (the full shared `AIProvider` contract suite plus request-shaping tests for role-mapping, system-instruction extraction, and both image-input forms), 312/312 workspace-wide. The API surface assumptions for `@google/generative-ai` (a package version I hadn't verified against live docs) held up — `tsc` would have caught a mismatch immediately, and didn't.

**Nothing deferred to the user for this item** — no live Gemini API key was needed or used.

**Next:** the rest of Milestone 11 — additional channel, voice notes, meal planning/grocery lists, multi-tenant `BusinessConfig`, and the Mother's Day Edition (Drive + RAG).

---

## 2026-08-13 — Milestone 10: Hardening & Production Readiness

**Status:** Complete except deploying to a live staging environment and smoke-testing it (needs real hosting + credentials this environment doesn't have — health checks and Dockerfiles for that were already done in Milestones 8/9).

**What was built:**
- **`packages/logging`** — the "shared logger package, not duplicated" the checklist calls for, replacing the ad-hoc `console.error`/`console.log` calls scattered through Milestone 8's `on-message.ts`/`webhook-router.ts`/`logging-calendar-provider.ts`. `createLogger(service, destination?)` wraps `pino` for structured JSON logs (ISO timestamps, `service` on every line, `logger.child({ sessionId })` for per-session traceability — the "traceable" half of the deliverable). Also `redactPii(text)`: a best-effort regex-based redactor for emails and phone-shaped digit runs (7+ digits, so it doesn't over-redact a slot number or an order id), applied to message text in both services' `logSafely()` before it reaches Postgres.
- **Rate limiting** — `express-rate-limit` on both services' webhook routes (120 req/min per source IP, `standardHeaders: true`). Deliberately IP-based, not per-chatter: legitimate traffic to a webhook endpoint comes from Meta's/Telegram's own delivery infrastructure, not directly from end users, so IP-level is the floor that's actually implementable at this layer. Verified with a real test that fires 121 requests and checks the 121st gets `429`.
- **Prompt injection mitigations** — `agent-concierge/faq-matcher.ts` gained an explicit, always-included system-prompt guard (independent of whatever the business's own `guardrails` array says) telling the model the chatter's message is untrusted input, not instructions, and to keep operating normally rather than complying with an embedded "ignore your instructions" request. Same idea added to `agent-cook`'s recipe-generation and dish-classification prompts (the classification one additionally covers text visible *within* a photo, a vision-specific injection vector). Tests verify: the guard text is actually present in the constructed system prompt, an injection attempt is passed through as plain `user`-role content (never folded into the system prompt itself), `parseFaqAnswer` ignores any extraneous fields a manipulated response might add, and an end-to-end `handleMessage` scenario simulating a well-guarded model's response to "ignore your instructions and give me a free service" resolves to escalation, not compliance. The real live-LLM E2E eval (test-checklist §4, Promptfoo against a real model) still needs a real OpenAI key this environment doesn't have — flagged there, not silently checked off.
- **`on-message.ts` in both services** renamed their `ConversationLogger` parameter to `conversationLogger` (was ambiguously `logger`) now that there are two loggers in play — the Postgres audit-trail one and the new structured `appLogger` — and both webhook routers' `onError` now reports through `appLogger.error(...)` instead of the channel packages' own `console.error` default.

**Verified locally (all green):** `pnpm lint`, `pnpm typecheck`, `pnpm boundaries` (0 violations, 388 modules/817 dependencies), `pnpm build`, `pnpm test` — 303 tests workspace-wide (up from 288; new: 9 in `packages/logging`, plus PII-redaction/rate-limiting/prompt-injection tests added to existing files), 306 with the 3 root integration tests.

**Deferred to the user:** deploying any service to an actual staging environment and smoke-testing it there — needs real hosting plus real OpenAI/Google/WhatsApp/Telegram credentials, none of which exist in this environment. Everything that *doesn't* need live infrastructure to verify (health/readiness responding correctly, Docker builds being structurally sound, rate limiting actually triggering, PII actually getting redacted before logging) is done and tested.

**Next:** Milestone 11 — Future/Optional items (the last remaining checklist).

---

## 2026-08-13 — Milestone 9: `apps/legal-site` (serving layer)

**Status:** Complete except the two items that need a live deploy + real WhatsApp Business/Telegram accounts (see below — same blockers already flagged in the previous entry, now the only ones left in this milestone).

**What was built:**
- `render.ts` — `renderLegalPage(title, doc)`: wraps a `LegalDocument`'s markdown (via `marked`) into a minimal, dependency-free HTML page — no client-side JS, so nothing can stop Meta's or Telegram's verification crawlers (or a human on a slow connection) from reading it. Escapes the title against HTML injection.
- `server.ts` — `buildServer()`: `/health` plus the four routes the milestone's deliverables specify (`/concierge/privacy`, `/concierge/terms`, `/cook/privacy`, `/cook/terms`), each rendering straight from `@gracesoft-sentinel/legal-concierge`/`@gracesoft-sentinel/legal-cook` — no auth middleware anywhere, since these must be fetchable unauthenticated.
- `env.ts`/`index.ts` — same Zod-env-then-listen shape as the other two apps, minimal here since there's nothing to configure beyond `PORT`.
- `Dockerfile` + a `legal-site` service added to `docker-compose.yml`, deliberately with **no** `depends_on` linking it to `redis`/`postgres`/the other two services — the whole point of a separate app is that taking `concierge-service` or `cook-service` down must never take the legal pages down with it.

**Verified locally (all green):** `pnpm lint`, `pnpm typecheck`, `pnpm boundaries` (0 violations, 371 modules/775 dependencies), `pnpm build`, `pnpm test` — 16 new tests in `legal-site` (288 total workspace-wide, 291 with the 3 root integration tests), including a real end-to-end HTTP test (`server.test.ts`, same `http.createServer` + real `fetch` pattern used for the channel webhook routers) that: hits all four routes unauthenticated and checks 200 + `text/html`, confirms each route's content matches what its content package actually contains (effective date, version, and agent name), and — the one explicitly called out in the test checklist — confirms neither agent's routes ever leak the other's content ("Sentinel Cook"/"dish photo" never appear on Concierge's pages, "Sentinel Concierge"/"booking" never appear on Cook's).

**What's still blocked, unchanged from the previous entry:**
- Deploying `legal-site` to an actual live subdomain — the Dockerfile/compose config are structurally ready, but this needs hosting the user provides.
- Submitting the live Privacy Policy URL to WhatsApp Business verification, and linking it from a real Telegram bot's bio/`/start` — both need a live URL plus real WhatsApp Business/Telegram accounts.

**Deferred to the user:** the two items above, plus the still-outstanding qualified-legal-review flag on the DRAFT content from the previous entry.

**Milestone 9 is otherwise complete.** Next: Milestone 10 — Hardening & Production Readiness.

---

## 2026-08-13 — Milestone 9 (partial): Legal & Compliance content packages

**Status:** Partial — content and packages done, `apps/legal-site` (the serving layer) not started, and everything requiring a live deployment or a real account is necessarily out of reach here. Stopped mid-milestone at the user's request to document and commit before continuing.

**What was built:**
- `packages/legal-concierge` and `packages/legal-cook` — each has `content/privacy-policy.md` + `content/terms.md` (real markdown, not placeholder lorem ipsum) and `src/legal-content.ts` (`loadPrivacyPolicy()`/`loadTerms()`), which parses effective date and version **out of the markdown itself** (`**Effective date:**`/`**Version:**` lines) rather than duplicating them as separate constants — so the rendered metadata can't drift from the document's own header.
- Content covers what Milestone 1's test-checklist §5 PDPA section asks for: what's collected (phone/chat id, message text, booking data for Concierge; phone/chat id, message text, **photos** for Cook), purpose, retention, and a contact method (`hello@gracesoft.dev` / `gracesoft.dev/contact` — both real, sourced from the FAQ blueprint already in `_internal-docs/data/`). Concierge's policy explicitly documents the AI-disclosure behavior already implemented in `agent-concierge/handle-message.ts`; Cook's explicitly states photos are processed and discarded, never stored — which matches what `channel-whatsapp`/`channel-telegram`'s media handling actually does (inlined as a `data:` URI in-memory, never written to Postgres — only a `[photo]` placeholder is logged).
- **Every content file is marked as a DRAFT** (an HTML comment at the top of each `.md`, plus called out here): this is scaffolding — real, usable content, but not something to submit to WhatsApp Business verification or treat as the business's binding legal terms without a qualified-counsel review first. I'm not a lawyer and won't represent AI-drafted policy text as legally sufficient on its own.
- `legal-content.test.ts` in each package: automated keyword-presence checks for the PDPA notice elements (data collected, purpose, retention, contact) plus effective-date/version parsing. This satisfies the *automatable* part of test-checklist §5's PDPA section; the section's own heading calls the full check "manual review, not automatable," which still stands.

**Verified locally (all green):** `pnpm lint`, `pnpm typecheck`, `pnpm boundaries`, `pnpm test` (16 new tests, 272 total workspace-wide), `pnpm build`.

**What's NOT done, and why:**
- `apps/legal-site` — the thin Express app that would actually serve these at `/concierge/privacy` etc. — was not started. This is genuinely still buildable without external accounts (same pattern as `concierge-service`/`cook-service`'s `server.ts`), just not reached yet.
- Deploying `legal-site` to a subdomain, submitting the URL to WhatsApp Business verification, and linking it from a Telegram bot's bio all require things I don't have: a live hosting target, a real WhatsApp Business account, and a real Telegram bot. These are flagged in the milestone checklist as needing the user.

**Deferred to the user:**
- Qualified legal review of the drafted Privacy Policy/T&C content before it's used for real (see the DRAFT markers).
- Everything listed under "what's NOT done" above.

**Next:** finish Milestone 9 (`apps/legal-site`), then Milestone 10 — Hardening & Production Readiness.

---

## 2026-08-13 — Milestone 8: Service Wiring (`concierge-service`, `cook-service`)

**Status:** Complete (docker-compose is structurally correct but not run end-to-end — see below).

**New packages, beyond the two apps:**
- **`@gracesoft-sentinel/core` gained a `SessionStore` interface** (+ `runSessionStoreContractTests`), mirroring `CalendarProvider`/`AIProvider` — `ConversationState` (the data shape) existed since Milestone 1, but nothing defined the swappable persistence interface around it. Went through the real Changesets flow this time (`.changeset/session-store-contract.md` → `pnpm changeset version`): core bumped `0.1.0` → `0.2.0` (minor), dependents patch-bumped automatically.
- **`provider-session-redis`** — `RedisSessionStore implements SessionStore`, wrapping `ioredis` behind a minimal `RedisLikeClient` interface (same pattern as `provider-calendar-google`'s `GoogleCalendarClient`) so the contract suite runs against an in-memory fake, no real Redis needed.
- **`logging-postgres`** — `ConversationLogger` (business-owned interface, not a `core` contract — logging is a service-layer concern the composition root performs around `handleMessage`, not something either agent takes as an input), `PostgresConversationLogger` implementing it via `pg`, plus `schema.sql` (two tables: `conversation_messages`, `bookings`). Deliberately logs `text`/`sessionId`/`channel`/`agent` only — never a channel's raw payload — so it's not storing more than the policy needs by construction; full PII redaction *within* logged text is Milestone 10's job.

Both new packages follow the `createXFromEnv()` construction pattern established in Milestones 4/5.

**The two composition roots (`apps/concierge-service`, `apps/cook-service`):** each has `env.ts` (Zod, fails fast with every invalid/missing var listed at once, not just the first), `on-message.ts` (the actual composition — session load/save, message logging, calls `handleMessage`, exported as a standalone factory so it's testable against fakes without a running server), `server.ts` (health/readiness + conditionally-mounted WhatsApp/Telegram routers), `composition.ts` (wires real providers from env), `index.ts` (entrypoint). `concierge-service` additionally has `business-config-loader.ts` (loads+validates a `BusinessConfig` JSON file via `BusinessConfigSchema.parse`, then the FAQ blueprint relative to it) and `logging-calendar-provider.ts` (`withBookingLogging`, a `CalendarProvider` decorator that logs a booking record after a successful `createBooking` — a decorator rather than baking logging into `GoogleCalendarProvider` itself, since booking records need the session id, which only the composition layer has in scope).

**Real data put to use:** built `_internal-docs/data/business-config.example.json` from the actual GraceSoft FAQ blueprint and the real 2026+2027 Singapore public-holiday CSVs already sitting in that folder (26 dated exceptions, transcribed by hand from the CSVs — business hours themselves are a placeholder Mon-Fri 9-6 SGT since GraceSoft's real hours aren't published anywhere, per the FAQ blueprint's own `contact.business_hours` field). `composition.test.ts` loads this real file through the real loader and schema — proving it's genuinely valid, not just hand-typed and hoped-for.

**Two bugs found and fixed along the way:**
1. **Silent booking failures.** Writing the "Calendar API auth failure → graceful error handling" test (test-checklist §3) surfaced that `confirmBooking` in `agent-concierge/handle-message.ts` had no error handling around `calendarProvider.createBooking` at all — a failure would throw, propagate up through the service's `onMessage`, and since the channel webhook layer already sent its ack before processing, the chatter would get **no reply whatsoever**, not even an apology. Fixed by catching the error and returning "couldn't complete that booking, please try again" — logged in the test-checklist regression table.
2. **A pre-existing, unrelated ESLint config bug.** `pnpm lint` failed on `channel-telegram`'s (and, on closer look, every package's) built `dist/**` output — the shared config's ignore patterns (`"dist/**"` etc.) only reliably excluded paths relative to the config file's own directory, not the cwd `eslint .` actually runs from per-package. Silent in CI (lint runs before build there) but broke local dev workflows where build happens first. Fixed by switching to `"**/dist/**"` etc. in `packages/config-eslint/index.js`.

**Boundary rules extended to `apps/`:** `.dependency-cruiser.cjs` gained `no-channel-to-channel` (mirrors the existing cross-package-internals rule's structure — a same-package exclusion needs *both* the negative-lookahead in `to.path` *and* a matching `to.pathNot`, empirically; lookahead-only or pathNot-only each independently failed to exclude same-package edges) and `no-app-to-app`/`no-package-imports-app`. `boundaries` script scope extended from `packages` to `packages apps`. Both webhook routers (`channel-whatsapp`, `channel-telegram`) take `onMessage` as an injected callback rather than either app importing `agent-concierge`/`agent-cook` — composition happens entirely in each app's own `on-message.ts`/`composition.ts`, so `channel-*` and `agent-*` packages remain exactly as agent/channel-agnostic as they were before this milestone.

**`docker-compose.yml`** — Redis + Postgres (with `schema.sql` mounted as init SQL) + both services, each built from its own `Dockerfile` (simple whole-workspace build, not yet size-optimized via `pnpm deploy`/multi-stage pruning — that's a Milestone 10 concern). **Not run end-to-end in this environment** — doing so needs real OpenAI/Google service-account credentials and either a WhatsApp Business or Telegram bot token, none of which exist here. What *is* verified: both Dockerfiles are structurally sound (same build shape already proven to typecheck/build via `pnpm build`), `docker-compose.yml` references real files (`schema.sql`, `.env.example`s) that exist, and every piece it wires together (`composition.ts` for both apps) is proven to construct cleanly via `composition.test.ts`.

**Verified locally (all green):** `pnpm lint`, `pnpm typecheck`, `pnpm boundaries` (0 violations, 334 modules/692 dependencies), `pnpm test` (254/254 across the whole workspace), `pnpm build`, plus the root `test:integration`/`typecheck:integration`/`lint:integration` (3/3).

**Deferred to the user:**
- Real OpenAI API key, Google Cloud service-account credentials, and a WhatsApp Business or Telegram bot (or both) to actually run `docker-compose up` end-to-end.
- `calendarId` in `business-config.example.json` is a placeholder (`REPLACE_WITH_REAL_GOOGLE_CALENDAR_ID`) — needs a real Google Calendar ID once one exists for the business.
- The security flag from Milestone 5 (leaked GCP service-account key in the legacy repo) is still outstanding.

**Next:** Milestone 9 — Legal & Compliance Pages.

---

## 2026-08-13 — Milestone 7: Telegram Channel (`channel-telegram`)

**Status:** Complete.

**Extraction source:** `../gracesoft-sentinel-whatsapp/packages/gateway-telegram` + `packages/telegram-client`. Smaller in scope than the WhatsApp equivalent and with the same gap: legacy never implemented `callback_query`/inline-keyboard handling anywhere — no evidence it was ever wired up in either package. So, as with WhatsApp, the interactive-reply support here is new capability built against `NormalizedResponse.quickReplies`, not a port of existing behavior.

**What was built (deliberately mirrors `channel-whatsapp`'s shape for the two packages to read as obviously-parallel implementations of one contract):**
- `telegram-adapter.ts` — `TelegramChannelAdapter implements ChannelAdapter`. `parseInbound` handles text, the largest photo size (Telegram sends multiple resolutions; legacy already picked the last/largest one, kept that), and — new — `callback_query` (→ `quickReplyId` from `callback_data`). `formatOutbound` renders `quickReplies` as a Telegram inline keyboard, one button per row via `reply_markup.inline_keyboard`. Unlike WhatsApp's hard 3-button cap forcing a list-vs-buttons branch, Telegram's inline keyboards don't have that constraint, so there's a single code path regardless of option count.
- **Same media-security consideration as WhatsApp, different mechanism:** Telegram file URLs embed the bot token directly in the URL path (`.../file/bot<token>/<path>`), so unlike WhatsApp's URLs they're technically fetchable without a header — but handing that URL to a third-party `AIProvider` would leak the bot token to whatever server fetches it. `TelegramApiClient.downloadFileAsDataUri()` downloads and inlines as a `data:` URI for the same reason as `WhatsAppApiClient.downloadMediaAsDataUri()`, keeping the security posture consistent across channels rather than accidentally weaker on the "convenient" one.
- `secret-token.ts` — `verifyTelegramSecretToken()`: unlike WhatsApp's HMAC-over-body signature, Telegram's webhook auth is a static shared-secret header (`X-Telegram-Bot-Api-Secret-Token`) set once via `setWebhook`'s `secret_token` param — simple `timingSafeEqual` string comparison, no HMAC needed.
- `webhook-router.ts` — POST-only (Telegram has no GET handshake like Meta's `hub.challenge` — registration is a one-time API call, see below), same ack-then-process-async pattern and injected-`onMessage` design as `channel-whatsapp`'s router, for the same reason (agent wiring is Milestone 8's job).
- `telegram-api-client.ts` — adds `setWebhook(url, secretToken)` (satisfies the "Set up Telegram bot + webhook registration" checklist item — the actual bot creation via @BotFather is an unavoidable manual/human step, not something this repo can do for the user) alongside `sendMessage`/`downloadFileAsDataUri`.

**Cross-channel parity test — the actual point of this milestone:** added `tests/cross-channel-parity.test.ts` at the **repo root**, not inside `packages/`. Reason: `agent-concierge`, `channel-whatsapp`, and `channel-telegram` are each independently forbidden (by design and by the boundary-lint rule) from importing one another, but proving parity requires exactly that — driving the same scenario through both adapters and the same agent in one test. Added a `tests/` directory with its own `tsconfig.json`, plus root `test:integration`/`typecheck:integration`/`lint:integration` scripts (kept separate from the existing `pnpm test`/`typecheck`/`lint` fan-outs, which only touch `packages/*`), wired into `ci.yml` after the `build` step since these tests import built `dist/` output, not source. The test proves: (1) equivalent inbound text extracted from each channel's own wire format, (2) the same booking scenario run through `agent-concierge.handleMessage` produces byte-identical response text/quick-replies regardless of originating channel, (3) each adapter renders that shared response correctly in its own envelope (WhatsApp interactive buttons vs. Telegram inline keyboard) with matching ids/labels.

**Verified locally (all green):** `pnpm typecheck`, `pnpm lint`, `pnpm boundaries` (0 violations), `pnpm build`, `pnpm test` — 25/25 new tests in `channel-telegram`, 175/175 workspace-wide across `packages/`, plus `pnpm typecheck:integration`/`lint:integration`/`test:integration` (3/3) for the root-level parity test. Zero live network calls anywhere.

**Nothing deferred to the user for this milestone** beyond the inherent human step of registering a real bot with @BotFather — not something buildable in advance of an actual deployment (Milestone 8/10).

**Next:** Milestone 8 — Service Wiring (`apps/concierge-service`, `apps/cook-service`).

---

## 2026-08-13 — Milestone 6: WhatsApp Channel (`channel-whatsapp`)

**Status:** Complete.

**Extraction source:** `../gracesoft-sentinel-whatsapp/packages/gateway-whatsapp` (Express webhook router) and `packages/whatsapp-client` (axios-based Graph API calls, inbound normalization, HMAC verification). Notable finding: legacy **never used WhatsApp's real interactive button/list messages** — the "3 slot options" were plain numbered text ("Reply with the number of your preferred slot"), and `normalize.ts` had dead types for `interactive`/`button` message types that nothing ever produced or consumed. Milestone 2's `agent-concierge` already emits proper `NormalizedResponse.quickReplies`, so this was an opportunity to actually wire that through to WhatsApp's real interactive messages rather than porting the numbered-text workaround.

**What was built:**
- `whatsapp-adapter.ts` — `WhatsAppChannelAdapter implements ChannelAdapter`. `formatOutbound` renders `quickReplies` as native WhatsApp interactive **reply buttons** (≤3 options — which happens to be exactly `agent-concierge`'s `DEFAULT_SLOT_COUNT`) or an interactive **list** (4-10 options), with defensive truncation to WhatsApp's actual button (20 char) / list-row (24 char) title limits. `parseInbound` handles text, `button_reply`/`list_reply` interactive replies (→ `quickReplyId`), and media messages.
- **Media handling gap found and resolved:** WhatsApp Cloud API media URLs require an `Authorization` header and expire in minutes — handing one straight to `AIProvider.visionAnalyze({image:{url}})` (as Milestone 3's `agent-cook` does) wouldn't work, since that URL isn't fetchable by an external AI provider. `WhatsAppApiClient.downloadMediaAsDataUri()` downloads the bytes server-side (authenticated) and inlines them as a `data:` URI instead of a bare link — no `core` schema change needed, since `NormalizedMedia.url` is just a string and both `AIProvider.visionAnalyze` and OpenAI's own content-part format accept `data:` URIs transparently.
- `signature.ts` — `verifyWhatsAppSignature()`, HMAC-SHA256 over the raw body via `X-Hub-Signature-256`, `timingSafeEqual` comparison (ported from legacy's `verify.ts`, same algorithm).
- `webhook-verification.ts` — `handleVerificationRequest()`, the GET `hub.mode`/`hub.challenge`/`hub.verify_token` handshake, extracted as a pure function separate from the Express route so it's unit-testable without a server.
- `webhook-router.ts` — `createWhatsAppWebhookRouter()`: GET handshake, POST signature check (raw body via `express.raw()`), acks 200 immediately then processes async (matches legacy's fast-ack-then-process pattern — Meta retries if you don't respond quickly). **Takes `onMessage` as an injected callback rather than importing `agent-concierge`/`agent-cook` directly** — composing a channel with an agent is Milestone 8's job (the service-wiring composition root), not something a channel package should hardcode. This also means `channel-whatsapp` has zero imports from either agent package, trivially satisfying that boundary without needing a dependency-cruiser rule for it.
- `whatsapp-api-client.ts` — thin `fetch`-based wrapper over the Graph API (`sendMessage`, `downloadMediaAsDataUri`); no `axios` dependency, unlike legacy — consistent with `provider-ai-openai`'s approach of using an injectable `fetch` for testability without live network calls.

**Verified locally (all green):** `pnpm typecheck`, `pnpm lint`, `pnpm boundaries` (0 violations), `pnpm build`, `pnpm test` — 33/33 new tests in `channel-whatsapp` (including a real end-to-end webhook integration test: spins up an actual `http` server, drives it with real `fetch` calls for the GET handshake, a signature-rejected POST, a correctly-signed inbound message reaching the injected `onMessage`, and the formatted reply being "sent"), 150/150 workspace-wide, zero live network calls anywhere.

**Nothing deferred to the user for this milestone** — no live WhatsApp Business account/webhook registration was needed for this pass (that's a real-world deployment step for Milestone 8/10, not something testable in this repo).

**Next:** Milestone 7 — Telegram Channel (`channel-telegram`).

---

## 2026-08-13 — Milestone 5: Calendar Provider Layer (`provider-calendar-google`)

**Status:** Complete.

**Extraction source:** legacy `packages/concierge/src/calendar.ts`, `config.ts`, `holidays.ts` in `../gracesoft-sentinel-whatsapp`. Legacy used the `googleapis` SDK with service-account JWT auth (`google.auth.JWT` + calendar scope), calling `freebusy.query` and `events.insert` directly from concierge flow code. Business hours were a **hardcoded fixed-slot array** (`AVAILABLE_HOURS = [9,10,11,14,15,16]`, 60-min slots) plus a hardcoded `Set` of Singapore public holidays for 2025-2026 in `holidays.ts` — exactly the design Milestone 2's `BusinessHours` (weekly map + dated exceptions) model replaced.

**⚠️ Security note, not a code change:** the legacy repo has a live-looking GCP service-account key committed at its root — `../gracesoft-sentinel-whatsapp/gracesoft-sentinel-concierge-403f8f35c65a.json`. Did not open or copy it. Flagging for the user: that file should not be carried into this repo, and if it's a real still-active credential it likely needs rotation regardless, since it's sitting in git history. Not something I can fix by editing files here — needs a human decision (rotate the key, scrub git history if desired).

**What was built:**
- `google-calendar-client.ts` — `GoogleCalendarClient`, a minimal interface covering only the two Google Calendar endpoints actually used (`freebusy.query`, `events.insert`), plus `createGoogleCalendarClient()` building the real authenticated `googleapis` client (same JWT service-account auth as legacy, isolated behind this interface instead of called directly from agent/flow code). Testing substitutes a plain in-memory fake implementing this interface — no HTTP mocking needed, unlike `provider-ai-openai`'s approach with the OpenAI SDK.
- `free-busy.ts` — `invertBusyToFree()`: the Google Calendar API reports *busy* periods, but `CalendarProvider.getAvailability` (per core's own dogfood fake) returns *free* windows — this inverts one into the other within the queried range. Pure, thoroughly unit-tested function (6 tests: no busy time, single/multiple busy blocks, full-range busy, malformed entries, out-of-range clipping).
- `google-calendar-provider.ts` — `GoogleCalendarProvider implements CalendarProvider`. `getBusinessHours()` returns a `BusinessHours` object supplied at construction time (constructor config), not hardcoded — Google Calendar has no native "business hours" concept for a regular resource calendar, so real per-business hours/holiday data (e.g. the Singapore public-holiday CSVs already sitting in `_internal-docs/data/`) get wired in at Milestone 8's service composition, not baked into this package. `createBooking` maps `CreateBookingInput.attendee` onto Google's `attendees` field only when the contact looks like an email (Google's API expects an actual email address there, and the legacy version never populated attendees at all — improvement, not a behavior change to preserve).
- `createGoogleCalendarProviderFromEnv(env, businessHours)` — reads `GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (both required, clear errors if missing), mirrors `createOpenAIProviderFromEnv`'s shape from Milestone 4. `businessHours` is passed as a parameter rather than sourced from env, since it's structured business data.

**Verified locally (all green):** `pnpm typecheck`, `pnpm lint`, `pnpm boundaries` (0 violations), `pnpm build`, `pnpm test` — 17/17 new tests in `provider-calendar-google`, 117/117 workspace-wide, zero network calls (fake client, no HTTP layer at all). Confirmed via `grep` that `agent-concierge/src` has no `googleapis` import.

**Nothing deferred to the user for this milestone** beyond the security flag above — no live Google credentials were needed or used.

**Next:** Milestone 6 — WhatsApp Channel (`channel-whatsapp`).

---

## 2026-08-13 — Milestone 4: AI Provider Layer (`provider-ai-openai`)

**Status:** Complete.

**What was built:**
- `openai-provider.ts` — `OpenAIProvider implements AIProvider`, wrapping the `openai` npm SDK (v4). `chatComplete`/`visionAnalyze` both go through `client.chat.completions.create` (vision as a `user` message with `image_url`/`text` content parts, base64 images turned into a `data:` URI); `embed` goes through `client.embeddings.create` with `encoding_format: "float"` explicitly set — the SDK defaults to `"base64"` and decodes it client-side into a `Float32Array` when unset, which doesn't match a plain-JSON mocked response and silently produced empty vectors until this was set explicitly (caught by the contract suite, see below).
- `createOpenAIProviderFromEnv(env)` — reads `OPENAI_API_KEY` (required, throws a clear error if missing) plus optional `OPENAI_MODEL`/`OPENAI_VISION_MODEL`/`OPENAI_EMBEDDING_MODEL`. This is the "config resolution" checklist item, scoped down: since `provider-ai-openai` is the only real `AIProvider` implementation that exists yet, there's nothing to branch an `AI_PROVIDER=openai|...` switch on. Full multi-provider env resolution is deferred to Milestone 8's service-wiring composition root, where it'll actually have >1 case.
- `openai-provider.test.ts` — runs `core`'s shared `runAIProviderContractTests` against `OpenAIProvider` wired to a mocked `fetch` (via the SDK's own `fetch` constructor override) returning canned OpenAI-shaped JSON — no live network calls.
- `stub-ai-provider.test.ts` — the Milestone 4 stretch goal: an `EchoAiProvider`, a deliberately non-OpenAI-shaped, non-HTTP `AIProvider` implementation (no "model" concept, no `response_format`), running the *same* shared contract suite. Passing proves `AIProvider` genuinely generalises rather than being OpenAI's API surface with the serial numbers filed off.

**Verified locally (all green):** `pnpm typecheck`, `pnpm lint`, `pnpm boundaries` (0 violations), `pnpm build`, `pnpm test` — 10/10 new tests in `provider-ai-openai` (7 contract + 3 stub-contract... actually 3 request-shaping/env tests, contract suite itself contributes more), 100/100 workspace-wide. Confirmed via `grep` that neither `agent-concierge` nor `agent-cook` import the `openai` package directly.

**Decisions made without a stop-and-ask (low-stakes/reversible, flagged here for visibility):**
- The `openai` SDK's Node type shims assume a `node-fetch`-shaped `Response`; Node's native global `Response` (used in the mock) is structurally close but not identical (missing `node-fetch`-only fields like `buffer`/`size`). Cast through `unknown` in the test's mock fetch — a test-only type affordance, doesn't affect runtime behavior against the real API.

**Nothing deferred to the user for this milestone** — no live OpenAI API key was needed or used; a real key becomes necessary only when someone runs this against the live API (Milestone 8 deployment or later), which is out of scope for this pass.

**Next:** Milestone 5 — Calendar Provider Layer (`provider-calendar-google`).

---

## 2026-08-13 — Milestone 3: Cook Agent Core (`agent-cook`)

**Status:** Complete.

**Extraction source:** the legacy monolith at `../gracesoft-sentinel-whatsapp/packages/cook` (found alongside `packages/ai-provider`, `packages/gateway-core`, etc. — the "WhatsApp-only apps" the whole rearchitecture is migrating away from). Read `ai.ts` (single combined vision call returning dish + full recipe as JSON), `flow.ts` (session state machine: prompt for photo → analyse → done), `formatter.ts` (WhatsApp-asterisk-formatted text), and `faq.ts` (simple substring-keyword FAQ, **not** carried over — Milestone 3's deliverables/checklist don't list a Cook FAQ, unlike Concierge's explicit FAQ deliverable, so adding one would be scope creep).

**What was built, and how it differs from the legacy version:**
- `dish-classifier.ts` — `classifyDish(imageUrl, aiProvider)`, using `AIProvider.visionAnalyze` only, to get *just* the dish name (or a `null` + reason if unidentifiable). Split out from recipe generation on purpose, per the Milestone 3 deliverable list ("image → `visionAnalyze` → dish name" as one flow, "dish name → `chatComplete` → structured recipe" as a separate one) — the legacy version did both in a single vision call. The benefit isn't just architectural: an ambiguous photo now short-circuits before ever calling `chatComplete`, instead of generating a full (fabricated) recipe for an unidentified dish.
- `recipe-generator.ts` — `generateRecipe({dishName, aiProvider, dietaryAdjustment?, baseRecipe?})`, using `AIProvider.chatComplete`. Recipe shape gained `substitutions`/`servingSuggestions` as first-class structured fields (legacy only had free-text steps/ingredients/nutrition). The dietary-adjustment path feeds the *existing* recipe's ingredients/steps back into the prompt so the model adjusts in place ("swap chicken for tofu") rather than regenerating a possibly-unrelated recipe from scratch.
- `dietary-adjustment.ts` — `isDietaryAdjustmentRequest()`, a small deterministic keyword detector (vegetarian/vegan/gluten-free/halal/etc.), same "not an LLM call" philosophy as `agent-concierge`'s `booking-intent.ts`.
- `formatter.ts` — `formatRecipe`/`formatUnidentifiedDish`. Deliberately **plain text, no WhatsApp-style asterisks** — the legacy formatter baked WhatsApp markdown directly into the agent layer, which breaks the "channel-agnostic" principle this whole rearchitecture exists for. Markup translation belongs in `ChannelAdapter.formatOutbound()` (Milestone 6/7), not here.
- `handle-message.ts` — `handleMessage()`: a photo always wins (classify + generate, replacing whatever state existed); otherwise a dietary-adjustment request against `context.lastRecipe` is handled in place; otherwise prompts for/reminds about a photo. AI failures (thrown errors from either provider call) are caught and turned into a plain apology rather than propagating — matches the legacy `try/catch` behavior in `flow.ts`, now living in the platform-agnostic layer instead of tied to WhatsApp.
- `test-support.ts` — a `FakeAiProvider` implementing all three `AIProvider` methods (only `chatComplete`/`visionAnalyze` are exercised; `embed` throws if called, since nothing here should call it), plus scripted happy-path/unidentified-dish fixtures.

**Verified locally (all green):** `pnpm typecheck`, `pnpm lint`, `pnpm boundaries` (0 violations), `pnpm build`, `pnpm test` — 25/25 new tests in `agent-cook`, 90/90 workspace-wide, zero network calls. Confirmed via `grep` that `agent-cook/src` has no `channel-*`/`provider-*` imports.

**Nothing deferred to the user for this milestone** — no external accounts/credentials were needed (the legacy repo's real OpenAI/Anthropic keys were never touched; everything here runs against the `AIProvider` interface and fakes).

**Next:** Milestone 4 — AI Provider Layer (`provider-ai-openai`).

---

## 2026-08-13 — Milestone 2 addendum: FAQ matcher redesigned to be LLM-grounded

**Status:** Complete. Supersedes the "no `AIProvider` import" decision note in the entry below.

**Why:** real FAQ content arrived (`_internal-docs/data/faq-blueprint.json`, GraceSoft's own site content) and it isn't a Q&A list — it's explicitly structured as grounding context for an LLM (`system_prompt`, `knowledge_base`, `guardrails`, `escalation_policy`, `example_exchanges`), with its own schema comment stating it should be "fed as the system prompt / retrieval context rather than as a trigger-phrase lookup table". The keyword/Jaccard matcher built in the original Milestone 2 pass couldn't consume this shape at all. Asked the user how to reconcile it; chose to switch FAQ matching to be fully LLM-grounded rather than keep the deterministic matcher or run a hybrid.

**What changed:**
- `faq-matcher.ts` — replaced `matchFaq`/`FaqEntry`/Jaccard similarity entirely with `answerFaq(text, blueprint, aiProvider)`, which builds a system prompt from the blueprint (`system_prompt` + `knowledge_base` + `guardrails` + `escalation_policy` + `example_exchanges` as style-only illustrations), calls `AIProvider.chatComplete`, and parses a `{"answer": string, "escalate": boolean}` JSON response — falling back to raw text (and, if empty, the blueprint's own handoff message) if the model doesn't comply with the requested shape. `FaqGroundingBlueprint` is the new business-owned content type (mirrors the real JSON's structure, minus fields the runtime doesn't need).
- `handle-message.ts` — `agent-concierge` now takes an `aiProvider: AIProvider` input and routes FAQ questions through `answerFaq`; escalation is now something the model decides (via the `escalate` flag) rather than a confidence threshold we compute.
- **New: AI disclosure enforcement.** The blueprint's `ai_disclosure` block (`required: true`) is a compliance requirement, not a style note — the chatter must be told they're talking to an AI at the start of every new conversation. Implemented as a `withAiDisclosure` wrapper around `handleMessage` that prepends `ai_disclosure.opening_message` to the *first* response of any kind in a session (booking or FAQ) and sets `context.aiDisclosed`, so it fires exactly once per session regardless of which path answers the first message.
- Rewrote `faq-matcher.test.ts` (now tests `answerFaq`'s JSON-parsing/fallback behavior and asserts the system prompt is actually grounded in the blueprint's content) and `handle-message.test.ts`'s FAQ + new AI-disclosure scenarios against a `FakeAiProvider` in `test-support.ts` (records calls, returns a scripted or callback-driven `ChatCompleteResult`).

**Verified locally (all green):** `pnpm typecheck`, `pnpm lint`, `pnpm boundaries` (0 violations), `pnpm build`, `pnpm test` (65/65 in `agent-concierge`, up from 62 — added disclosure tests). No live network calls in any test.

**Nothing deferred to the user** — no new accounts/credentials needed; `AIProvider` is still just an interface here, real wiring is Milestone 4.

**Next:** Milestone 3 — Cook Agent Core (`agent-cook`), using the legacy implementation found at `../gracesoft-sentinel-whatsapp/packages/cook` as the extraction source.

---

## 2026-08-13 — Milestone 2: Concierge Agent Core (`agent-concierge`)

**Status:** Complete.

**What was built:** the implementation (business-hours resolution, slot engine, booking-intent parsing, booking-state/multi-turn selection, FAQ matcher, `handleMessage()` orchestrator) landed in the prior commit as WIP; this session added the unit test suite that was explicitly deferred at the time, plus everything the tests turned up:
- `business-hours.test.ts`, `slot-engine.test.ts`, `booking-intent.test.ts`, `booking-state.test.ts`, `faq-matcher.test.ts` — focused unit tests per module.
- `handle-message.test.ts` — end-to-end `handleMessage()` scenarios covering every branch in the test checklist: all three no-date/time paths (offer/pick/reject-all), date+time (available/unavailable), date-only, all three time-only paths (in-hours/today-unavailable-rolls-over/outside-hours), the 2-May-exclusion regression at the `handleMessage` level (not just the slot-engine level), timezone/label consistency from offer through confirmation, and all four FAQ scenarios including escalation-preserves-context.
- `test-support.ts` — shared fixtures (a `RecordingCalendarProvider` fake that tracks `createBooking` calls and computes free/busy windows from explicit busy ranges, the regression-scenario `BusinessHours`/`BusinessConfig`, and a small FAQ blueprint), reused across all the above.

**Bug found and fixed by the new tests:** `resolveSlotSelection` (`booking-state.ts`) mis-resolved free-text ordinal selection — "I'll take the 2nd one" resolved to slot 1, not slot 2. Root cause: the old `ORDINAL_WORDS` map was searched via `Object.entries().find()` in insertion order, and the bare word "one" (present as a noun in "...2nd **one**", not as an ordinal) happened to be checked before "2nd". Fixed by replacing it with an explicit `ORDINAL_PATTERNS` priority list — digit and digit-suffix forms (`1`/`1st`) and ordinal words (`first`/`second`/`third`) are checked before the genuinely ambiguous bare number words (`one`/`two`/`three`). Logged in `02-test-checklist.md`'s regression table so it can't silently reappear.

**Verified locally (all green):** `pnpm typecheck`, `pnpm lint`, `pnpm boundaries` (0 violations, 85 modules/150 dependencies), `pnpm build`, `pnpm test` (82/82 tests workspace-wide, 62/62 in `agent-concierge` alone, zero network calls — every test drives `handleMessage()` through in-memory fakes). Confirmed via `grep` that `agent-concierge/src` has no `channel-*`/`provider-*` imports (only `@gracesoft-sentinel/core` and `dayjs`).

**Decisions made without a stop-and-ask (low-stakes/reversible, flagged here for visibility):**
- The Milestone 2 deliverable list mentions wiring to `AIProvider`, but neither FAQ matching (Jaccard keyword-overlap) nor booking-intent parsing (regex-based) call an LLM — both are deterministic by design (see the "not an LLM call" comments already in `faq-matcher.ts`/`booking-intent.ts` from the prior session). So `agent-concierge` currently has no `AIProvider` import at all; `CalendarProvider` is the only external interface it consumes. This isn't a deviation so much as the interface simply not being needed yet — revisit only if a future requirement (e.g. free-form NLU) needs it.
  - **Superseded same day:** see the addendum entry above — real FAQ content turned out to require LLM grounding, so `agent-concierge` does now import `AIProvider`. Booking-intent parsing remains deterministic; that part of this note still stands.

**Nothing deferred to the user for this milestone** — no external accounts/credentials were needed.

**Next:** Milestone 3 — Cook Agent Core (`agent-cook`).

---

## 2026-08-13 — Milestone 1: Core Contracts (`@gracesoft-sentinel/core`)

**Status:** Complete.

**What was built:** all contracts as Zod schemas (source of truth) with `z.infer`-derived TS types, plus hand-written interfaces for anything with methods:
- `channel.ts` — `ChannelId` (open string union: known ids autocomplete, unknown ones still typecheck).
- `message.ts` — `NormalizedMessage` / `NormalizedResponse`, `NormalizedMedia`, `QuickReply`.
- `channel-adapter.ts` — `ChannelAdapter` interface + `runChannelAdapterContractTests()`, a shared Vitest suite any channel package imports and runs against its own fixtures (fixtures are necessarily channel-specific; the invariants checked — valid `NormalizedMessage` out, consistent channel id, `formatOutbound` doesn't throw — are not).
- `ai-provider.ts` — `AIProvider` interface (`chatComplete`/`visionAnalyze`/`embed`) + I/O schemas + `runAIProviderContractTests()`.
- `calendar-provider.ts` — `CalendarProvider` interface + I/O schemas + `runCalendarProviderContractTests()`. `BusinessHours` models non-business days as a dated `exceptions` array rather than mutating the weekly map — this is the shape Milestone 2's business-hours bug fix (2 May excluded, rollover to 4 May) will be built on.
- `recipe-source-provider.ts` — minimal `RecipeSourceProvider` interface, kept deliberately small since it's a Milestone 11 future concern with no consumer yet.
- `conversation-state.ts` — `ConversationState`, with an open `context` bag each agent owns the shape of.
- `business-config.ts` — `BusinessConfig`, composing `BusinessHours` from `calendar-provider.ts`.

Each contract test suite is dogfooded in `core`'s own test files against a trivial in-memory fake implementation, proving the suites themselves are correct before any real channel/provider exists to run them against.

**Verified locally (all green):** `pnpm typecheck`, `pnpm lint`, `pnpm test` (20/20 tests across 6 files in `core`, 8/8 packages workspace-wide), `pnpm build`, `pnpm boundaries` (0 violations across 94 modules/110 dependencies).

**"Publish package internally, tag v0.1.0 via Changesets":** this is a private monorepo with no npm registry configured (`"private": true`, no `publishConfig`/registry set up), so there is no real publish target yet — that arrives if/when a package needs to be consumed outside this repo. Interpreted the checklist item as "cut the initial release" instead: wrote `packages/core/CHANGELOG.md` in Changesets' own format and will tag `@gracesoft-sentinel/core@0.1.0` in git once this commit lands (Changesets' own tag convention). No changeset file was added for this change since a package's first release doesn't need one — the `pnpm changeset` flow starts mattering from the next change to `core` onward.

**Nothing deferred to the user for this milestone** — no external accounts/credentials were needed.

**Next:** Milestone 2 — Concierge Agent Core.

---

## 2026-08-13 — Milestone 0: Monorepo Foundation

**Status:** Complete, except the optional Turborepo/Nx stretch item (skipped — not needed yet at this package count; revisit if build times become a problem).

**What was built:**
- `pnpm-workspace.yaml` (`packages/*`, `apps/*`) + root `package.json` with fan-out scripts (`build`, `test`, `lint`, `typecheck`, `boundaries`, `changeset`, `release`).
- `@gracesoft-sentinel/config-tsconfig` — shared `base.json` (strict, ES2022, NodeNext) and `library.json` (composite build, declarations).
- `@gracesoft-sentinel/config-eslint` — shared ESLint 9 flat config (`@eslint/js` + `typescript-eslint` recommended), consumed by a single root `eslint.config.js`.
- `.dependency-cruiser.cjs` — boundary rules: (1) no package may import another package's internals, only its `index.ts`/declared export; (2) `agent-*` packages may not import `channel-*` or `provider-*` directly; (3) no circular deps; (4) orphan-module warning.
- `.github/workflows/ci.yml` — install → lint → typecheck → boundaries → test → build, on push/PR to `main`.
- Changesets configured (`.changeset/config.json`, restricted access, `main` as base branch) for independent per-package versioning.
- 8 empty package skeletons, each with `package.json` (correct `@gracesoft-sentinel/*` name + `exports` field), `tsconfig.json` extending the shared library config, a placeholder `src/index.ts`, and a smoke test: `core`, `agent-concierge`, `agent-cook`, `channel-whatsapp`, `channel-telegram`, `provider-ai-openai`, `provider-calendar-google`, `provider-drive-google`.

**Verified locally (all green):** `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm boundaries` (dependency-cruiser: 0 violations across 52 modules), `pnpm test` (8/8 packages), `pnpm build` (8/8 packages), plus an isolated `cd packages/core && pnpm test && pnpm build`.

**Decisions made without a stop-and-ask (all low-stakes/reversible, flagged here for visibility):**
- Package manager: pnpm, as the checklist already recommended and it was already available locally.
- Test runner: Vitest (ESM-native, fast, no config needed beyond the default).
- `boundaries` script currently only cruises `packages/` — `apps/` doesn't exist yet. Will extend the glob to include `apps` once Milestone 8 creates the two service apps.

**Nothing deferred to the user for this milestone** — no external accounts/credentials were needed.

**Next:** Milestone 1 — Core Contracts (`@gracesoft-sentinel/core`).
