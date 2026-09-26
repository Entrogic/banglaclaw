---
"@entrogic-net/channels": minor
"@entrogic-net/knowledge": minor
"@entrogic-net/shared": minor
"@entrogic-net/cli": minor
---

Files sent on Telegram, WhatsApp or Messenger are saved to the sender's workspace under `uploads/` (PDF, DOCX and HTML as extracted text), and the agent is told where to read them. Controlled by `workspace.uploads` and `workspace.maxUploadBytes`. Adds `extractText` to `@entrogic-net/knowledge`.
