---
"@entrogic-net/workspace": minor
"@entrogic-net/session": minor
"@entrogic-net/knowledge": patch
"@entrogic-net/shared": minor
"@entrogic-net/cli": minor
---

Workspace: sandboxed per-owner text files the agent can list, read, create, write, edit, delete and restore (`workspace_*` tools, off by default; enable `workspace.enabled` and allow `workspace_*`). Every overwrite, edit and delete can be undone from history or trash, and `banglaclaw workspace list | show | history | restore` manages the files. `sessionOwner` now lives in `@entrogic-net/session`.
