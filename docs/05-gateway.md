# 05 — Gateway

## Purpose

The Gateway is the transport and orchestration boundary between channels and the agent runtime.

## Responsibilities

- Authentication
- Authorization
- Message normalization
- Session resolution
- Agent dispatch
- Streaming
- Rate limiting
- Request IDs
- Error mapping

## Flow

```text
Telegram ─┐
WhatsApp ─┤
Web ──────┼──→ Gateway → Session → Agent Runtime
CLI ──────┤
REST ─────┘
```

## Rule

A channel must not contain agent reasoning logic.
