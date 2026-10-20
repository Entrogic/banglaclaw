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
pnpm banglaclaw <cmd>          # CLI from source: chat | agent run/list | session | run | kb | memory | workspace | serve | key | handoff | audit | init | doctor | db migrate/status | tool/skill list | mcp list/serve | a2a list | version | completion
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

- Packages: `packages/{shared,providers,tools,session,skills,storage,mcp,a2a,auth,agents,agent,gateway,channels,knowledge,workspace,observability,client,plugin-sdk}`, `apps/cli`, `apps/banglaclaw` (unscoped `banglaclaw` npm wrapper for `npx banglaclaw`), `apps/dashboard`, `mcp-servers/bangladesh`, `examples/plugins/bd-phone`, `e2e` (Playwright), all named `@entrogic-net/*` except the wrapper. Everything except the dashboard, examples and e2e is published to npm in lockstep via Changesets (ADR-0012, docs/19 "Releasing"); packages ship `dist/` + `src/`. Dependency direction: `shared` ← `providers`, `tools`, `session`, `skills`, `auth`, `agents` ← `agent` ← `gateway`, `channels` ← `cli` (channels don't depend on gateway; the CLI mounts their webhook apps via `GatewayDeps.routes`). `storage` (implements the `session` and `auth` interfaces), `mcp`, `a2a`, `knowledge` and `workspace` (all produce `tools`; knowledge also supplies a `ContextProvider`) are wired in only by `cli` (and `knowledge` types by `gateway`); `agent` and `gateway` depend on neither. Only `storage` imports Drizzle/pg; `agent` must not depend on `storage`. Shared types (`ToolSpec`, `StopReason`, `RunEvent`) live in `shared`.
- Each package's `exports` maps the custom condition `@banglaclaw/source` → `src/index.ts`. `tsconfig.base.json` (`customConditions`), tsx (`--conditions`) and each `vitest.config.ts` use it, so typecheck/test/dev need no build. `tsconfig.build.json` clears the condition so `tsc` builds against dependencies' `dist/`.
- ESM with `NodeNext`: relative imports need `.js` extensions. Strict + `noUncheckedIndexedAccess`; ESLint forbids `any` and non-null assertions.
- TypeScript is pinned to 6.x because typescript-eslint does not support TS 7 yet.
- `pnpm-workspace.yaml` `allowBuilds` whitelists packages allowed to run install scripts (pnpm 12 fails installs otherwise).

## Architecture

Flow: `Channels → Gateway → Session Manager → Agent Runtime (LangGraph) → Skills / Tools / MCP → Model Provider`. Core invariant (ADR-0005): **gateway, channels, agent runtime and tools stay independently replaceable**; the runtime never knows channel APIs or provider specifics. Each area has a spec in `docs/` (the number is in parentheses below); read it before changing that area.

- **Agent** (`packages/agent`, docs/04): `AgentRuntime.run(text, {sessionId, onEvent, signal})` needs an existing session and builds a per-run graph (`graph.ts`: `prepare → model ⇄ tools`, exiting via `finalize` or `limit`). Every run, including failures, saves a `RunRecord` (then throws `AgentRunError`); messages are appended only for finished runs, and the `limit` node closes dangling tool calls so stored history stays valid. Session history belongs to `SessionStore`; checkpoints (`thread_id = runId`) only hold graph state. Language detection (`language.ts`) is deterministic `bn`/`bn-en`/`en`; `prompts.ts` is versioned by `SYSTEM_PROMPT_VERSION`.
- **Multi-agent + handoff** (docs/04, ADR-0009): `AGENT.md` profiles (`packages/agents`) give each agent a tool subset enforced by a scoped policy. Control tools (`transfer_to_<agent>`, `request_human`) are handled in the graph's `tools` node, never in the registry. While handed off, the runtime stores messages without model calls and saves the run *before* appending messages (FK). `HandoffDesk` (session package) backs `/v1/handoffs` and `banglaclaw handoff`; operator replies are `AIMessage`s with `response_metadata.operator`.
- **Tools** (`packages/tools`, docs/09): `executeTool` runs lookup → input validation → `PermissionPolicy` → execute with timeout → output validation → audit, returning failures as error observations instead of throwing. `AllowlistPolicy` is deny-by-default and always denies `destructive`. The graph binds only allowed tools and the executor re-checks anyway.
- **External tools** — MCP (`packages/mcp`, docs/10), A2A client (`packages/a2a`, docs/25, ADR-0016), knowledge (`packages/knowledge`, docs/07) and workspace (`packages/workspace`, docs/24): all produce `BanglaClawTool`s that go through the normal allowlist (`<server>__<tool>`, `a2a__<name>`; wildcards like `bangladesh__*`). MCP and A2A managers connect in parallel at startup and report failures via `status()`, never throw. MCP tools default to `sensitive`; `destructiveHint` makes them `destructive` (always denied). Memory, workspace and file owners come from the session (`memoryOwner`/`sessionOwner`), **never from the model**. Workspace backs up to `.history/` and deletes to `.trash/`, which is why its tools are `sensitive` rather than destructive.
- **Skills** (`packages/skills`, docs/08, `skills/*/SKILL.md`): triggers match deterministically (Bengali as substrings, Latin as whole words); the top `skills.maxActive` are injected into the system prompt. A skill's `tools` never grants permission.
- **Providers** (`packages/providers`, docs/12): `ModelProvider { id; chat; stream }`; `LangChainProvider` wraps `ChatOpenAI` (OpenAI-compatible, optional `baseUrl`) or `ChatAnthropic`. Agent tests use `FakeProvider` (scripted turns, records calls); it emits every token in one tick, so streaming/live-reply tests need a provider that yields with delays.
- **Storage** (`packages/storage`, docs/13, ADR-0006): Drizzle schema + `PostgresSaver` checkpoints on one `pg.Pool`; LangChain messages are serialised as jsonb. With postgres storage the CLI refuses to start while migrations are pending (`openServices` in `apps/cli/src/bootstrap.ts`). `RunStore.stats()` aggregates in SQL in Postgres and via `computeStats` in memory; both exclude `agent: "human"` runs and control tools.
- **Gateway** (`packages/gateway`, docs/05 + docs/18, ADR-0007): Hono app from `createGatewayApp(deps, upgradeWebSocket?)`. `/v1` middleware does bearer API-key auth, key scopes (`read` = GET, `run` = everything else) and per-key rate limits; `GatewayContext` enforces session ownership (other users' resources → 404) and namespaces `externalId` as `<userId>/<externalId>`. All errors map through `toHttpError`. `openapi.ts` must document every route (a contract test compares it with `app.routes`); the widget and `/a2a` routes are deliberately excluded. The A2A server uses `@a2a-js/sdk`'s framework-free transport handlers on Hono — never import the SDK's express entry points. Tests use `app.request()`, a real server on port 0 for WebSocket, and `GatedProvider` (`test/helpers.ts`) to block runs for concurrency/cancel tests.
- **Browser pages served by the gateway**: `/chat` (`web-chat.ts`) and the widget (`widget/assets.ts`, ADR-0013) are inline pages whose `STYLE`/`BODY`/`SCRIPT` are `String.raw` literals, so they **must not contain a backtick or `${`** (use `"\x60"`). Their markdown renderer (`browser-markdown.ts`) escapes before tagging. Widget visitors are anonymous (HMAC tokens, `BANGLACLAW_WIDGET_SECRET`) and never receive tool details. Run `pnpm e2e` after UI changes.
- **Dashboard** (`apps/dashboard`, ADR-0011): Vite + React SPA at `/admin/` that depends only on `@entrogic-net/client`. It uses Bundler module resolution (extensionless imports) and is excluded from the root `tsconfig.json`. The CSP allows only `'self'`, so fonts are bundled via `@fontsource` and charts are hand-written SVG. Colours are `light-dark()` tokens in `src/styles.css`, shared with `web-chat.ts` and the TUI palette (`ui/theme.ts`). Tests render `App` against a real `createGatewayApp` through an injected `fetch`; `pnpm --filter @entrogic-net/dashboard demo` + `dev` works without a model key.
- **Channels** (`packages/channels`, docs/11): `ChannelRouter` does access (allowlist by default), per-chat rate limiting, `/start`/`/new`, per-conversation queues and message splitting; voice notes are transcribed only after access/rate checks. Telegram, WhatsApp and Messenger adapters are plain `fetch` clients with an injectable `fetch` (tests use `fakeFetch`). `apps/cli/src/channels.ts` builds them from config and fails fast with `ConfigError` on missing secrets.
- **Auth** (`packages/auth`): `bck_<12 id>_<40 secret>` tokens; only a SHA-256 hash is stored. In memory mode `banglaclaw serve` prints a temporary key; `key create/list/revoke` require postgres. Roles are `user`/`operator`/`admin` (`hasRole`).
- **Observability** (`packages/observability`, docs/15, ADR-0010): the agent and gateway use only `@opentelemetry/api`; the CLI calls `initTelemetry()` and wires `Metrics` via `AgentRuntimeOptions.onRunComplete`. `auditRecorder()` never throws.
- **CLI** (`apps/cli`, docs/17): commander tree in `src/program.ts`; errors map through `ui/errors.ts` `toCliError`. Output goes through `ui/output.ts` (`emit(data, humanRenderer)` for `--json`, `print`/`note`/`warn`) and `ui/table.ts` (Bangla-safe widths) — never `console.log` in commands. `src/tui/` is the Ink chat (tested with ink-testing-library); `chat-plain.ts` is the non-TTY fallback. `mcp serve` (`src/mcp-server.ts`) speaks MCP over stdout, so it must never `print`. Plugins (docs/23, `apps/cli/src/plugins.ts`) are trusted in-process code.
- **Config** (`packages/shared/config.ts`, docs/16): `banglaclaw.yaml` + `BANGLACLAW_*` env overrides, validated by a strict Zod schema. API keys and `DATABASE_URL` come only from env (the schema rejects them in YAML). Relative paths resolve against the config file's directory (else cwd). Logs are redacted JSON on stderr because stdout carries streamed replies.
- **Evals** (`evals/deepeval`, docs/26, ADR-0017): a Python DeepEval harness outside the pnpm workspace drives the agent over `/v1` and records scores at `/v1/admin/evals` (`EvalStore` in `shared`, tables in `storage`, Evals page in the dashboard). Its `language.py` ports `packages/agent/src/language.ts`; change both together. Tests: `cd evals/deepeval && python -m pytest -q` (offline).
- **Deploy**: `Dockerfile` + `docker/compose.prod.yaml` (docs/21); releasing is in docs/19.

Post-1.0 ideas: see docs/20-roadmap.md "After 1.0" (the single source of truth; move items to "shipped" there when they land).

## Rules that matter here (from AGENT.md, docs/14)

- Parse external data with Zod instead of `as` casts; use `unknown` then validate.
- The LLM is not the security boundary: application code decides whether a tool call is allowed. Never put authorization only in prompts. No default shell/filesystem/network access; destructive tools need validation, authz, audit logging and confirmation.
- Agent tests must be deterministic (FakeProvider), covering routing, limits, tool validation and permission checks.
- Scope discipline (PROJECT_BRIEF): keep the single agent reliable before adding multi-agent features.
- Conventional commit prefixes (`feat:`, `fix:`, `docs:`, `refactor:`).
