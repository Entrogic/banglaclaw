# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through GitHub's [Report a vulnerability](https://github.com/Entrogic/banglaclaw/security/advisories/new) form (Security → Advisories). Include steps to reproduce and the affected version. We aim to acknowledge reports within 3 working days.

## Supported versions

| Version | Supported |
|---|---|
| 1.x | ✅ |
| < 1.0 | ❌ |

## Scope and design

See [docs/14-security.md](docs/14-security.md). Key points:

- **The application enforces permissions, not the LLM.** Tools are deny-by-default and destructive tools are always denied.
- **Secrets are read from the environment only**, and logs redact secret-looking fields.
- **MCP servers are untrusted; plugins are trusted in-process code.**

## Known advisories

- `esbuild` ≤ 0.24.2 (GHSA-67mh-4wv8-2f99, moderate) is present through `drizzle-kit`, a development-only tool used to generate migrations. It is not included in production installs or the Docker image, and the vulnerable dev server is never started.
