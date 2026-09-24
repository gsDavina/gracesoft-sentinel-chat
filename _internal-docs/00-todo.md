# TODO

- [x] Feature: Able to run all Adapters concurrently — each channel on its own path via `packages/webhook-host`; legacy `/webhook` kept (routed by signature header) so live webhooks keep working. Fixed a real bug: with WhatsApp + Telegram both on, Telegram deliveries were 403'd.
- [x] Feature: Slack Channel — `packages/channel-slack`. Pending: a real Slack app pointed at `/slack/webhook`.
- [x] Feature: Link Channel (LINE messenger) — `packages/channel-line`. Pending: a real LINE Official Account pointed at `/line/webhook`.
- [x] Feature: User Data Deletion — `/deletemydata` confirm-then-erase on every channel (`packages/user-data-deletion`); calendar appointments deliberately left in place.
- [x] Demo: Service map — `/services` in demo-service lists every agent behind the switcher with tap-to-switch buttons.
- [x] Demo: GraceSoft Assistant (Desk/Skylight Q&A) — M0-M7 built and tested; see `08-assistant-progress-log.md`. Pending: a live `OPENAI_API_KEY` (eval pass rate, real answers) and droplet/HTTPS deployment.

new criteria:
- [x] create 2 more channels for my branding (see `05-progress-log.md`, 2026-09-24):
	- [x] Maybe generate a template that other UI can build upon — `packages/web-chat-kit`
	- [x] GraceSoft-themed UI (branding guidelines in the _internal-docs folder) — `packages/channel-web-gracesoft`, `/chat/gracesoft/`
	- [x] Dav/Devs-themed UI (branding guidelines in the _internal-docs folder) — `packages/channel-web-davdevs`, `/chat/davdevs/`
- [x] assistant-service:
	- [x] remove the baked in UI (against original criteria)
	- [x] UI should be served via the channel packages — `WEB_GRACESOFT_ENABLED`/`WEB_DAVDEVS_ENABLED`

follow-ups (need a human):
- [ ] Create the Slack app and LINE channel; point them at `/slack/webhook` and `/line/webhook`
- [ ] Set `WEB_CHAT_ACCESS_TOKEN` on any deployment that exposes a web chat
- [ ] Optionally re-register WhatsApp/Telegram webhooks at `/whatsapp/webhook` / `/telegram/webhook` (legacy `/webhook` still works)
- [ ] Decide whether the Dav/Devs chat title should read "Dav/Devs" or "davinaleong.com" (logo reads the latter)
- [ ] Legal review of the updated privacy policies (v1.1.0, still DRAFT)
