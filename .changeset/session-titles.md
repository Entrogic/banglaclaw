---
"@entrogic-net/session": minor
"@entrogic-net/storage": minor
"@entrogic-net/gateway": minor
"@entrogic-net/client": minor
"@entrogic-net/cli": patch
---

Sessions carry a `title` (the first user message, at most 80 characters), returned by the API and typed client and searchable with `q`/`query`. Postgres migration `0005_session_titles` adds the column and backfills existing sessions; run `banglaclaw db migrate` after upgrading.
