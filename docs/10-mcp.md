# 10 — MCP

MCP is a first-class integration layer (ADR-0003). v0.3 implements the **client** side: BanglaClaw connects to MCP servers, discovers their tools and lets the agent call them through the same permission-checked lifecycle as built-in tools.

## Client architecture

```text
AgentRuntime ── ToolRegistry ──┬── built-in tools
                               └── MCP tools  (<server>__<tool>)
                                        │
                                   McpManager  (packages/mcp)
                                        │
                     ┌──────────────────┼──────────────────┐
                 stdio process      stdio process      Streamable HTTP
               (bangladesh MCP)      (other MCP)        (remote MCP)
```

- `McpManager.connectAll()` connects every enabled server in parallel, with `connectTimeoutMs`, and pages through `tools/list`.
- Each discovered tool is wrapped as a `BanglaClawTool` named `<server>__<tool>` (snake_case, at most 64 characters, hashed when too long), so it can't collide with built-in tools or with other servers.
- The server's JSON Schema is advertised to the model as-is (`parameters`). Input is validated locally with `z.fromJSONSchema` before the call.
- Results are flattened to `{ content?, structured?, truncated }`. Text that only repeats the structured content is dropped, and output is capped at 20,000 characters. `isError` results become tool errors.
- A server that fails to connect is reported (`mcp list`, `doctor`, a warning in `chat` / `agent run`) and does not stop the agent. Connections are closed on shutdown.

## Trust boundary (docs/14)

MCP servers are treated as **untrusted**:

- **Deny by default.** MCP tools run only when allowed in `tools.allow`, by exact name or with a server wildcard such as `bangladesh__*`.
- **Risk.** Every MCP tool is at least `sensitive`. A `destructiveHint` makes it `destructive`, which is always denied. Annotations can raise risk but never lower it.
- **Timeouts.** Each call is bounded by the server's `timeoutMs`, and the whole run by `runtime.timeoutMs`.
- **Environment.** A stdio server gets only safe defaults (PATH, HOME, …) plus its configured `env`, never the parent's full environment with its API keys. Secrets are referenced as `${VAR}` and expanded from the environment at connect time.
- **Context.** Tool descriptions are prefixed `[MCP <server>]` and truncated. The system prompt tells the model that tool results are data, not instructions. This is mitigation only; the application-side policy remains the security boundary.
- **Audit.** Every call is recorded in the run's audit trail (`tool_calls` table with postgres storage).

## Configuration

```yaml
tools:
  allow: [calculator, current_datetime, "bangladesh__*"]

mcp:
  servers:
    bangladesh:
      transport: stdio
      command: node
      args: [--import, tsx, mcp-servers/bangladesh/src/bin.ts]   # relative to the config file
      env: {}
      timeoutMs: 30000
      connectTimeoutMs: 15000
    remote:
      transport: http
      url: https://mcp.example.com/mcp
      headers: { Authorization: "Bearer ${REMOTE_MCP_TOKEN}" }
      enabled: true
```

## Bundled example server

`mcp-servers/bangladesh` (`@entrogic-net/mcp-server-bangladesh`) is a read-only reference-data server:

| Tool | Purpose |
|---|---|
| `list_divisions` | 8 divisions with Bangla names and district counts |
| `list_districts` | all 64 districts, or those of one division (English or Bangla name) |
| `find_district` | district lookup by English/Bangla name, prefix or old spelling (Comilla → Cumilla) |
| `format_taka` | lakh/crore grouping (৳১,২৩,৪৫,৬৭৮.৫০) and a কোটি/লক্ষ/হাজার breakdown |
| `convert_digits` | Bangla ↔ English digits |

## BanglaClaw as an MCP server

`banglaclaw mcp serve` runs BanglaClaw itself as an MCP server on stdio, so other agents and IDEs can use it as a Bangla-first assistant. The server lives in `apps/cli/src/mcp-server.ts`.

| Tool | Purpose |
|---|---|
| `ask` | `{ message, conversation?, new_conversation? }` → the agent's reply (text) plus `{ reply, conversation, sessionId, status, language, skills, tools }`. Each `conversation` name (default `default`) is a session on channel `mcp` with its own history; `new_conversation: true` starts it over. Failed runs return `isError`. |
| `search_knowledge` | `{ query, limit? }` → matching passages from the knowledge base. Read-only; only listed when `knowledge.enabled` is true. |

- **Same agent, same rules.** Runs go through the normal runtime: skills, `tools.allow`, limits, timeouts, audit and storage all apply, and handoff works (the reply says a human operator has taken over). Cancelling the MCP request cancels the run.
- **Trust.** The server runs with the configuration and keys of the user who starts it, like the CLI, and has no API-key layer of its own. Only register it with clients you trust to use your model quota and data.
- **stdout is the protocol.** Logs, knowledge ingestion notes and MCP warnings go to stderr.

Claude Code:

```bash
claude mcp add banglaclaw -- banglaclaw -c /path/to/banglaclaw.yaml mcp serve
```

Claude Desktop (`claude_desktop_config.json`), from a source checkout:

```json
{
  "mcpServers": {
    "banglaclaw": {
      "command": "pnpm",
      "args": ["--dir", "/path/to/bangla-claw", "banglaclaw", "mcp", "serve"],
      "env": { "OPENAI_API_KEY": "sk-…" }
    }
  }
}
```

The CLI loads `./.env` from its working directory, so with `pnpm --dir` the checkout's `.env` is used and `env` can be left out.

## Planned

- Reconnect on dropped connections and handle `tools/list_changed` notifications
- MCP resources and prompts
- Per-server tool filtering and OAuth for remote servers
