# 13 — Storage

## Primary database

PostgreSQL is the initial recommended relational database.

## Core tables

```text
users
sessions
messages
runs
tool_calls
memories
audit_logs
```

## Optional infrastructure

- Redis — caching, queues and ephemeral coordination
- Qdrant — vector retrieval
- S3-compatible storage — files and artifacts

Storage interfaces should remain replaceable.
