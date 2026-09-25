# 19 — Development

## Initial stack

- TypeScript
- Node.js
- pnpm
- Turborepo
- LangGraph
- Zod
- PostgreSQL
- MCP

## Proposed repository structure

```text
banglaclaw/
├── apps/
│   ├── gateway/
│   ├── cli/
│   └── web/
├── packages/
│   ├── agent/
│   ├── gateway/
│   ├── session/
│   ├── memory/
│   ├── skills/
│   ├── tools/
│   ├── mcp/
│   ├── providers/
│   ├── storage/
│   └── shared/
├── skills/
├── mcp-servers/
├── docs/
├── docker/
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## Implemented so far (v1.0)

```text
apps/cli            banglaclaw CLI (commander)
packages/shared     types, errors, JSON logger, config loader
packages/providers  ModelProvider + OpenAI-compatible / Anthropic adapters, FakeProvider
packages/tools      tool contract, registry, permission policy, executeTool, built-ins
packages/session    Session/Run models, SessionStore/RunStore, in-memory stores, SessionManager, trimHistory
packages/skills     SKILL.md parsing, discovery, trigger-based selection
packages/storage    Drizzle schema + migrations, Postgres stores, PostgresSaver checkpoints
packages/mcp        MCP client manager, MCP tool wrapping (stdio + Streamable HTTP)
packages/auth       users, API key generation/verification, AuthStore + in-memory store
packages/gateway    Hono HTTP gateway: REST, SSE, WebSocket, rate limits, request ids, /chat page
packages/channels   ChannelRouter + Telegram (polling/webhook), WhatsApp Cloud API and Facebook Messenger adapters
packages/knowledge  embeddings, vector stores (memory/Qdrant), chunking, loaders, KnowledgeBase, LongTermMemory
packages/agents     AGENT.md specialist profiles (parse/load)
packages/observability  OpenTelemetry setup (initTelemetry) and Prometheus Metrics
packages/client     typed @banglaclaw/client SDK (REST + SSE)
packages/plugin-sdk definePlugin/defineTool/z for plugin authors
examples/plugins    example bd-phone plugin
examples/agents     sample sales and support specialists
packages/agent      language detection, prompts, LangGraph graph, AgentRuntime
mcp-servers/        bundled MCP servers (bangladesh)
skills/             bundled skills (calculation, time-and-date)
docker/             compose file for local PostgreSQL
```

Postgres integration tests (`packages/storage/test`) run only when `TEST_DATABASE_URL` is set:

```bash
docker compose -f docker/compose.yaml up -d
TEST_DATABASE_URL=postgres://banglaclaw:banglaclaw@localhost:54329/banglaclaw_test \
TEST_QDRANT_URL=http://localhost:56333 pnpm test
```

Workspace packages export `src/index.ts` under the `@banglaclaw/source` condition, so tsx, Vitest and `tsc --noEmit` use sources directly; `pnpm build` emits `dist/` in dependency order via Turborepo. TypeScript is pinned to 6.x until typescript-eslint supports 7.x.

## CI and releases

`.github/workflows/ci.yml` runs lint, typecheck, tests (with PostgreSQL and Qdrant services), build and `pnpm audit --audit-level high` on every push and pull request. Release notes go in `CHANGELOG.md`; contribution rules are in `CONTRIBUTING.md`.

## Development principle

Documentation → Architecture → Interfaces → Tests → Implementation

## Contribution areas

- New tools
- New skills
- MCP servers
- Channels
- Model adapters
- Documentation
- Tests
- Observability integrations
