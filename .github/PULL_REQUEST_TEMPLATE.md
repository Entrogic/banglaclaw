## What and why

<!-- What does this change, and why? Link the issue it addresses. -->

Closes #

## Type

<!-- The PR title should use the same conventional prefix. -->

- [ ] `feat:` new feature
- [ ] `fix:` bug fix
- [ ] `docs:` documentation only
- [ ] `refactor:` / `test:` / `chore:`

## How it was tested

<!-- Commands you ran, new tests, and manual checks (for UI changes, screenshots help). -->

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passes
- [ ] Tests are deterministic (`FakeProvider`, no live model or network calls)
- [ ] Behavior or design changes update the relevant `docs/` page; significant decisions add an ADR in `docs/adr/`
- [ ] If `docs/05`, `08`, `10` or `11` changed, `docs/bn/` is updated too
- [ ] New gateway routes are documented in `packages/gateway/src/openapi.ts`, and `/v1` changes are additive
- [ ] Schema changes include a generated migration (`pnpm --filter @banglaclaw/storage db:generate`)
- [ ] New tools declare input/output schemas and a `risk` level; permissions are enforced in code, not prompts
- [ ] User-visible changes have an entry under `## Unreleased` in `CHANGELOG.md`
