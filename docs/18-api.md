# 18 — API

Initial API surface:

```text
POST /v1/agents/run

GET  /v1/agents

GET  /v1/sessions/:id

GET  /v1/sessions/:id/messages

POST /v1/sessions/:id/messages

GET  /v1/tools

GET  /v1/skills
```

## Streaming

The API should support streaming agent events and final responses over a suitable transport such as Server-Sent Events or WebSocket.

## API principles

- Versioned endpoints
- Typed request/response schemas
- Authentication
- Request IDs
- Consistent errors
