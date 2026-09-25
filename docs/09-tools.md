# 09 — Tools

## Tool interface

```ts
type ToolRisk = "safe" | "sensitive" | "destructive";

interface BanglaClawTool<I, O> {
  name: string;               // snake_case, action-oriented
  description: string;
  inputSchema: z.ZodType<I>;  // Zod v4; converted to JSON Schema for the model
  outputSchema: z.ZodType<O>;
  risk: ToolRisk;
  timeoutMs?: number;         // default 10s
  execute(input: I, ctx: ToolContext): Promise<O>;
}
```

Implemented in `packages/tools`. `ToolRegistry` holds tools and produces provider-neutral `ToolSpec`s.

## Permission policy

`AllowlistPolicy` is deny-by-default: only tools listed in `tools.allow` may run, and `destructive` tools are always denied until a human-confirmation flow exists. The runtime only advertises allowed tools to the model, and `executeTool` re-checks the policy on every call. Tool failures (unknown tool, invalid input, denied, error, timeout, invalid output) become structured error observations for the model and are recorded as audit events.

## Built-in tools (v0.1)

- `calculator` — arithmetic via a hand-written parser (no `eval`), accepts Bangla digits
- `current_datetime` — current time in a given or configured IANA timezone, formatted in English and Bangla

## Planned tools

- calculator
- web search
- filesystem
- shell
- PostgreSQL
- GitHub
- HTTP
- browser

## Tool lifecycle

```text
Discover
  ↓
Validate input
  ↓
Permission check
  ↓
Execute
  ↓
Validate output
  ↓
Record audit event
```

Tools must be deterministic where possible and must expose clear input/output schemas.
