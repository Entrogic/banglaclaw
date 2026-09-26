# @entrogic-net/session

## 1.4.0

### Minor Changes

- 44ca0e0: Workspace: sandboxed per-owner text files the agent can list, read, create, write, edit, delete and restore (`workspace_*` tools, off by default; enable `workspace.enabled` and allow `workspace_*`). Every overwrite, edit and delete can be undone from history or trash, and `banglaclaw workspace list | show | history | restore` manages the files. `sessionOwner` now lives in `@entrogic-net/session`.

### Patch Changes

- 44ca0e0: `/v1/admin/stats?days=N` no longer returns an extra day between local midnight and UTC midnight: the window now starts at local midnight in the configured timezone.
- Updated dependencies [62e3e8e]
- Updated dependencies [44ca0e0]
  - @entrogic-net/shared@1.4.0

## 1.3.0

### Patch Changes

- Updated dependencies [3fccbd1]
- Updated dependencies [0fbd3fe]
  - @entrogic-net/shared@1.3.0

## 1.2.0

### Minor Changes

- cfbed9e: First release on npm. Install the CLI with `npm install -g @entrogic-net/cli` or run `npx banglaclaw init`. This release also includes the admin dashboard, the Facebook Messenger channel, voice notes, DOCX and URL knowledge sources, BanglaClaw as an MCP server, live operator replies for API clients, and the OpenClaw-style web and terminal chat UIs.

### Patch Changes

- Updated dependencies [cfbed9e]
  - @entrogic-net/shared@1.2.0
