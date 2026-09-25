# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

BanglaClaw is a Bangla-first, open-source AI agent runtime (TypeScript + LangGraph + MCP) that understands Bangla, Banglish and English. **v0.1 (agent core) and v0.2 (sessions, PostgreSQL, skills, short-term memory, checkpoints) are implemented**; v0.3 (MCP) is next — see docs/20-roadmap.md. Architecture is specified in `docs/` first: when behavior or design changes, update the relevant `docs/` file (and add an ADR in `docs/adr/` for significant decisions) in the same change.

## Commands

pnpm workspaces + Turborepo. Never use npm or yarn. Node 22+.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # pre-PR gate
pnpm banglaclaw <cmd>          # CLI from source: chat | agent run | session | run | skill list | tool list | db migrate | init | doctor
pnpm dev                       # chat REPL with tsx watch
pnpm --filter @banglaclaw/agent test language              # one test file (name filter)
pnpm --filter @banglaclaw/agent exec vitest run -t "maxIterations"   # one test by name
pnpm --filter @banglaclaw/<pkg> add <dep>
pnpm --filter @banglaclaw/storage db:generate   # after editing packages/storage/src/schema.ts; commit drizzle/

# Postgres (integration tests are skipped unless TEST_DATABASE_URL is set; they TRUNCATE tables)
docker compose -f docker/compose.yaml up -d      # localhost:54329, DBs banglaclaw + banglaclaw_test
TEST_DATABASE_URL=postgres://banglaclaw:banglaclaw@localhost:54329/banglaclaw_test pnpm test
BANGLACLAW_STORAGE=postgres DATABASE_URL=postgres://banglaclaw:banglaclaw@localhost:54329/banglaclaw pnpm banglaclaw db migrate
```

Live model runs need `OPENAI_API_KEY` or `BANGLACLAW_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`, or `BANGLACLAW_BASE_URL` pointing at a keyless OpenAI-compatible server (Ollama/vLLM). Tests never hit the network.

## Monorepo mechanics

- Packages: `packages/{shared,providers,tools,session,skills,storage,agent}`, `apps/cli`, all named `@banglaclaw/*`. Dependency direction: `shared` ← `providers`, `tools`, `session`, `skills` ← `agent` ← `cli`; `storage` depends on `session` (implements its interfaces) and is wired in only by `cli`. Only `storage` imports Drizzle/pg; `agent` must not depend on `storage`. Shared types (`ToolSpec`, `StopReason`, `RunEvent`) live in `shared`.
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
- **Sessions** (`packages/session`): `SessionStore` / `RunStore` interfaces with in-memory implementations, and `SessionManager.resolve()` (explicit id → `(channel, externalId)` → new).
- **Storage** (`packages/storage`, ADR-0006): Drizzle schema (`sessions`, `messages` with LangChain messages serialised as jsonb, `runs`, `tool_calls`) plus `PostgresSaver` checkpoints on one `pg.Pool`. The migrations folder resolves as `../drizzle` from both `src/` and `dist/`. With postgres storage the CLI refuses to start while migrations are pending (`openServices` in `apps/cli/src/bootstrap.ts`).
- **Skills** (`packages/skills`, `skills/*/SKILL.md`): YAML frontmatter (`name`, `description`, `version`, `tools`, `triggers`) plus markdown instructions. `SkillSet.select()` matches triggers deterministically (Bengali triggers as substrings, Latin as whole words), and the top `skills.maxActive` skills are injected into the system prompt. A skill's `tools` never grants permission.
- **Language** (`language.ts`): deterministic `bn` / `bn-en` / `en` from Bengali-script word ratio plus a Banglish lexicon; the system prompt (`prompts.ts`, versioned by `SYSTEM_PROMPT_VERSION`) tells the model to reply in the same language/script.
- **Tools** (`packages/tools`): `BanglaClawTool` with Zod v4 `inputSchema`/`outputSchema` and `risk`. `executeTool` runs lookup → input validation → `PermissionPolicy` → execute with timeout → output validation → audit, and returns failures as error observations instead of throwing. `AllowlistPolicy` is deny-by-default and always denies `destructive`. The graph binds only allowed tools and the executor re-checks anyway.
- **Providers** (`packages/providers`): `ModelProvider { id; chat; stream }` taking `{tools?: ToolSpec[], signal?}`; `LangChainProvider` wraps `ChatOpenAI` (openai-compatible, optional `baseUrl`) or `ChatAnthropic`. Use `FakeProvider` (scripted turns, records calls) for agent tests.
- **Config** (`packages/shared/config.ts`): `banglaclaw.yaml` + `BANGLACLAW_*` env overrides validated by a strict Zod schema. API keys and `DATABASE_URL` come only from env, and the strict schema rejects them in YAML. Relative paths (such as `skills.dirs`) resolve against `baseDir`, which is the config file's directory or else cwd. The logger writes redacted JSON to stderr, because stdout is reserved for streamed replies.

Planned (docs/04, 10): router/planner/verifier nodes, MCP client/servers (`mcp-servers/`), gateway, channels, auth/users. Follow the layout in docs/19-development.md; `AGENT.md` §2 shows a different generic layout (`apps/api`, `packages/llm`, …) — prefer docs/19 and ask before diverging.

## Rules that matter here (from AGENT.md, docs/14)

- Parse external data with Zod instead of `as` casts; use `unknown` then validate.
- The LLM is not the security boundary: application code decides whether a tool call is allowed. Never put authorization only in prompts. No default shell/filesystem/network access; destructive tools need validation, authz, audit logging and confirmation.
- Agent tests must be deterministic (FakeProvider), covering routing, limits, tool validation and permission checks.
- Scope discipline (PROJECT_BRIEF): keep the single agent reliable before adding multi-agent features.
- Conventional commit prefixes (`feat:`, `fix:`, `docs:`, `refactor:`).
