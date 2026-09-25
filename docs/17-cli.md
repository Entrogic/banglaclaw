# 17 — CLI

The CLI is the primary developer interface during early development.

## Commands

```bash
banglaclaw chat [--session <id>]               # interactive REPL (/new, /session, /exit; Ctrl+C cancels a reply)
banglaclaw agent run [--session <id>] "<msg>"  # one-shot streamed reply; exit code 2 if a run limit was hit
banglaclaw session list | show <id>            # sessions, their messages and recent runs
banglaclaw run list --session <id> | show <id> # runs with tool calls and checkpoint id
banglaclaw skill list                          # discovered skills, their tools and triggers
banglaclaw tool list                           # built-in + MCP tools, risk level, allowed/denied
banglaclaw mcp list                            # connect to MCP servers; status and discovered tools
banglaclaw db migrate | status                 # PostgreSQL schema + checkpoint tables (DATABASE_URL)
banglaclaw init [--force]                      # write banglaclaw.yaml
banglaclaw doctor                              # Node, config, keys, tools, skills, storage
```

Global option: `-c, --config <path>`. From the repo, run via `pnpm banglaclaw <command>`. With `storage.provider: memory`, sessions exist only for the lifetime of one command, so `--session` and `session`/`run` inspection are useful with `postgres`.

Planned: `agent list` (v0.7).

## Goals

- Fast local development
- Agent debugging
- Tool/skill discovery
- Configuration diagnostics
- Local runtime management
