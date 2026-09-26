# @entrogic-net/observability

## 1.3.0

### Patch Changes

- 3fccbd1: The npm CLI now ships the built-in `calculation` and `time-and-date` skills (turn them off with `skills.builtin: false`). Metrics move from the deprecated `prom-client` to `@prometheus-io/client`, and `marked` is pinned to 15.x for `marked-terminal` compatibility.
- @entrogic-net/session@1.3.0

## 1.2.0

### Minor Changes

- cfbed9e: First release on npm. Install the CLI with `npm install -g @entrogic-net/cli` or run `npx banglaclaw init`. This release also includes the admin dashboard, the Facebook Messenger channel, voice notes, DOCX and URL knowledge sources, BanglaClaw as an MCP server, live operator replies for API clients, and the OpenClaw-style web and terminal chat UIs.

### Patch Changes

- Updated dependencies [cfbed9e]
  - @entrogic-net/session@1.2.0
