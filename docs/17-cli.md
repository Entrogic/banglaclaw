# 17 — CLI

The CLI is the primary developer interface during early development.

## Commands

```bash
banglaclaw chat                      # interactive REPL (/reset, /exit; Ctrl+C cancels a running reply)
banglaclaw agent run "<message>"     # one-shot, streamed reply; exit code 2 if a run limit was hit
banglaclaw tool list                 # registered tools, risk level, allowed/denied
banglaclaw doctor                    # Node version, config, API key presence, tools, limits
```

Global option: `-c, --config <path>`. From the repo, run via `pnpm banglaclaw <command>`.

Planned: `banglaclaw init`, `agent list`, `skill list` (v0.2), `mcp list` (v0.3).

## Goals

- Fast local development
- Agent debugging
- Tool/skill discovery
- Configuration diagnostics
- Local runtime management
