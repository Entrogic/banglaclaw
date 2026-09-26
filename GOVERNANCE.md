# Governance

BanglaClaw is an open-source project maintained by [Entrogic](https://github.com/Entrogic) and its community. This document describes how decisions are made.

## Roles

- **Users** use BanglaClaw and help by reporting bugs, asking questions and sharing feedback.
- **Contributors** send pull requests, write docs, review changes, triage issues or answer questions. Anyone can be a contributor.
- **Maintainers** review and merge pull requests, triage issues, cut releases and enforce the [Code of Conduct](CODE_OF_CONDUCT.md).

### Maintainers

| Maintainer | Area |
|---|---|
| [@dev-sajid007](https://github.com/dev-sajid007) | Lead maintainer, all areas |

## How decisions are made

- **Design first.** Behavior and architecture are specified in [`docs/`](docs/00-overview.md) before or alongside the code. A pull request that changes behavior updates the relevant page.
- **Significant decisions get an ADR.** New dependencies at the core, security model changes, API shape and similar decisions are recorded as [Architecture Decision Records](docs/adr/) and discussed in an issue or pull request before merging.
- **Lazy consensus.** Most changes are merged once a maintainer approves them and no open objections remain. If there is disagreement, maintainers discuss it in the open and the lead maintainer makes the final call.
- **Core invariants.** Some rules protect the project's design: the gateway, channels, agent runtime and tools stay independently replaceable ([ADR-0005](docs/adr/0005-gateway-agent-separation.md)), and authorization is enforced by application code, never only by prompts ([Security](docs/14-security.md)). Changing either one needs an ADR.

## Releases and compatibility

- BanglaClaw follows [Semantic Versioning](https://semver.org). Changes are recorded in [CHANGELOG.md](CHANGELOG.md) under `Unreleased` until a release.
- The `/v1` HTTP API is stable. Changes to it must be additive ([compatibility policy](docs/18-api.md#versioning-and-compatibility-v10)).
- Security fixes are released for the versions listed in [SECURITY.md](SECURITY.md).

## Becoming a maintainer

Contributors who make sustained, high-quality contributions (code, reviews, docs or community support) and show good judgement may be invited by the existing maintainers. Maintainers who become inactive for a long time may be moved to emeritus status, and can return whenever they like.

## Changes to this document

This document is changed by pull request and needs approval from the lead maintainer.
