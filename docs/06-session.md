# 06 — Session

## Session model

```ts
interface Session {
  id: string;
  userId?: string;
  channel: string;
  agentId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

## Initial persistence

```text
users
sessions
messages
runs
tool_calls
```

## Session responsibilities

- Identify conversation
- Restore state/checkpoint
- Attach user context
- Persist messages
- Track active agent
