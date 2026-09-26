# @entrogic-net/client

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
