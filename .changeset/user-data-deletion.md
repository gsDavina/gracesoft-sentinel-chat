---
"@gracesoft-sentinel/user-data-deletion": minor
"@gracesoft-sentinel/logging-postgres": minor
"@gracesoft-sentinel/legal-concierge": minor
"@gracesoft-sentinel/legal-cook": minor
"@gracesoft-sentinel/legal-demo": minor
---

`/deletemydata` on every channel: a confirm-then-erase flow that hard-deletes a chatter's session state and Postgres conversation/booking-log rows (`ConversationDataEraser.deleteSessionData`). Privacy policies now document the in-chat command (v1.1.0).
