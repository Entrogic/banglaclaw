# 10 — MCP

MCP is a first-class integration layer.

## Client architecture

```text
BanglaClaw
    │
    ▼
 MCP Client
    │
 ├── CRM MCP
 ├── Ecommerce MCP
 ├── Database MCP
 └── Bangladesh Data MCP
```

## Server architecture

BanglaClaw can also expose selected capabilities as an MCP server.

## Requirements

- Tool discovery
- Typed schemas
- Authentication
- Permission checks
- Timeouts
- Error handling
- Audit logging
- Connection lifecycle management

## Example MCP ecosystem

```text
mcp-servers/
├── bangladesh/
├── crm/
└── ecommerce/
```
