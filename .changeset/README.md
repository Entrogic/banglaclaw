# Changesets

Every pull request that changes a published package adds a changeset:

```bash
pnpm changeset
```

Pick the packages and the bump type (`patch` for fixes, `minor` for features, `major` only for breaking changes to the stable `/v1` API or public exports), then write a one-line summary for users. All `@entrogic-net/*` packages and `banglaclaw` share one version (`fixed` in `config.json`), so any changeset bumps them together.

When changesets reach `master`, the Release workflow opens a "Version Packages" pull request. Merging it publishes to npm. See [docs/19-development.md](../docs/19-development.md#releasing).
