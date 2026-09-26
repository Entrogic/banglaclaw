# @entrogic-net/client

## 1.6.0

### Minor Changes

- a56d648: Web chat: a Files tab over your workspace (preview, download, history, restore, delete with undo), 📎 file uploads, conversation search/rename/delete, Copy/Retry/Edit message actions, and a 🎤 microphone. New additive API: `/v1/features`, `/v1/workspace/*`, `/v1/transcriptions`, and `PATCH`/`DELETE /v1/sessions/:id`, all in the typed client.

## 1.5.0

### Minor Changes

- e1eb01e: Sessions carry a `title` (the first user message, at most 80 characters), returned by the API and typed client and searchable with `q`/`query`. Postgres migration `0005_session_titles` adds the column and backfills existing sessions; run `banglaclaw db migrate` after upgrading.

## 1.4.0

No changes in this release.

## 1.3.0

No changes in this release.

## 1.2.0

### Minor Changes

- cfbed9e: First release on npm. Install the CLI with `npm install -g @entrogic-net/cli` or run `npx banglaclaw init`. This release also includes the admin dashboard, the Facebook Messenger channel, voice notes, DOCX and URL knowledge sources, BanglaClaw as an MCP server, live operator replies for API clients, and the OpenClaw-style web and terminal chat UIs.
