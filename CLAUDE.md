# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

BanglaClaw is a Bangla-first, open-source AI agent runtime (TypeScript + LangGraph + MCP) that understands Bangla, Banglish and English. **v0.1 Agent Core is implemented** (single agent, CLI, tool calling, streaming, in-memory runs); v0.2 (sessions, PostgreSQL, skills) is next — see docs/20-roadmap.md. Architecture is specified in `docs/` first: when behavior or design changes, update the relevant `docs/` file (and add an ADR in `docs/adr/` for significant decisions) in the same change.

## Commands

pnpm workspaces + Turborepo. Never use npm or yarn. Node 22+.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # pre-PR gate
pnpm banglaclaw <cmd>          # run the CLI from source: chat | agent run "<msg>" | tool list | doctor
pnpm dev                       # chat REPL with tsx watch
pnpm --filter @banglaclaw/agent test language              # one test file (name filter)
pnpm --filter @banglaclaw/agent exec vitest run -t "maxIterations"   # one test by name
pnpm --filter @banglaclaw/<pkg> add <dep>
```

Live model runs need `OPENAI_API_KEY` or `BANGLACLAW_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`, or `BANGLACLAW_BASE_URL` pointing at a keyless OpenAI-compatible server (Ollama/vLLM). Tests never hit the network.

## Monorepo mechanics

- Packages: `packages/{shared,providers,tools,agent}`, `apps/cli`, all named `@banglaclaw/*`. Dependency direction: `shared` ← `providers`, `tools` ← `agent` ← `cli`. `providers` must not depend on `tools` (shared types like `ToolSpec` live in `shared`).
- Each package's `exports` maps the custom condition `@banglaclaw/source` → `src/index.ts`. `tsconfig.base.json` (`customConditions`), tsx (`--conditions`) and each `vitest.config.ts` use it, so typecheck/test/dev need no build. `tsconfig.build.json` clears the condition so `tsc` builds against dependencies' `dist/`.
- ESM with `NodeNext`: relative imports need `.js` extensions. Strict + `noUncheckedIndexedAccess`; ESLint forbids `any` and non-null assertions.
- TypeScript is pinned to 6.x because typescript-eslint does not support TS 7 yet.
- `pnpm-workspace.yaml` `allowBuilds` whitelists packages allowed to run install scripts (pnpm 12 fails installs otherwise).

## Architecture

Target flow: `Channels → Gateway → Session Manager → Agent Runtime (LangGraph) → Skills / Tools / MCP → Model Provider`. Core invariant (ADR-0005): **gateway, channels, agent runtime and tools stay independently replaceable**; the runtime never knows channel APIs or provider specifics.

What exists (v0.1):

- **Agent** (`packages/agent`): `AgentRuntime.run(text, {sessionId, onEvent, signal})` detects language, builds a per-run graph (`graph.ts`: `prepare → model ⇄ tools`, exits via `finalize` or `limit`), streams `RunEvent`s, enforces `timeoutMs` via `AbortSignal`, keeps per-session history in memory, and saves a `RunRecord` to a `RunStore` for every run (failures too, then throws `AgentRunError`). History is only committed for successful runs; the `limit` node closes dangling tool calls so stored history stays valid for providers.
- **Language** (`language.ts`): deterministic `bn` / `bn-en` / `en` from Bengali-script word ratio plus a Banglish lexicon; the system prompt (`prompts.ts`, versioned by `SYSTEM_PROMPT_VERSION`) tells the model to reply in the same language/script.
- **Tools** (`packages/tools`): `BanglaClawTool` with Zod v4 `inputSchema`/`outputSchema` and `risk`. `executeTool` runs lookup → input validation → `PermissionPolicy` → execute with timeout → output validation → audit, and returns failures as error observations instead of throwing. `AllowlistPolicy` is deny-by-default and always denies `destructive`. The graph binds only allowed tools and the executor re-checks anyway.
- **Providers** (`packages/providers`): `ModelProvider { id; chat; stream }` taking `{tools?: ToolSpec[], signal?}`; `LangChainProvider` wraps `ChatOpenAI` (openai-compatible, optional `baseUrl`) or `ChatAnthropic`. Use `FakeProvider` (scripted turns, records calls) for agent tests.
- **Config** (`packages/shared/config.ts`): `banglaclaw.yaml` + `BANGLACLAW_*` env overrides validated by a strict Zod schema; API keys come only from env (the strict schema rejects them in YAML). Logger writes redacted JSON to stderr (stdout is reserved for streamed replies).

Planned (docs/04, 08, 10): router/planner/verifier nodes, skills (`skills/<name>/SKILL.md`), MCP client/servers (`mcp-servers/`), gateway, channels, PostgreSQL storage. Follow the layout in docs/19-development.md; `AGENT.md` §2 shows a different generic layout (`apps/api`, `packages/llm`, …) — prefer docs/19 and ask before diverging.

## Rules that matter here (from AGENT.md, docs/14)

- Parse external data with Zod instead of `as` casts; use `unknown` then validate.
- The LLM is not the security boundary: application code decides whether a tool call is allowed. Never put authorization only in prompts. No default shell/filesystem/network access; destructive tools need validation, authz, audit logging and confirmation.
- Agent tests must be deterministic (FakeProvider), covering routing, limits, tool validation and permission checks.
- Scope discipline (PROJECT_BRIEF): keep the single agent reliable before adding multi-agent features.
- Conventional commit prefixes (`feat:`, `fix:`, `docs:`, `refactor:`).
