---
"@entrogic-net/channels": minor
"@entrogic-net/shared": minor
"@entrogic-net/cli": minor
---

Live Telegram replies: the bot's message is edited as the answer is written (at most every 1.5 s), spilling into new messages past 4096 characters. Turn it off with `channels.telegram.liveReplies: false`. Channel adapters can opt in by exposing `editable`.
