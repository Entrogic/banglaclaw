# @banglaclaw/mcp-server-bangladesh

A read-only MCP server with Bangladesh reference data, bundled as an example for BanglaClaw (docs/10-mcp.md). It works with any MCP client over stdio.

| Tool | Purpose |
|---|---|
| `list_divisions` | 8 divisions with Bangla names and district counts |
| `list_districts` | all 64 districts, or those of one division (`division`: English or Bangla name) |
| `find_district` | look up a district by English/Bangla name, prefix or old spelling; returns its division |
| `format_taka` | `amount`, `locale` (`bn` / `en`) → lakh/crore grouping and a কোটি/লক্ষ/হাজার breakdown |
| `convert_digits` | `text`, `to` (`bn` / `en`) → Bangla ↔ English digits |

## Run

```bash
# from npm, with any MCP client (for example Claude Code)
npx -y @banglaclaw/mcp-server-bangladesh
claude mcp add bangladesh -- npx -y @banglaclaw/mcp-server-bangladesh

# from the repo root, from source
node --import tsx mcp-servers/bangladesh/src/bin.ts

# after `pnpm build`
node mcp-servers/bangladesh/dist/bin.js
```

## Use from BanglaClaw

```yaml
tools:
  allow: ["bangladesh__*"]
mcp:
  servers:
    bangladesh:
      transport: stdio
      command: node
      args: [--import, tsx, mcp-servers/bangladesh/src/bin.ts]
```

## Test

```bash
pnpm --filter @banglaclaw/mcp-server-bangladesh test
```
