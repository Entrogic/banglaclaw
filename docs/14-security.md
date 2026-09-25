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

## Implemented controls (v0.3)

- Deny-by-default tool allowlist; destructive tools are always denied (no confirmation flow yet)
- Input and output validation, per-call timeouts and a run timeout, and iteration / tool-call limits
- An audit record for every tool call, persisted with postgres storage
- API keys and `DATABASE_URL` accepted from the environment only (the strict config schema rejects them in YAML); logs redact secret-looking keys
- MCP trust boundary: untrusted servers, minimal subprocess environment, `${VAR}` secret references, risk that can only be raised — see docs/10

## Principle

No agent should receive unrestricted shell, filesystem or network access by default.
