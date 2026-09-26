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
packages/client     typed @entrogic-net/client SDK (REST + SSE)
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

`.github/workflows/ci.yml` runs lint, typecheck, tests (with PostgreSQL and Qdrant services), build, the npm pack smoke test and `pnpm audit --audit-level high` on every push and pull request. Contribution rules are in `CONTRIBUTING.md`.

## Releasing

BanglaClaw is published to npm as the `@entrogic-net/*` packages plus the unscoped `banglaclaw` wrapper (so `npx banglaclaw` works), with [Changesets](https://github.com/changesets/changesets) ([ADR-0012](adr/0012-npm-publishing.md)).

| Published | Not published |
|---|---|
| `packages/*` (17 libraries), `apps/cli` (`@entrogic-net/cli`, the `banglaclaw` bin), `apps/banglaclaw` (wrapper), `mcp-servers/bangladesh` | `apps/dashboard` (shipped in the Docker image), `examples/*` |

- **Versioning.** All published packages share one version (`fixed` in `.changeset/config.json`). A `patch` changeset for a fix bumps every package's patch version. `major` is reserved for breaking changes to the `/v1` API or public exports. `apps/cli/src/version.ts` reads the CLI's `package.json`, so `--version`, `/health` and metrics follow automatically.
- **Changesets.** A pull request that changes published behavior adds one with `pnpm changeset` (one line for users). The curated project summary stays in the root `CHANGELOG.md`, and Changesets writes a `CHANGELOG.md` per package.
- **Flow.** Changesets merged into `master` make `.github/workflows/release.yml` open a "chore: version packages" pull request (`pnpm version-packages`). Merging it runs `pnpm release`: build, `scripts/pack-smoke.sh`, then `changeset publish` with npm provenance, and git tags per package.
- **Package contents.** Each package ships `dist/` (JS, types and source maps), `src/` (so the maps resolve and the `@banglaclaw/source` export condition stays valid), a README and the license. `pnpm pack` rewrites `workspace:*` to exact versions. `scripts/pack-smoke.sh` (`pnpm verify:pack`) packs everything, rejects tests, `.env` files and leftover `workspace:` ranges, installs the tarballs with npm in an empty project, and checks the CLI, the wrapper, the MCP server bin and every library import.
- **One-time setup.** The packages are published under the existing `entrogic-net` npm organisation (the `@entrogic-net` scope, owned by the maintainer's npm account, which has 2FA enabled). Publish the unscoped `banglaclaw` name from an org owner's account, and add an automation token as the `NPM_TOKEN` repository secret. Once the packages exist, npm trusted publishing (OIDC) can replace the token.

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
