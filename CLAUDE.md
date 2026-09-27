# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

BanglaClaw is a Bangla-first, open-source AI agent runtime (TypeScript + LangGraph + MCP) that understands Bangla, Banglish and English. All roadmap milestones (v0.1–v1.0) are implemented; see docs/20-roadmap.md ("After 1.0" lists ideas). Versioning is done by Changesets: every published package shares one version (the `fixed` group in `.changeset/config.json`; check `apps/cli/package.json` for the current one). `apps/cli/src/version.ts` reads that file, and the private root `package.json` version is not bumped. Changesets writes per-package CHANGELOGs, while the root CHANGELOG.md is a hand-curated summary: add new user-visible changes under its `## Unreleased`. The `/v1` HTTP API is stable and changes must be additive (docs/18). Architecture is specified in `docs/` first (`docs/bn/` has Bangla versions of 05, 08, 10 and 11; keep them in sync when those change): when behavior or design changes, update the relevant `docs/` file (and add an ADR in `docs/adr/` for significant decisions) in the same change.

## Commands

pnpm workspaces + Turborepo. Never use npm or yarn. Node 22+.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # pre-PR gate
pnpm banglaclaw init           # setup wizard; `pnpm banglaclaw --help` for grouped commands
pnpm banglaclaw <cmd>          # CLI from source: chat | agent run/list | session | run | kb | memory | serve | key | handoff | audit | init | doctor | db migrate/status | tool/skill list | mcp list/serve | version
pnpm audit:deps                # dependency audit (high severity)
pnpm dev                       # full-screen chat from source (no watch mode: tsx watch restarts on Enter)
pnpm --filter @entrogic-net/agent test language              # one test file (name filter)
pnpm --filter @entrogic-net/agent exec vitest run -t "maxIterations"   # one test by name
pnpm --filter @entrogic-net/<pkg> add <dep>
pnpm --filter @entrogic-net/storage db:generate   # after editing packages/storage/src/schema.ts; commit drizzle/
pnpm changeset                 # for any change to a published package (all share one version)
pnpm verify:pack                # after build: pack + npm-install every package, check bins and imports
pnpm e2e                       # Playwright (web chat, widget, dashboard) against e2e/src/server.ts; PW_CHANNEL=chrome to use local Chrome

