# ADR-0012: Publish to npm with Changesets and Lockstep Versions

## Status

Accepted

## Context

Until 1.1 every package except `@entrogic-net/client` and `@entrogic-net/plugin-sdk` was `private`, so the only way to use BanglaClaw was to clone the monorepo. Plugins and API clients need installable packages, and `npx banglaclaw init` is the shortest path for new users. The public libraries depend on most internal packages, so publishing only a few is not possible. Versions had drifted (libraries at 1.0.0, the CLI at 1.1.0), and the CLI version was a hand-edited constant.

## Decision

- **Scope `@entrogic-net`.** Packages live under the maintainers' existing npm organisation instead of a new `@banglaclaw` one. The unscoped `banglaclaw` wrapper keeps the product name on the command line (`npx banglaclaw`). Package names are permanent on npm, so this is not expected to change.
- **Publish every runtime package**: the 16 `packages/*` libraries, `@entrogic-net/cli`, `@entrogic-net/mcp-server-bangladesh`, and an unscoped `banglaclaw` wrapper whose bin imports `@entrogic-net/cli`. The dashboard (served from the Docker image) and the examples stay private.
- **Lockstep versions.** All published packages share one version through a Changesets `fixed` group. Users match versions by eye, and internal `workspace:*` ranges become exact versions on pack.
- **Changesets and a release pull request.** Contributors add changesets. `.github/workflows/release.yml` (`changesets/action`) keeps a "version packages" pull request open, and merging it publishes with npm provenance. The CLI reads its version from `package.json`.
- **Ship `src/` next to `dist/`.** Source maps resolve, and the `@banglaclaw/source` export condition used inside the monorepo stays valid without a publish-time rewrite.
- **Verify real tarballs.** `scripts/pack-smoke.sh` installs the packed tarballs with npm in an empty project in CI and before every publish.

## Consequences

Positive:
- `npm install @entrogic-net/client`, `npm install -g @entrogic-net/cli` and `npx banglaclaw init` work, and plugins can depend on a published `@entrogic-net/plugin-sdk`
- One version number describes a release, and changelogs are generated per package
- Packaging mistakes (missing files, `workspace:` ranges, broken bins) fail CI before they reach npm

Trade-offs:
- A fix in one package bumps all 19, so some releases publish unchanged code
- Every package's public exports are now covered by SemVer, so breaking changes need a major version even outside the `/v1` API
- Publishing needs the npm `entrogic-net` organisation and an `NPM_TOKEN` secret, and those credentials must be guarded
