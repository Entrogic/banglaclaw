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

## Principle

No agent should receive unrestricted shell, filesystem or network access by default.