# Postgres (integration tests are skipped unless TEST_DATABASE_URL is set; they TRUNCATE tables)
docker compose -f docker/compose.yaml up -d      # Postgres localhost:54329 (banglaclaw + banglaclaw_test), Qdrant localhost:56333
TEST_DATABASE_URL=postgres://banglaclaw:banglaclaw@localhost:54329/banglaclaw_test TEST_QDRANT_URL=http://localhost:56333 pnpm test
BANGLACLAW_STORAGE=postgres DATABASE_URL=postgres://banglaclaw:banglaclaw@localhost:54329/banglaclaw pnpm banglaclaw db migrate
```

The CLI loads `./.env` at startup (`apps/cli/src/env.ts`; shell variables win). Live model runs need `OPENAI_API_KEY` or `BANGLACLAW_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`, or `BANGLACLAW_BASE_URL` pointing at a keyless OpenAI-compatible server (Ollama/vLLM). Tests never hit the network.

## Monorepo mechanics

- Packages: `packages/{shared,providers,tools,session,skills,storage,mcp,auth,agents,agent,gateway,channels,knowledge,workspace,observability,client,plugin-sdk}`, `apps/cli`, `apps/banglaclaw` (unscoped `banglaclaw` npm wrapper for `npx banglaclaw`), `apps/dashboard`, `mcp-servers/bangladesh`, `examples/plugins/bd-phone`, `e2e` (Playwright), all named `@entrogic-net/*` except the wrapper. Everything except the dashboard, examples and e2e is published to npm in lockstep via Changesets (ADR-0012, docs/19 "Releasing"); packages ship `dist/` + `src/`. Dependency direction: `shared` ← `providers`, `tools`, `session`, `skills`, `auth`, `agents` ← `agent` ← `gateway`, `channels` ← `cli` (channels don't depend on gateway; the CLI mounts their webhook apps via `GatewayDeps.routes`). `storage` (implements the `session` and `auth` interfaces), `mcp`, `knowledge` and `workspace` (all produce `tools`; knowledge also supplies a `ContextProvider`) are wired in only by `cli` (and `knowledge` types by `gateway`); `agent` and `gateway` depend on neither. Only `storage` imports Drizzle/pg; `agent` must not depend on `storage`. Shared types (`ToolSpec`, `StopReason`, `RunEvent`) live in `shared`.
- Each package's `exports` maps the custom condition `@banglaclaw/source` → `src/index.ts`. `tsconfig.base.json` (`customConditions`), tsx (`--conditions`) and each `vitest.config.ts` use it, so typecheck/test/dev need no build. `tsconfig.build.json` clears the condition so `tsc` builds against dependencies' `dist/`.
- ESM with `NodeNext`: relative imports need `.js` extensions. Strict + `noUncheckedIndexedAccess`; ESLint forbids `any` and non-null assertions.
- TypeScript is pinned to 6.x because typescript-eslint does not support TS 7 yet.
- `pnpm-workspace.yaml` `allowBuilds` whitelists packages allowed to run install scripts (pnpm 12 fails installs otherwise).

## Architecture

Target flow: `Channels → Gateway → Session Manager → Agent Runtime (LangGraph) → Skills / Tools / MCP → Model Provider`. Core invariant (ADR-0005): **gateway, channels, agent runtime and tools stay independently replaceable**; the runtime never knows channel APIs or provider specifics.

What exists:

- **Agent** (`packages/agent`): `AgentRuntime.run(text, {sessionId, onEvent, signal})` requires an existing session. For each run it:
  - loads the short-term window (`recentMessages` + `trimHistory`, `memory.maxHistoryMessages`) and selects skills;
  - builds a per-run graph (`graph.ts`: `prepare → model ⇄ tools`, exiting via `finalize` or `limit`);
  - streams `RunEvent`s and enforces `timeoutMs` via `AbortSignal`;
  - saves a `RunRecord` for every run, including failures, after which it throws `AgentRunError`;
  - appends new messages only for finished runs. The `limit` node closes dangling tool calls so stored history stays valid for providers.

  An optional `checkpointer` stores graph state per run under `thread_id = runId`. Session history belongs to `SessionStore`, not to checkpoints.
- **v1.0 production pieces:**
  - **Audit.** `AuditStore` (in `shared`, Postgres `audit_logs`); `auditRecorder()` never throws. Events come from the gateway (auth failures, throttled per IP; forbidden; rate limited; memory deletion), the runtime (`tool.denied`, `handoff.requested`), `HandoffDesk` and CLI key commands.
  - **Keys and roles.** Key `scopes` (`read` = GET, `run` = everything else, enforced in the `/v1` middleware and for WS runs). Roles `user`/`operator`/`admin` via `hasRole`.
  - **Observability** (`packages/observability`, docs/15, ADR-0010). `initTelemetry()` (OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; the CLI calls it for every command) and `Metrics` (`@prometheus-io/client`, the successor of prom-client; fed by `AgentRuntimeOptions.onRunComplete` and the gateway `metrics` dep). The agent and gateway use only `@opentelemetry/api`. Token usage is summed from `usage_metadata` into `RunRecord.usage`.
  - **OpenAPI.** `packages/gateway/src/openapi.ts` must document every route; a contract test compares it with `app.routes`. `@entrogic-net/client` is the typed SDK (its tests run against `createGatewayApp` through `app.request`).
  - **Plugins** (docs/23). `@entrogic-net/plugin-sdk` (`definePlugin`, `defineTool`, `z`); `apps/cli/src/plugins.ts` loads `plugins:` (paths relative to the config, or package names). Plugins are trusted in-process code.
  - **Docker.** `Dockerfile` (pnpm deploy, non-root, healthcheck on `$BANGLACLAW_GATEWAY_PORT`), `docker/compose.prod.yaml`, `docker/banglaclaw.docker.yaml`. CI is `.github/workflows/ci.yml`. The CLI version is read from `apps/cli/package.json` (`src/version.ts`).
- **Admin API** (`packages/gateway/src/admin.ts`, docs/18): `/v1/admin/{stats,sessions,keys}` (admin role) plus `dashboardRoutes` serving `gateway.dashboardDir` at `/admin` with a strict CSP. Stats come from `RunStore.stats()`, which aggregates in SQL in Postgres and uses `computeStats` in `session/src/stats.ts` in memory. Both exclude `agent: "human"` runs and control tools. `InMemoryRunStore` takes the `InMemorySessionStore` for channel breakdowns. Costs come from `pricing` (USD per 1M tokens, keyed by provider id).
- **Dashboard** (`apps/dashboard`, ADR-0011): Vite + React SPA built with `base: "/admin/"`; it depends only on `@entrogic-net/client` (the gateway packages are devDependencies for tests). It uses Bundler module resolution (extensionless imports, DOM lib) and is excluded from the root `tsconfig.json`. Styling is one `src/styles.css` of `light-dark()` colour tokens (the same palette as `web-chat.ts` and the TUI's `palette` in `ui/theme.ts`); `src/theme.tsx` is the light/dark/system toggle, and fonts are bundled via `@fontsource` (CSP allows only `'self'`). Charts are hand-written SVG in `src/charts/`; pages live in `src/pages/` and are routed in `App.tsx` (`/`, `/sessions[/:id]`, `/handoffs[/:id]`, `/agent`, `/knowledge`, `/keys`, `/audit`). Its tests (jsdom) render `App` against a real `createGatewayApp` through an injected `fetch`. `pnpm --filter @entrogic-net/dashboard demo` + `dev` for UI work without a model key.
- **Multi-agent + handoff** (docs/04, ADR-0009):
  - `packages/agents` parses `AGENT.md` files.
  - `buildAgentGraph({team})` builds a per-agent view: the prompt uses `teamRole()`, tools are the profile subset (the supervisor gets unclaimed tools plus `transfer_to_*`), and a scoped policy enforces each agent's tools.
  - Control tools (`transfer_to_<agent>`, `request_human`) are handled in the graph's `tools` node, never in the registry. State fields: `activeAgent`, `agentPath`, `transfers`, `handoffReason`.
  - The runtime persists `session.activeAgent` and `status: handoff`, stores messages without model calls while handed off (it saves the run before appending messages because of the FK), and calls `onHandoff`.
  - `HandoffDesk` (session package) implements queue, reply and release. It is used by `/v1/handoffs` (operator role) and `banglaclaw handoff`. Operator replies are `AIMessage`s with `response_metadata.operator`; delivery comes from `createDeliver` in `apps/cli/src/channels.ts`.
- **Sessions** (`packages/session`): `SessionStore` / `RunStore` interfaces with in-memory implementations, and `SessionManager.resolve()` (explicit id → `(channel, externalId)` → new).
- **Storage** (`packages/storage`, ADR-0006): Drizzle schema (`sessions`, `messages` with LangChain messages serialised as jsonb, `runs`, `tool_calls`) plus `PostgresSaver` checkpoints on one `pg.Pool`. The migrations folder resolves as `../drizzle` from both `src/` and `dist/`. With postgres storage the CLI refuses to start while migrations are pending (`openServices` in `apps/cli/src/bootstrap.ts`).
- **Skills** (`packages/skills`, `skills/*/SKILL.md`): YAML frontmatter (`name`, `description`, `version`, `tools`, `triggers`) plus markdown instructions. `SkillSet.select()` matches triggers deterministically (Bengali triggers as substrings, Latin as whole words), and the top `skills.maxActive` skills are injected into the system prompt. A skill's `tools` never grants permission.
- **Language** (`language.ts`): deterministic `bn` / `bn-en` / `en` from Bengali-script word ratio plus a Banglish lexicon; the system prompt (`prompts.ts`, versioned by `SYSTEM_PROMPT_VERSION`) tells the model to reply in the same language/script.
- **Workspace** (`packages/workspace`, docs/24, ADR-0014): `Workspace` keeps per-owner text files under `workspace.dir/<owner folder>/` (owner from `sessionOwner(session)` in `packages/session`, never from the model). `normalizePath` + realpath checks sandbox paths. Overwrites, edits and restores back up to `.history/`, and deletes go to `.trash/`, so the seven `workspace_*` tools are `sensitive`, not destructive. Quotas include history and trash, and `workspace.channels` limits channels (no widget by default). The CLI wires it in `apps/cli/src/workspace.ts`, with commands in `commands/workspace.ts`.
- **Tools** (`packages/tools`): `BanglaClawTool` with Zod v4 `inputSchema`/`outputSchema` and `risk`. `executeTool` runs lookup → input validation → `PermissionPolicy` → execute with timeout → output validation → audit, and returns failures as error observations instead of throwing. `AllowlistPolicy` is deny-by-default and always denies `destructive`. The graph binds only allowed tools and the executor re-checks anyway.
- **Providers** (`packages/providers`): `ModelProvider { id; chat; stream }` taking `{tools?: ToolSpec[], signal?}`; `LangChainProvider` wraps `ChatOpenAI` (openai-compatible, optional `baseUrl`) or `ChatAnthropic`. Use `FakeProvider` (scripted turns, records calls) for agent tests.
- **MCP** (`packages/mcp`, docs/10): `McpManager` connects the servers in `mcp.servers` (stdio or Streamable HTTP) in parallel and wraps each discovered tool as a `BanglaClawTool` named `<server>__<tool>`. It keeps the server's JSON Schema as `parameters` and validates input with `z.fromJSONSchema`. Tools run through the normal `executeTool`/allowlist path (use `bangladesh__*` wildcards). They default to `sensitive`, and `destructiveHint` makes them `destructive` (always denied). A failed server is reported via `status()` and never thrown. Stdio servers get `getDefaultEnvironment()` plus their configured `env`, with `${VAR}` expanded at connect time. Tests use `InMemoryTransport` via `transportFactory`; the stdio test spawns `mcp-servers/bangladesh/src/bin.ts` with `--import tsx`.
- **Gateway** (`packages/gateway`, ADR-0007, docs/05 + docs/18):
  - `createGatewayApp(deps, upgradeWebSocket?)` is a Hono app; `startGateway()` serves it on Node with `@hono/node-ws`.
  - `/v1` middleware runs bearer API-key auth (`ApiKeyAuthenticator`) and a per-key `RateLimiter`. `GatewayContext` owns session ownership checks (other users' resources → 404), `externalId` namespacing (`<userId>/<externalId>`) and the per-key `ConcurrencyLimiter`.
  - The run endpoints return JSON or SSE (`respondWithRun`). The WebSocket protocol lives in `ws.ts`: auth happens in-protocol, with `ref`-keyed runs and cancel.
  - Session events (`session-events.ts`, `events.ts`): `GatewayContext.events` is an in-process bus. The gateway wraps `deps.deliver` so operator replies are published to followers (WS `subscribe`, SSE `/v1/sessions/:id/events`) as well as sent to the platform; releases publish `handoff_released`.
  - All errors map through `toHttpError`.
  - Tests use `app.request()`, plus a real server on port 0 for WebSocket; `GatedProvider` in `test/helpers.ts` blocks a run for concurrency and cancel tests.
  - A2A server (`src/a2a/`, docs/25, ADR-0015; `a2a.server.enabled`, `GatewayDeps.a2a`):
    - It uses `@a2a-js/sdk`'s framework-free `JsonRpcTransportHandler` / `LegacyJsonRpcTransportHandler` (v0.3 when there is no `A2A-Version` header) on Hono. Never import the SDK's express entry points.
    - `/a2a` shares the `/v1` `apiKeyAuth` middleware. `BanglaClawExecutor` maps `contextId` → an `a2a` session (`<userId>/<contextId>`) and emits task → working → one `response` artifact → final state. Tasks live in the SDK's user-scoped `InMemoryTaskStore`.
    - The card is authored as v1 wire JSON (`card.ts`, `AgentCard.fromJSON`) plus a hand-written v0.3 card. Neither route is in OpenAPI (like the widget).
- **Knowledge** (`packages/knowledge`, docs/07, ADR-0008):
  - `Embedder` (`OpenAICompatibleEmbedder`; `HashEmbedder` for offline tests) and `VectorStore` (`InMemoryVectorStore`, `QdrantVectorStore` over REST).
  - `KnowledgeBase`: `chunkText` (Bangla `।` aware), loaders (txt/md/html/pdf via `unpdf`, docx via `docx.ts`'s own zip reader, http(s) URLs via `loadUrl` with an injectable `fetch`), sources named relative to the config dir, SHA-256 skip for unchanged content, deterministic point ids (`stableUuid`), and the `search_knowledge` tool.
  - `LongTermMemory`: `remember`/`recall`/`forget` tools whose owner comes from `memoryOwner(session)`, never from the model. It plugs into the runtime through `AgentRuntimeOptions.contextProviders` (`memoryContextProvider`).
  - CLI wiring is in `apps/cli/src/knowledge.ts`. Qdrant tests are skipped unless `TEST_QDRANT_URL` is set; `test/pdf.ts` builds a PDF fixture.
- **Channels** (`packages/channels`, docs/11): `ChannelRouter` handles access (allowlist by default), a per-chat `RateLimiter`, `/start` and `/new` (`SessionStore.detachExternalId`), per-conversation promise queues, typing, and `splitMessage`. Adapters that expose `editable` (post/edit/remove; `TelegramChannel` unless `liveReplies: false`) get live replies through `LiveReply` in `stream.ts`: a throttled draft with a cursor, reset on `tool_start`, spilling past the length limit, and settled by `finish(final)`. Edit failures fall back to plain sends. Tests need a provider that yields with delays (FakeProvider emits every token in one tick). Chat files: adapters attach `InboundMessage.document` (caption = text), and `ChannelRouter` saves it through `options.documents` (`DocumentHandler`; the CLI's `apps/cli/src/documents.ts` writes `uploads/` in the workspace via knowledge's `extractText`) before running the agent with `documentNote(...)`. `TelegramChannel` supports polling (`startPolling`) or a `webhookApp(secret)`; `WhatsAppChannel` and `MessengerChannel` `webhookApp()` share the Meta handshake and `X-Hub-Signature-256` check in `meta.ts`. Both platforms are plain `fetch` clients that take an injectable `fetch`, which the tests use via `fakeFetch`. `apps/cli/src/channels.ts` (`setupChannels`) builds them from config and fails fast with `ConfigError` on missing secrets. Voice notes: adapters attach `InboundMessage.audio` with a lazy `download()`; `ChannelRouter` (with `voice`) transcribes only after access/rate checks via the `Transcriber` interface (`shared`; `OpenAICompatibleTranscriber` in `providers`). Website widget (`packages/gateway/src/widget/`, ADR-0013): `routes.ts` serves `/widget.js`, `/widget/frame` (CSP `frame-ancestors` from `channels.widget.allowedOrigins`) and `/widget/api/*` for anonymous visitors with HMAC tokens (`token.ts`, `BANGLACLAW_WIDGET_SECRET`; `apps/cli/src/widget.ts` validates the config). Each visitor maps to one `widget` session by `externalId`, and tool details are never streamed to it. `assets.ts` holds the loader and frame (String.raw rules as below); the markdown renderer both pages inline is `browser-markdown.ts`. `/chat` (`packages/gateway/src/web-chat.ts`) is a self-contained OpenClaw-style page: runs over `/v1/ws`, the session sidebar and history over `/v1/sessions` with the same key, and a small inline markdown renderer that escapes before tagging. Its `STYLE`/`BODY`/`SCRIPT` are `String.raw` literals, so they must not contain a backtick or `${` (the script uses `"\x60"`); its Files tab, 📎 uploads, 🎤 mic, session rename/delete/search and message actions use `/v1/features`, `/v1/workspace/*`, `/v1/transcriptions` and `PATCH`/`DELETE /v1/sessions/:id` (`files.ts` in the gateway; `apps/cli/src/workspace.ts` `gatewayFileDeps` wires them). The Playwright tests in `e2e/` exercise the page's JS (and the widget and dashboard), so run `pnpm e2e` after UI changes.
- **Auth** (`packages/auth`): `bck_<12 id>_<40 secret>` tokens store only a SHA-256 hash and are verified with `timingSafeEqual`; `issueKey` creates the user on demand. The store is `InMemoryAuthStore` or `PostgresAuthStore` (`users`, `api_keys` tables). In memory mode `banglaclaw serve` prints a temporary key; `key create/list/revoke` require postgres.
- **CLI** (`apps/cli`, docs/17):
  - `src/program.ts` builds the commander tree (help groups, examples, global `--json/-q/--no-color/-c`, applied in a `preAction` hook). `src/index.ts` maps errors through `ui/errors.ts` `toCliError` (hint + exit code).
  - Commands live in `src/commands/*`: `shared.ts` holds session/knowledge/auth/desk helpers, and `doctor.ts` exports `collectChecks` (reused by the `init` wizard).
  - Output goes through `ui/output.ts` (`emit(data, humanRenderer)` for `--json`, `print`/`note`/`warn`), `ui/table.ts` (string-width, Bangla-safe) and `ui/theme.ts` (colors and symbols). Never `console.log` in commands.
  - `src/tui/` is the Ink chat: `useChat.ts` bridges RunEvents to state, and `App.tsx` handles input, slash menu and status bar. It is tested with ink-testing-library in `test/tui.test.tsx`. `chat-plain.ts` is the non-TTY fallback (async readline iterator).
  - `src/init/config.ts` holds the pure wizard logic (`buildConfigYaml`, `mergeEnv`).
  - `src/mcp-server.ts` (`createBanglaClawMcpServer`) is BanglaClaw as an MCP server (`mcp serve`, stdio): `ask` runs the agent on channel `mcp` keyed by conversation name; `search_knowledge` when enabled. stdout is the protocol, so that command must never `print`. Tested with `InMemoryTransport`.
- **Config** (`packages/shared/config.ts`): `banglaclaw.yaml` + `BANGLACLAW_*` env overrides validated by a strict Zod schema. API keys and `DATABASE_URL` come only from env, and the strict schema rejects them in YAML. Relative paths (such as `skills.dirs`) resolve against `baseDir`, which is the config file's directory or else cwd. The logger writes redacted JSON to stderr, because stdout is reserved for streamed replies.

Post-1.0 ideas: see docs/20-roadmap.md "After 1.0" (the single source of truth; move items to "shipped" there when they land).

## Rules that matter here (from AGENT.md, docs/14)

- Parse external data with Zod instead of `as` casts; use `unknown` then validate.
- The LLM is not the security boundary: application code decides whether a tool call is allowed. Never put authorization only in prompts. No default shell/filesystem/network access; destructive tools need validation, authz, audit logging and confirmation.
- Agent tests must be deterministic (FakeProvider), covering routing, limits, tool validation and permission checks.
- Scope discipline (PROJECT_BRIEF): keep the single agent reliable before adding multi-agent features.
- Conventional commit prefixes (`feat:`, `fix:`, `docs:`, `refactor:`).
