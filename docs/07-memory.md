# 07 — Memory and Knowledge

BanglaClaw separates conversation state (short-term), per-user facts (long-term memory) and organisation documents (the knowledge base).

## Short-term memory (v0.2)

Before each run, the runtime loads the session's most recent messages and trims them to `memory.maxHistoryMessages` (default 20) with `trimHistory()`. The window always starts at a user message, so it never begins with an orphaned tool result. Within a run, the LangGraph state holds the recent messages, tool results and observations.

## Long-term memory (v0.6)

`packages/knowledge` → `LongTermMemory`: short durable facts stored as vectors per **owner**.

| Session | Owner |
|---|---|
| Gateway API | `user:<userId>` |
| Telegram / WhatsApp | `<channel>:<conversation id>` (stable across `/new`) |
| CLI | `cli:local` |

- **Explicit writes.** The agent gets `remember`, `recall` and `forget` tools. The owner is derived server-side from the session, so the model can't touch another user's memories. `remember` refuses passwords, OTPs and PINs, merges near-duplicates (similarity ≥ 0.97) and enforces `maxPerOwner`.
- **Auto-recall** (`autoRecall: true`). A context provider adds memories to the system prompt as data, not instructions. When the owner has at most `recallLimit` memories, all of them are included; otherwise the most similar ones. The "include all" rule is there because cross-lingual similarity, such as a Banglish question against an English fact, is often low.
- Users can list and delete memories through `GET/DELETE /v1/memories` (gateway) or `banglaclaw memory list | forget` (CLI).
- Memories persist with `knowledge.vectorStore: qdrant`; the in-memory store loses them on restart.

## Knowledge base / RAG (v0.6)

`KnowledgeBase`:

- **Loaders.** `.txt`, `.md`, `.html` (`<head>`, scripts and styles removed) and `.pdf` (via `unpdf`), up to 20 MB.
- **Chunking** (`chunkText`). Paragraphs and sentences, with the Bangla `।`/`॥` treated as sentence ends; `chunkSize` 1200 characters with a `chunkOverlap` of 150.
- **Embeddings.** Any OpenAI-compatible `/embeddings` endpoint (`text-embedding-3-small` by default, or Ollama / vLLM through `embeddings.baseUrl`). Each chunk is embedded together with its document title.
- **Documents.** Named by their source path relative to the config file. Re-ingesting replaces the document's chunks; unchanged content (by SHA-256) is skipped.
- **The `search_knowledge` tool** returns passages with `source#chunk` citations. Passages below `minScore` are dropped.
- **Ingestion.** `knowledge.sources` are ingested on every start (unchanged files are skipped with Qdrant), or on demand with `banglaclaw kb ingest <paths>`.

## Vector stores

`VectorStore` interface: `ensureCollection`, `upsert`, `search`, `scroll`, `delete`, `count`.

- `InMemoryVectorStore`: exact cosine search, zero setup, rebuilt each start.
- `QdrantVectorStore`: REST API, cosine distance, payload indexes on `documentId`, `chunkIndex` and `ownerId`. It refuses a collection whose vector size doesn't match the embedding model. Qdrant runs on `localhost:56333` from `docker/compose.yaml`.

## Safety

- Memory writes are explicit, validated, owner-scoped and audited as tool calls.
- Retrieved passages and memories are presented to the model as data, not instructions. This mitigates prompt injection but doesn't prevent it; tool permissions remain the security boundary.
- Every user of a bot can read the documents in the knowledge base. Don't ingest private data that some users must not see (per-user document ACLs are planned).

## Planned

- Per-tenant or per-user document collections and ACLs
- pgvector adapter
- Hybrid search (BM25 + vectors) and re-ranking
- Ingestion API endpoint, URL/sitemap loaders, DOCX
