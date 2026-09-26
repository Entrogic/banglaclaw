# ADR-0014: Sandboxed, Undoable Workspace Tools

## Status

Accepted

## Context

Users want the agent to keep files: notes, lists and drafts it can create and later change. BanglaClaw has had no filesystem access on purpose (docs/14). `AllowlistPolicy` always denies `destructive` tools because there is no human-confirmation flow, and a tool that overwrites or deletes files would normally be destructive. The gateway serves many people (API users, Telegram chats, widget visitors), so files must not leak between them, and the model must never choose whose files it touches.

## Decision

- **A separate `@entrogic-net/workspace` package** produces `workspace_*` tools. The CLI registers them only when `workspace.enabled` is true, and the model can call them only if they are in `tools.allow`. Both are off by default.
- **Per-owner folders, owner from the session.** The owner id comes from `sessionOwner(session)`, which moved to `@entrogic-net/session` so memory and workspace share it. Channels not listed in `workspace.channels` are refused; the widget is left out by default.
- **A strict path sandbox.** Relative paths only. No `..`, absolute paths, backslashes or dot-names. Real-path checks refuse symlink escapes and writing through links. Files are text only, and errors never reveal server paths.
- **Nothing irreversible.** Overwrites, edits and restores keep the previous content in `.history/`. Deletes move files to `.trash/`, and `workspace_restore` (and `banglaclaw workspace restore`) undoes either. Because no tool can destroy data, the tools are classified `sensitive`, not `destructive`, and the policy rule that destructive tools are always denied stays unchanged.
- **Quotas per owner** on file size, file count and total bytes, with history and trash included so undo can't be abused to fill the disk.

## Consequences

Positive:
- The agent can work with files for each user safely, including in multi-user deployments
- Mistakes are always recoverable by the user (through the agent) or an operator (through the CLI)
- There is no confirmation-flow prerequisite, and the existing permission model is reused

Trade-offs:
- History and trash consume quota until they are pruned (the newest `historyVersions` versions are kept per file, and trash has no automatic expiry yet)
- Text files only; binary files and channel uploads need further work
- The workspace lives on the gateway host's disk, so several gateway instances would need shared storage
