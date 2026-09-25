# ADR-0008: Qdrant and OpenAI-compatible Embeddings

## Status

Accepted

## Context

v0.6 adds retrieval over documents (RAG) and long-term memory. Both need embeddings and vector search, must work with Bangla, Banglish and English, and must work locally with zero setup.

## Decision

- A small `VectorStore` interface with two implementations: `InMemoryVectorStore` (zero setup, tests) and `QdrantVectorStore`, which talks to Qdrant's REST API directly (no SDK).
- One `Embedder` for any OpenAI-compatible `/embeddings` endpoint. The default is `text-embedding-3-small`; local models (Ollama bge-m3, vLLM) are reached through `embeddings.baseUrl`.
- Long-term memory is written only through explicit, owner-scoped tools (`remember`, `recall`, `forget`), not by automatic extraction.

## Consequences

Positive:
- A persistent, filterable vector store that runs as one container, as the roadmap intended
- The provider-agnostic embedder can keep all data local
- Memory writes are visible, audited and controllable

Trade-offs:
- One more service (Qdrant) for persistence. pgvector could reuse PostgreSQL and can be added behind the same interface.
- Changing the embedding model or dimensions requires a new collection (enforced at startup)
- Explicit memory depends on the model deciding to call `remember`
