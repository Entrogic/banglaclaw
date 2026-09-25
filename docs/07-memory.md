# 07 — Memory

BanglaClaw separates conversation state from durable memory.

## Short-term memory

Current execution context:

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
