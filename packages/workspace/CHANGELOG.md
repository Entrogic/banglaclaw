# @entrogic-net/workspace

## 1.4.0

### Minor Changes

- 44ca0e0: Workspace: sandboxed per-owner text files the agent can list, read, create, write, edit, delete and restore (`workspace_*` tools, off by default; enable `workspace.enabled` and allow `workspace_*`). Every overwrite, edit and delete can be undone from history or trash, and `banglaclaw workspace list | show | history | restore` manages the files. `sessionOwner` now lives in `@entrogic-net/session`.

### Patch Changes

- Updated dependencies [44ca0e0]
- Updated dependencies [62e3e8e]
- Updated dependencies [44ca0e0]
  - @entrogic-net/session@1.4.0
  - @entrogic-net/shared@1.4.0
  - @entrogic-net/tools@1.4.0
