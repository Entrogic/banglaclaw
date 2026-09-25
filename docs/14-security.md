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

## Implemented controls (v0.6)

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
  - Telegram webhook secret-token and WhatsApp `X-Hub-Signature-256` verification (timing-safe)
  - tokens from the environment only, and never included in error messages
  - web chat served with a strict CSP — see docs/11
- Knowledge and memory:
  - memories are owner-scoped on the server side; secrets are refused by `remember`
  - retrieved passages and memories are framed as data, not instructions
  - the knowledge base is readable by every bot user, so don't ingest per-user private data — see docs/07

## Principle

No agent should receive unrestricted shell, filesystem or network access by default.
