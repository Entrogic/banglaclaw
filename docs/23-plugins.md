# 23 — Plugins

Plugins are ES modules that add **tools**, **skills**, **agents** and **context providers** to BanglaClaw. They are listed in `banglaclaw.yaml`:

```yaml
plugins:
  - ./plugins/my-plugin               # a path relative to the config file (a directory with package.json, or a .js file)
  - "@acme/banglaclaw-plugin-crm"     # an installed package, resolved from the config file's directory
tools:
  allow: [validate_bd_phone, "crm__*"]   # plugin tools still need to be allowed
```

**Plugins run in-process with full privileges.** Install only code you trust and review it like any other dependency. The tool allowlist, input and output validation, timeouts and audit logging still apply to the tools they register.

## Writing a plugin

```js
// index.js
import { definePlugin, defineTool, pluginDir, z } from "@entrogic-net/plugin-sdk";

const lookupOrder = defineTool({
  name: "lookup_order",                  // snake_case, unique
  description: "Look up an order by its number.",
  risk: "sensitive",                     // safe | sensitive | destructive (destructive is always denied)
  timeoutMs: 5_000,
  inputSchema: z.strictObject({ orderNumber: z.string().regex(/^\d{4,10}$/) }),
  outputSchema: z.strictObject({ status: z.string(), eta: z.string().optional() }),
  async execute({ orderNumber }, ctx) {
    // ctx: { runId, sessionId, timezone, signal }. Honour ctx.signal for cancellation.
    const res = await fetch(`https://orders.internal/api/${orderNumber}`, { signal: ctx.signal });
    return res.json();
  },
});

export default definePlugin({
  name: "orders",
  version: "1.0.0",
  tools: [lookupOrder],
  skillsDirs: [pluginDir(import.meta.url, "skills")],   // <dir>/<skill>/SKILL.md (docs/08)
  agentsDirs: [pluginDir(import.meta.url, "agents")],   // <dir>/<agent>/AGENT.md (docs/04)
  contextProviders: [],                                 // async ({ session, input, language, signal }) => string | undefined
});
```

- Use the `z` exported by `@entrogic-net/plugin-sdk`, so schemas convert correctly to the JSON Schema shown to the model.
- `definePlugin` stamps `apiVersion: 1`. BanglaClaw refuses plugins built for a newer plugin API.
- `banglaclaw doctor` loads configured plugins and warns about plugin tools missing from `tools.allow`. `serve` prints the loaded plugins.

## Example

`examples/plugins/bd-phone` validates Bangladeshi mobile numbers (Bangla or English digits, with or without `+88`) and reports the operator. It ships a `validate_bd_phone` tool and a `bd-phone` skill.

```yaml
plugins: [examples/plugins/bd-phone]
tools:
  allow: [calculator, current_datetime, validate_bd_phone]
```

## Plugins, MCP servers or skills?

| Need | Use |
|---|---|
| Instructions or workflow only | A **skill** (SKILL.md) |
| A capability in another process or language, reusable by other MCP clients | An **MCP server** (docs/10) |
| In-process TypeScript/JS tools, plus skills and agents shipped together | A **plugin** |
