# 07 — Memory

BanglaClaw separates conversation state from durable memory.

## Short-term memory (implemented, v0.2)

Before each run the runtime loads the session's most recent messages and trims them to `memory.maxHistoryMessages` (default 20) with `trimHistory()`, which also advances the window to the first user message so it never starts with an orphaned tool result. Within a run the LangGraph state holds:

- Recent messages
- Current graph state
- Tool results
- Plans
- Observations

## Long-term memory

Potential data:

- User preferences
- Durable facts
- Past interactions
- Domain knowledge

## Proposed storage

PostgreSQL for structured memory and an optional vector store such as Qdrant for semantic retrieval.

## Safety

Memory writes should be explicit, validated and scoped to the correct user/tenant.
