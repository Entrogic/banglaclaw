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

## Implemented so far (v0.1)

```text
apps/cli            banglaclaw CLI (commander)
packages/shared     types, errors, JSON logger, config loader
packages/providers  ModelProvider + OpenAI-compatible / Anthropic adapters, FakeProvider
packages/tools      tool contract, registry, permission policy, executeTool, built-ins
packages/agent      language detection, prompts, LangGraph graph, AgentRuntime, RunStore
```

Workspace packages export `src/index.ts` under the `@banglaclaw/source` condition, so tsx, Vitest and `tsc --noEmit` use sources directly; `pnpm build` emits `dist/` in dependency order via Turborepo. TypeScript is pinned to 6.x until typescript-eslint supports 7.x.

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
