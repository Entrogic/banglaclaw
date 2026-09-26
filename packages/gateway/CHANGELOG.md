# @entrogic-net/gateway

## 1.6.0

### Minor Changes

- a56d648: Web chat: a Files tab over your workspace (preview, download, history, restore, delete with undo), 📎 file uploads, conversation search/rename/delete, Copy/Retry/Edit message actions, and a 🎤 microphone. New additive API: `/v1/features`, `/v1/workspace/*`, `/v1/transcriptions`, and `PATCH`/`DELETE /v1/sessions/:id`, all in the typed client.

### Patch Changes

- Updated dependencies [a56d648]
  - @entrogic-net/session@1.6.0
  - @entrogic-net/shared@1.6.0
  - @entrogic-net/agent@1.6.0
  - @entrogic-net/knowledge@1.6.0
  - @entrogic-net/auth@1.6.0
  - @entrogic-net/skills@1.6.0
  - @entrogic-net/tools@1.6.0

## 1.5.0

### Minor Changes

- e1eb01e: Sessions carry a `title` (the first user message, at most 80 characters), returned by the API and typed client and searchable with `q`/`query`. Postgres migration `0005_session_titles` adds the column and backfills existing sessions; run `banglaclaw db migrate` after upgrading.

### Patch Changes

- Updated dependencies [bab41ba]
- Updated dependencies [e1eb01e]
  - @entrogic-net/knowledge@1.5.0
  - @entrogic-net/shared@1.5.0
  - @entrogic-net/session@1.5.0
  - @entrogic-net/agent@1.5.0
  - @entrogic-net/auth@1.5.0
  - @entrogic-net/skills@1.5.0
  - @entrogic-net/tools@1.5.0

## 1.4.0

### Patch Changes

- 44ca0e0: `/v1/admin/stats?days=N` no longer returns an extra day between local midnight and UTC midnight: the window now starts at local midnight in the configured timezone.
- Updated dependencies [44ca0e0]
- Updated dependencies [62e3e8e]
- Updated dependencies [44ca0e0]
  - @entrogic-net/session@1.4.0
  - @entrogic-net/shared@1.4.0
  - @entrogic-net/knowledge@1.4.0
  - @entrogic-net/agent@1.4.0
  - @entrogic-net/auth@1.4.0
  - @entrogic-net/skills@1.4.0
  - @entrogic-net/tools@1.4.0

## 1.3.0

### Minor Changes

- 0fbd3fe: Website widget: add `<script src="https://<gateway>/widget.js" async></script>` to any site listed in `channels.widget.allowedOrigins` for a chat bubble that anonymous visitors can use without an API key (signed visitor tokens, CSP frame-ancestors, per-visitor and per-IP limits, live operator replies during a handoff). Set `BANGLACLAW_WIDGET_SECRET` so visitors keep their conversation across restarts.

### Patch Changes

- Updated dependencies [3fccbd1]
- Updated dependencies [0fbd3fe]
  - @entrogic-net/shared@1.3.0
  - @entrogic-net/agent@1.3.0
  - @entrogic-net/auth@1.3.0
  - @entrogic-net/knowledge@1.3.0
  - @entrogic-net/session@1.3.0
  - @entrogic-net/skills@1.3.0
  - @entrogic-net/tools@1.3.0

## 1.2.0

### Minor Changes

- cfbed9e: First release on npm. Install the CLI with `npm install -g @entrogic-net/cli` or run `npx banglaclaw init`. This release also includes the admin dashboard, the Facebook Messenger channel, voice notes, DOCX and URL knowledge sources, BanglaClaw as an MCP server, live operator replies for API clients, and the OpenClaw-style web and terminal chat UIs.

### Patch Changes

- Updated dependencies [cfbed9e]
  - @entrogic-net/agent@1.2.0
  - @entrogic-net/auth@1.2.0
  - @entrogic-net/knowledge@1.2.0
  - @entrogic-net/session@1.2.0
  - @entrogic-net/shared@1.2.0
  - @entrogic-net/skills@1.2.0
  - @entrogic-net/tools@1.2.0
