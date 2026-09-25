# 14 — Security

Security is a core architecture requirement, not a later feature.

## Threat areas

- Prompt injection
- Tool abuse
- SSRF
- Secret leakage
- Shell execution
- Filesystem access
- MCP trust boundaries
- Tenant isolation
- Rate abuse
- Malicious documents
- Untrusted web content

## Required controls

- Explicit tool permissions
- Sandboxing for high-risk tools
- Authentication and authorization
- Secret management
- Rate limiting
- Input/output validation
- Audit logs
- Timeouts
- Network restrictions

## Implemented controls (v1.0)

- Deny-by-default tool allowlist; destructive tools are always denied (no confirmation flow yet)
- Input and output validation, per-call timeouts and a run timeout, and iteration / tool-call limits
- An audit record for every tool call, persisted with postgres storage
- API keys and `DATABASE_URL` accepted from the environment only (the strict config schema rejects them in YAML); logs redact secret-looking keys
- MCP trust boundary: untrusted servers, minimal subprocess environment, `${VAR}` secret references, risk that can only be raised — see docs/10
- Gateway:
  - API keys (hashed, revocable) and tenant isolation (other users' sessions and runs return 404, `externalId` namespaced per user)
  - per-key rate limits and a concurrent-run cap
  - body size and input length limits, CORS off by default
  - binds to 127.0.0.1 by default — see docs/05
- Channels:
  - allowlist access by default, per-chat rate limits, and rate-limited refusals
  - Telegram webhook secret-token and WhatsApp/Messenger `X-Hub-Signature-256` verification (timing-safe)
  - tokens from the environment only, and never included in error messages
  - web chat served with a strict CSP — see docs/11
- Knowledge and memory:
  - memories are owner-scoped on the server side; secrets are refused by `remember`
  - retrieved passages and memories are framed as data, not instructions
  - the knowledge base is readable by every bot user, so don't ingest per-user private data — see docs/07
- Audit log (`audit_logs`): failed and forbidden requests, rate limiting, key creation and revocation, tool denials, handoff request/reply/release, memory deletion. Includes actor, target, IP, request id and metadata, but never message content or secrets. Writes never fail requests, and flood-prone events are throttled per source.
- API keys have scopes (`read`, `run`); users have roles (`user`, `operator`, `admin`).
- Gateway response headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store` on `/v1`. Client IPs come from `X-Forwarded-For` only with `gateway.trustProxy`.
- Supply chain: `pnpm audit --audit-level high` runs in CI (`.github/workflows/ci.yml`); the lockfile is frozen in CI and Docker builds; the container runs as a non-root user.
- Plugins are trusted in-process code (docs/23); MCP servers are untrusted (docs/10).
- Multi-agent:
  - specialist tool subsets are enforced by a scoped permission policy and can only narrow `tools.allow`
  - transfer limits per run
  - handoff queues are only visible to operator-role users; every operator reply is audited as a run — see docs/04

## Reporting vulnerabilities

See `SECURITY.md`.

## Principle

No agent should receive unrestricted shell, filesystem or network access by default.
