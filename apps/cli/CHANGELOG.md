# @entrogic-net/cli

## 1.6.0

### Minor Changes

- a56d648: Web chat: a Files tab over your workspace (preview, download, history, restore, delete with undo), 📎 file uploads, conversation search/rename/delete, Copy/Retry/Edit message actions, and a 🎤 microphone. New additive API: `/v1/features`, `/v1/workspace/*`, `/v1/transcriptions`, and `PATCH`/`DELETE /v1/sessions/:id`, all in the typed client.

### Patch Changes

- Updated dependencies [a56d648]
  - @entrogic-net/gateway@1.6.0
  - @entrogic-net/session@1.6.0
  - @entrogic-net/storage@1.6.0
  - @entrogic-net/shared@1.6.0
  - @entrogic-net/agent@1.6.0
  - @entrogic-net/channels@1.6.0
  - @entrogic-net/knowledge@1.6.0
  - @entrogic-net/observability@1.6.0
  - @entrogic-net/workspace@1.6.0
  - @entrogic-net/agents@1.6.0
  - @entrogic-net/auth@1.6.0
  - @entrogic-net/mcp@1.6.0
  - @entrogic-net/providers@1.6.0
  - @entrogic-net/skills@1.6.0
  - @entrogic-net/tools@1.6.0
  - @entrogic-net/plugin-sdk@1.6.0

## 1.5.0

### Minor Changes

- bab41ba: Files sent on Telegram, WhatsApp or Messenger are saved to the sender's workspace under `uploads/` (PDF, DOCX and HTML as extracted text), and the agent is told where to read them. Controlled by `workspace.uploads` and `workspace.maxUploadBytes`. Adds `extractText` to `@entrogic-net/knowledge`.

### Patch Changes

- e1eb01e: Sessions carry a `title` (the first user message, at most 80 characters), returned by the API and typed client and searchable with `q`/`query`. Postgres migration `0005_session_titles` adds the column and backfills existing sessions; run `banglaclaw db migrate` after upgrading.
- Updated dependencies [bab41ba]
- Updated dependencies [e1eb01e]
  - @entrogic-net/channels@1.5.0
  - @entrogic-net/knowledge@1.5.0
  - @entrogic-net/shared@1.5.0
  - @entrogic-net/session@1.5.0
  - @entrogic-net/storage@1.5.0
  - @entrogic-net/gateway@1.5.0
  - @entrogic-net/agent@1.5.0
  - @entrogic-net/agents@1.5.0
  - @entrogic-net/auth@1.5.0
  - @entrogic-net/mcp@1.5.0
  - @entrogic-net/providers@1.5.0
  - @entrogic-net/skills@1.5.0
  - @entrogic-net/tools@1.5.0
  - @entrogic-net/workspace@1.5.0
  - @entrogic-net/observability@1.5.0
  - @entrogic-net/plugin-sdk@1.5.0

## 1.4.0

### Minor Changes

- 62e3e8e: Live Telegram replies: the bot's message is edited as the answer is written (at most every 1.5 s), spilling into new messages past 4096 characters. Turn it off with `channels.telegram.liveReplies: false`. Channel adapters can opt in by exposing `editable`.
- 44ca0e0: Workspace: sandboxed per-owner text files the agent can list, read, create, write, edit, delete and restore (`workspace_*` tools, off by default; enable `workspace.enabled` and allow `workspace_*`). Every overwrite, edit and delete can be undone from history or trash, and `banglaclaw workspace list | show | history | restore` manages the files. `sessionOwner` now lives in `@entrogic-net/session`.

### Patch Changes

- Updated dependencies [44ca0e0]
- Updated dependencies [62e3e8e]
- Updated dependencies [44ca0e0]
  - @entrogic-net/gateway@1.4.0
  - @entrogic-net/session@1.4.0
  - @entrogic-net/channels@1.4.0
  - @entrogic-net/shared@1.4.0
  - @entrogic-net/workspace@1.4.0
  - @entrogic-net/knowledge@1.4.0
  - @entrogic-net/agent@1.4.0
  - @entrogic-net/observability@1.4.0
  - @entrogic-net/storage@1.4.0
  - @entrogic-net/agents@1.4.0
  - @entrogic-net/auth@1.4.0
  - @entrogic-net/mcp@1.4.0
  - @entrogic-net/providers@1.4.0
  - @entrogic-net/skills@1.4.0
  - @entrogic-net/tools@1.4.0
  - @entrogic-net/plugin-sdk@1.4.0

## 1.3.0

### Minor Changes

- 0fbd3fe: Website widget: add `<script src="https://<gateway>/widget.js" async></script>` to any site listed in `channels.widget.allowedOrigins` for a chat bubble that anonymous visitors can use without an API key (signed visitor tokens, CSP frame-ancestors, per-visitor and per-IP limits, live operator replies during a handoff). Set `BANGLACLAW_WIDGET_SECRET` so visitors keep their conversation across restarts.

### Patch Changes

- 3fccbd1: The npm CLI now ships the built-in `calculation` and `time-and-date` skills (turn them off with `skills.builtin: false`). Metrics move from the deprecated `prom-client` to `@prometheus-io/client`, and `marked` is pinned to 15.x for `marked-terminal` compatibility.
- Updated dependencies [3fccbd1]
- Updated dependencies [0fbd3fe]
  - @entrogic-net/observability@1.3.0
  - @entrogic-net/shared@1.3.0
  - @entrogic-net/gateway@1.3.0
  - @entrogic-net/agent@1.3.0
  - @entrogic-net/agents@1.3.0
  - @entrogic-net/auth@1.3.0
  - @entrogic-net/channels@1.3.0
  - @entrogic-net/knowledge@1.3.0
  - @entrogic-net/mcp@1.3.0
  - @entrogic-net/providers@1.3.0
  - @entrogic-net/session@1.3.0
  - @entrogic-net/skills@1.3.0
  - @entrogic-net/storage@1.3.0
  - @entrogic-net/tools@1.3.0
  - @entrogic-net/plugin-sdk@1.3.0

## 1.2.0

### Minor Changes

- cfbed9e: First release on npm. Install the CLI with `npm install -g @entrogic-net/cli` or run `npx banglaclaw init`. This release also includes the admin dashboard, the Facebook Messenger channel, voice notes, DOCX and URL knowledge sources, BanglaClaw as an MCP server, live operator replies for API clients, and the OpenClaw-style web and terminal chat UIs.

### Patch Changes

- Updated dependencies [cfbed9e]
  - @entrogic-net/agent@1.2.0
  - @entrogic-net/agents@1.2.0
  - @entrogic-net/auth@1.2.0
  - @entrogic-net/channels@1.2.0
  - @entrogic-net/gateway@1.2.0
  - @entrogic-net/knowledge@1.2.0
  - @entrogic-net/mcp@1.2.0
  - @entrogic-net/observability@1.2.0
  - @entrogic-net/plugin-sdk@1.2.0
  - @entrogic-net/providers@1.2.0
  - @entrogic-net/session@1.2.0
  - @entrogic-net/shared@1.2.0
  - @entrogic-net/skills@1.2.0
  - @entrogic-net/storage@1.2.0
  - @entrogic-net/tools@1.2.0
