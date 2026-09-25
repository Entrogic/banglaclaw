# 17 — CLI

`banglaclaw` is the main tool for chatting with, running and operating BanglaClaw. From the repository, run it with `pnpm banglaclaw <command>`; with the Docker image, use `docker compose run --rm banglaclaw <command>`.

## Getting started

```bash
banglaclaw init      # interactive setup: provider, key test, storage, features → banglaclaw.yaml + .env
banglaclaw chat      # full-screen chat
banglaclaw serve     # API, web chat, metrics and channels
```

## Commands

| Group | Command | Purpose |
|---|---|---|
| **Chat** | `chat [--session <id>] [--plain]` | Interactive chat (full-screen in a terminal, line mode when piped) |
| | `agent run [--session <id>] <message…>` | One message with a streamed reply; `--json` returns the reply and run |
| | `agent list` | Supervisor and AGENT.md specialists |
| **Data** | `session list \| show <id>` | Conversations with their messages and runs |
| | `run list --session <id> \| show <id>` | Runs: tool calls, agent path, tokens, checkpoint |
| | `kb ingest <paths…> \| list \| search <q> \| delete <source>` | Knowledge base (docs/07) |
| | `memory list \| forget <id> [--owner …]` | Long-term memories |
| **Server** | `serve [--port] [--host]` | Gateway, web chat, metrics and enabled channels |
| | `key create \| list \| revoke` | API keys: `--role user\|operator\|admin`, `--scopes read,run` |
| | `handoff list \| show \| reply \| release` | Human handoff queue (docs/04) |
| | `audit [--action …]` | Security audit log |
| | `mcp serve` | BanglaClaw as an MCP server on stdio for other agents (docs/10) |
| **Setup** | `init [--yes] [--force]` | Setup wizard; `--yes` writes the commented template |
| | `doctor` | Checks config, keys, storage, MCP, channels, knowledge and plugins |
| | `db migrate \| status` | PostgreSQL schema |
| | `tool list`, `skill list`, `mcp list` | What the agent can use |
| | `version` | Version, Node.js, config, model and storage |
| | `completion bash\|zsh\|fish` | Shell completion script |

Every command has `--help` with examples (for example `banglaclaw key create --help`).

## Global options

| Option | Effect |
|---|---|
| `-c, --config <path>` | Config file (default `./banglaclaw.yaml`, or `BANGLACLAW_CONFIG`) |
| `--json` | Machine-readable output for list/show/status commands, `doctor`, `version` and `agent run`. Errors become `{"error":{code,message,hint}}` |
| `-q, --quiet` | Only essential output |
| `--no-color` | Plain text; `NO_COLOR` and a non-TTY stdout also disable colors, and `FORCE_COLOR=1` forces them on |

Global options work before or after the subcommand (`banglaclaw tool list --json`). Tables adapt to the terminal width and align Bangla text correctly. Status messages go to stderr, so piped stdout stays clean.

## Chat (full-screen)

When stdin and stdout are a terminal, `banglaclaw chat` opens an Ink-based UI:

- **A banner** with the model, storage, session id, and any agents, MCP servers, plugins, knowledge or memory in use.
- **The transcript** goes to your terminal's normal scrollback. Replies render as markdown (bold, lists, code, tables). Tool calls show as compact `⚙ calculator(25*4) → 100 · 2ms` lines, agent transfers as `↪ sales`, and handoffs as a banner.
- **A status bar** shows a spinner with what the agent is doing ("thinking…", "running calculator…", "writing…") and the elapsed time. After each run it summarizes the status, the agent path, duration, tool count and tokens in/out, and it always shows the active agent and session.

| Key | Action |
|---|---|
| Enter | Send |
| Alt+Enter / Ctrl+J | New line |
| ↑ / ↓ | Input history (saved in `~/.config/banglaclaw/history`; `BANGLACLAW_HISTORY_FILE=` disables it) |
| ← → Home End, Ctrl+A/E/U | Edit the line |
| `/` then Tab or ↑↓ | Slash-command menu |
| Esc | Cancel a running reply, or clear the input |
| Ctrl+C | Cancel a reply, or clear the input; press twice to quit |
| Ctrl+D | Quit (on empty input) |

Slash commands: `/help`, `/new`, `/history`, `/session`, `/agents`, `/tools`, `/skills`, `/clear`, `/exit`.

With pipes, SSH without a TTY, or `--plain`, the chat falls back to line mode with the same slash commands:

```bash
printf 'hi\n/session\n/exit\n' | banglaclaw chat
```

## Setup wizard

`banglaclaw init` asks for:

1. the provider (OpenAI, Anthropic, or a local/OpenAI-compatible server) and the model;
2. the API key (hidden input), with an optional one-request connection test;
3. storage (memory, or PostgreSQL with a connection check and migrations);
4. optional extras: knowledge base, long-term memory, Telegram, example agents, human handoff.

It then writes `banglaclaw.yaml` (no secrets) and `.env` (mode 0600, adding keys without overwriting existing values), adds both to `.gitignore`, runs the doctor checks and prints next steps. Ctrl+C cancels without writing anything. In a non-interactive shell, or with `--yes`, it writes the fully commented template instead.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Error (including failed doctor checks and failed MCP servers) |
| 2 | A run stopped at an iteration or tool-call limit |
| 3 | Configuration error (missing key, invalid YAML, missing config file) |
| 4 | Missing prerequisite (postgres storage, Qdrant, feature disabled) |
| 130 | Cancelled |

Errors print `✖ message` plus a `hint:` line with the fix, for example "Run `banglaclaw init`" or "Run `banglaclaw db migrate`".

## Shell completion

```bash
eval "$(banglaclaw completion bash)"                                   # ~/.bashrc
banglaclaw completion zsh > "${fpath[1]}/_banglaclaw"                   # zsh
banglaclaw completion fish > ~/.config/fish/completions/banglaclaw.fish
```

The scripts are generated from the command tree, so they always match the installed version.
