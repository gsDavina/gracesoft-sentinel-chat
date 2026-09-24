---
"@gracesoft-sentinel/webhook-host": minor
"@gracesoft-sentinel/channel-slack": minor
"@gracesoft-sentinel/channel-line": minor
"@gracesoft-sentinel/web-chat-kit": minor
"@gracesoft-sentinel/channel-web-gracesoft": minor
"@gracesoft-sentinel/channel-web-davdevs": minor
"@gracesoft-sentinel/concierge-service": minor
"@gracesoft-sentinel/cook-service": minor
"@gracesoft-sentinel/demo-service": minor
"@gracesoft-sentinel/assistant-service": minor
---

Run every channel at once. New `webhook-host` mounts each enabled channel at its own path (`/whatsapp/webhook`, `/telegram/webhook`, `/sms/webhook`, `/slack/webhook`, `/line/webhook`, `/chat/gracesoft/`, `/chat/davdevs/`) and keeps the legacy shared `/webhook` working by routing on signature header. This fixes Telegram deliveries being rejected whenever WhatsApp was also enabled. New Slack and LINE channels, a `web-chat-kit` template, and GraceSoft- and Dav/Devs-branded browser chat channels. SMS is now wired into every service.
