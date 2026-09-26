# 24 — Workspace

The workspace lets the agent keep files for the person it's talking to: notes, lists, drafts, small data files. It's off by default, it's sandboxed per owner, and nothing the agent does to a file is permanent ([ADR-0014](adr/0014-workspace-tools.md)).

## Turning it on

```yaml
workspace:
  enabled: true
  dir: workspace                 # relative to banglaclaw.yaml; each owner gets a subfolder
  # channels: [cli, api, telegram, whatsapp, messenger, mcp]   # default; add "widget" deliberately
tools:
  allow: [calculator, current_datetime, "workspace_*"]
```

Both steps are needed: `workspace.enabled` registers the tools, and `tools.allow` lets the model use them. `banglaclaw doctor` checks that the folder is writable and warns when no `workspace_*` tool is allowed.

## Owners and folders

Each session's owner comes from the session, never from the model, the same way long-term memory works (`sessionOwner` in `@entrogic-net/session`):

| Session | Owner | Folder |
|---|---|---|
| CLI chat or `agent run` | `cli:local` | `workspace/cli_local/` |
| Gateway API user | `user:<id>` | `workspace/user_<id>/` |
| Telegram chat, WhatsApp number, Messenger user | `telegram:<chat>` and so on | `workspace/telegram_<chat>/` |
| Widget visitor (only if `widget` is in `channels`) | `widget:<visitor>` | `workspace/widget_<visitor>/` |

An owner can never see or change another owner's files. Channels missing from `workspace.channels` get a clear error instead of file access, so the public website widget has no file access unless you add it.

## Tools

| Tool | What it does |
|---|---|
| `workspace_list` | Files and folders (recursive, at most 200 entries) |
| `workspace_read` | A text file, optionally a line window (`offset`, `limit`) |
| `workspace_create` | A new file; fails if it exists |
| `workspace_write` | Creates or replaces a file; the old version goes to history |
| `workspace_edit` | Replaces exact `old_text` with `new_text` (once, or `replace_all`); the old version goes to history |
| `workspace_delete` | Moves a file to the trash |
| `workspace_restore` | Brings back a deleted file, or the previous (or a numbered) version |

All seven are `sensitive`. Failures such as a missing file, ambiguous `old_text`, a bad path or a full quota come back to the model as error observations it can fix. They never include server paths.

## Safety

- **Paths.** Only relative paths are accepted. `..`, absolute paths, backslashes, NUL and names starting with `.` are rejected. Paths are resolved inside the owner's folder, and anything whose real path leads outside it (a symlink, for example) is refused, as is reading or writing through a symlinked file.
- **Text only.** Files are UTF-8 text, and files containing NUL bytes are refused.
- **Undo.** Every overwrite, edit and restore first copies the current content to `.history/<path>/` (the newest `historyVersions` are kept). Deletes move files to `.trash/<time>/<path>`. Neither folder is visible to or writable by the tools except through `workspace_restore`.
- **Quotas.** Per owner: `maxFileBytes` per file (256 KB), `maxFiles` live files (500), and `maxTotalBytes` including history and trash (20 MB).
- **Audit.** Every call is recorded with the run (`tool_calls`), like any tool.

## Files sent in chats

With the workspace on, files people send on Telegram, WhatsApp or Messenger are saved to their own folder under `uploads/` (`workspace.uploads`, on by default, and only for channels in `workspace.channels`):

- **Formats.** `.txt`, `.md`, `.csv` and `.json` are stored as they are. `.pdf`, `.docx` and `.html` are stored as their extracted text (`menu.pdf` becomes `uploads/menu.txt`). Other types get a notice.
- **Names.** File names are cleaned (Bangla letters are kept, and spaces become `_`). A clash gets `-2`, `-3` and so on, so nothing is overwritten.
- **Limits.** Downloads are capped by `maxUploadBytes` (10 MB), and the text must fit `maxFileBytes` and the owner's quota. Access and rate limits are checked before anything is downloaded.
- **What the agent sees.** The caption, if any (the user's request), followed by a note such as `[ব্যবহারকারী "menu.pdf" ফাইলটি পাঠিয়েছেন। এটি workspace-এ uploads/menu.txt নামে সংরক্ষিত হয়েছে …; workspace_read দিয়ে পড়ুন।]` in the user's language. The agent then reads the file with `workspace_read` (so `workspace_read` must be in `tools.allow`).

With the workspace off, a file gets a short notice asking for the text instead.

## Web chat and API

`banglaclaw serve` exposes the caller's workspace to API keys (the owner is `user:<id>`) when `api` is in `workspace.channels`: `GET /v1/workspace/files`, `GET` and `DELETE /v1/workspace/file`, `GET /v1/workspace/history`, `POST /v1/workspace/restore` and `POST /v1/workspace/uploads` (docs/18; `client.workspace.*` in `@entrogic-net/client`).

The web chat (`/chat`) has a **Files** tab over them. It lists the files, opens a viewer (markdown rendered, other files shown as text) with Download, History (restore any version) and Delete (with Undo), and refreshes after each reply. Its 📎 button and drag-and-drop upload files, and the message then tells the agent where they are, just like chat uploads.

## CLI

```bash
banglaclaw workspace list                       # cli:local's files
banglaclaw workspace list --owner telegram:555  # someone else's (operators on the server)
banglaclaw workspace show notes/todo.md
banglaclaw workspace history notes/todo.md
banglaclaw workspace restore notes/todo.md      # undo the last change or delete
banglaclaw workspace restore notes/todo.md --version 2
```

All of them support `--json`. `banglaclaw tool list` shows the workspace tools with source `workspace` when the workspace is enabled.

## Example

> **You:** আমার বাজারের তালিকায় ডাল ২ কেজি করো
>
> The agent calls `workspace_read` (`shop/list.md`), then `workspace_edit` (`old_text: "ডাল ১ কেজি"`, `new_text: "ডাল ২ কেজি"`), and replies with the updated list.
>
> **You:** ভুল হয়েছে, আগেরটা ফিরিয়ে দাও
>
> `workspace_restore` (`shop/list.md`) brings back the previous version.

## Not yet

- Keeping original binaries (only extracted text is stored) and images
- Sharing files between owners, or a gateway API to download them
- Automatic cleanup of old history and trash (they count towards the quota)
