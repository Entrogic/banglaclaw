# 🐾 BanglaClaw

> A Bangla-first open-source AI agent runtime built with TypeScript, LangGraph and MCP.

BanglaClaw is designed to help developers build stateful, tool-using, multi-channel AI agents that understand Bangla, Banglish and English.

## Quickstart

Requires Node.js 22+ and pnpm.

```bash
pnpm install
cp .env.example .env              # then set OPENAI_API_KEY (or BANGLACLAW_PROVIDER=anthropic + ANTHROPIC_API_KEY)
                                  # the CLI loads ./.env automatically; exported shell variables take precedence

pnpm banglaclaw doctor            # check config and keys
pnpm banglaclaw chat              # interactive chat
pnpm banglaclaw agent run "২৫ * ৪ কত?"
pnpm banglaclaw agent run "ekhon koyta baje?"
```

Local model via Ollama (no key needed):

```bash
export BANGLACLAW_BASE_URL=http://localhost:11434/v1 BANGLACLAW_MODEL=qwen2.5
pnpm banglaclaw chat
```

Run `pnpm banglaclaw init` (or copy `banglaclaw.example.yaml`) to create `banglaclaw.yaml` and configure models, limits, tools, storage and skills.

MCP tools — copy `banglaclaw.example.yaml` to `banglaclaw.yaml` (it enables the bundled Bangladesh server), then:

```bash
pnpm banglaclaw mcp list
pnpm banglaclaw agent run "কুমিল্লা কোন বিভাগে?"
```

HTTP gateway (see [API](docs/18-api.md)):

```bash
pnpm banglaclaw serve                     # memory storage: prints a temporary API key
# with postgres storage: pnpm banglaclaw key create --user my-app
curl -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
     -d '{"text":"২৫ * ৪ কত?"}' http://127.0.0.1:3000/v1/agents/run
curl -N -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
     -d '{"text":"ekhon koyta baje?"}' "http://127.0.0.1:3000/v1/agents/run?stream=true"
```

Telegram bot (see [Channels](docs/11-channels.md)):

```bash
export TELEGRAM_BOT_TOKEN=123456:ABC...   # from @BotFather (or put it in .env)
# banglaclaw.yaml: channels.telegram.enabled: true, allowedUserIds: [<your numeric id>]
pnpm banglaclaw serve                     # long polling; also serves the web chat at /chat
```

Knowledge base and long-term memory (see [Memory & Knowledge](docs/07-memory.md)):

```bash
docker compose -f docker/compose.yaml up -d      # includes Qdrant on :56333
# banglaclaw.yaml: knowledge: {enabled: true, vectorStore: qdrant, vectorStoreUrl: http://localhost:56333}
#                  memory: {longTerm: {enabled: true}}
pnpm banglaclaw kb ingest docs/faq policies.pdf
pnpm banglaclaw agent run "ঢাকার বাইরে ডেলিভারি চার্জ কত?"
```

Persistent sessions with PostgreSQL:

```bash
docker compose -f docker/compose.yaml up -d
export BANGLACLAW_STORAGE=postgres DATABASE_URL=postgres://banglaclaw:banglaclaw@localhost:54329/banglaclaw
pnpm banglaclaw db migrate
pnpm banglaclaw chat                      # prints a session id on exit
pnpm banglaclaw chat --session <id>       # resume later
pnpm banglaclaw session list
```

## Documentation

- [Overview](docs/00-overview.md)
- [Vision](docs/01-vision.md)
- [Goals & Non-goals](docs/02-goals.md)
- [Architecture](docs/03-architecture.md)
- [Agent Runtime](docs/04-agent-runtime.md)
- [Gateway](docs/05-gateway.md)
- [Sessions](docs/06-session.md)
- [Memory](docs/07-memory.md)
- [Skills](docs/08-skills.md)
- [Tools](docs/09-tools.md)
- [MCP](docs/10-mcp.md)
- [Channels](docs/11-channels.md)
- [Model Providers](docs/12-model-providers.md)
- [Storage](docs/13-storage.md)
- [Security](docs/14-security.md)
- [Observability](docs/15-observability.md)
- [Configuration](docs/16-configuration.md)
- [CLI](docs/17-cli.md)
- [API](docs/18-api.md)
- [Development](docs/19-development.md)
- [Roadmap](docs/20-roadmap.md)
- [Architecture Decision Records](docs/adr/)

## Design principles

1. TypeScript-first
2. Model-provider independent
3. MCP-native
4. Skill and tool extensibility
5. Channel/runtime separation
6. Secure-by-default tool execution
7. Bangla/Banglish/English support
8. Observable agent runs

## Status

Pre-alpha. Implemented so far:

- **v0.1 Agent Core**: TypeScript monorepo, LangGraph runtime, OpenAI-compatible and Anthropic providers, permission-checked tool calling, streaming, Bangla/Banglish/English detection, CLI.
- **v0.2 State and Skills**: sessions, optional PostgreSQL persistence (Drizzle), short-term memory window, per-run LangGraph checkpoints, and SKILL.md skills.
- **v0.3 MCP**: MCP client (stdio and Streamable HTTP), tool discovery into the permission-checked tool registry, and a bundled Bangladesh reference-data MCP server.
- **v0.4 Gateway**: HTTP API (Hono) with REST, SSE and WebSocket streaming, API-key authentication with per-user isolation, and per-key rate limits.
- **v0.5 Channels**: Telegram (polling or webhook), WhatsApp Cloud API, a browser chat page, and allowlist access with per-chat rate limits.
- **v0.6 Knowledge**: RAG over your documents (txt/md/html/pdf, Bangla-aware chunking, Qdrant or in-memory vectors) and owner-scoped long-term memory.

Next up is Multi-agent (v0.7) — see the [roadmap](docs/20-roadmap.md).
