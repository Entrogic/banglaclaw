# Contributing to BanglaClaw

Thanks for helping build a Bangla-first agent runtime! Issues and pull requests are welcome in Bangla or English.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). For questions, see [SUPPORT.md](SUPPORT.md); for how decisions are made, see [GOVERNANCE.md](GOVERNANCE.md).

## Issues

Use the [issue forms](https://github.com/Entrogic/banglaclaw/issues/new/choose) for bugs and feature requests, and [Discussions](https://github.com/Entrogic/banglaclaw/discussions) for questions. Report security problems privately (see [SECURITY.md](SECURITY.md)). For a larger change, open an issue first so the design can be agreed before you write code.

## Setup

```bash
pnpm install                                   # Node 22+, pnpm (never npm or yarn)
docker compose -f docker/compose.yaml up -d    # PostgreSQL + Qdrant for integration tests
cp .env.example .env                           # optional: a model key for live runs
```

## Before opening a pull request

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
TEST_DATABASE_URL=postgres://banglaclaw:banglaclaw@localhost:54329/banglaclaw_test \
TEST_QDRANT_URL=http://localhost:56333 pnpm test    # include integration tests
```

CI runs the same checks plus the npm pack smoke test (`pnpm verify:pack`) and `pnpm audit --audit-level high`.

## Changesets

If your change affects a published package (anything outside `docs/`, `examples/` and the dashboard), add a changeset:

```bash
pnpm changeset    # choose patch / minor, then write one line for users
```

All packages share one version. Maintainers release by merging the automatic "version packages" pull request (see [docs/19-development.md](docs/19-development.md#releasing)).

## Guidelines

- **Design first.** Behavior changes update the relevant `docs/` page in the same PR. Significant decisions get an ADR in `docs/adr/`.
- **TypeScript.** Strict TypeScript, no `any`. Validate external data with Zod.
- **Tests.** Agent tests are deterministic: use `FakeProvider`, never live model calls.
- **Security.** Tools need input and output schemas and a `risk` level; the application, not the prompt, decides permissions (AGENT.md §32).
- **API.** New gateway routes must be added to `packages/gateway/src/openapi.ts`; a contract test enforces it. `/v1` changes must be additive (docs/18).
- **Database.** Schema changes: edit `packages/storage/src/schema.ts`, run `pnpm --filter @banglaclaw/storage db:generate`, and commit the generated migration.
- **Commits.** Conventional prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- **Pull requests.** Fill in the PR template checklist. Maintainers review against it.
- **Scope.** Keep PRs small and focused. New channels, tools, skills, MCP servers and plugins are especially welcome.

By contributing you agree that your contributions are licensed under the Apache License 2.0.
