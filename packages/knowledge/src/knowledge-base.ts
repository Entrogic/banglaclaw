import { resolve } from "node:path";
import { createLogger, type Logger } from "@entrogic-net/shared";
import { chunkText } from "./chunking.js";
import type { Embedder, FetchLike } from "./embeddings.js";
import { sha256, stableUuid } from "./ids.js";
import { collectFiles, isUrl, loadFile, loadUrl } from "./loaders.js";
import type { VectorStore } from "./vector-store.js";

export interface KnowledgeHit {
  source: string;
  title: string;
  chunkIndex: number;
  score: number;
  text: string;
}

export interface KnowledgeDocument {
  documentId: string;
  source: string;
  title: string;
  chunkCount: number;
  ingestedAt: string;
}

export interface IngestResult {
  documentId: string;
  source: string;
  chunks: number;
  /** True when the stored content hash matched, so nothing was re-embedded. */
  skipped: boolean;
}

export interface KnowledgeBaseOptions {
  store: VectorStore;
  embedder: Embedder;
  collection: string;
  chunkSize: number;
  chunkOverlap: number;
  logger?: Logger;
  /** Used to download URL sources (tests inject a stub). */
  fetch?: FetchLike;
}

/**
 * Document knowledge for RAG (docs/07): documents are chunked, embedded and stored as points
 * with `{documentId, source, title, chunkIndex, chunkCount, text, contentHash}` payloads.
 * Re-ingesting a source replaces its chunks; unchanged content is skipped.
 */
export class KnowledgeBase {
  readonly #o: KnowledgeBaseOptions;
  readonly #logger: Logger;
  #ready: Promise<void> | undefined;

  constructor(options: KnowledgeBaseOptions) {
    this.#o = options;
    this.#logger = (options.logger ?? createLogger({ level: "warn" })).child({ component: "knowledge" });
  }

  /** Probes the embedding size and creates the collection. Idempotent. */
  init(): Promise<void> {
    this.#ready ??= (async () => {
      const [probe] = await this.#o.embedder.embed(["dimension probe"]);
      await this.#o.store.ensureCollection(this.#o.collection, probe?.length ?? 0, { documentId: "keyword", chunkIndex: "integer" });
    })().catch((error: unknown) => {
      this.#ready = undefined;
      throw error;
    });
    return this.#ready;
  }

  async ingestText(doc: { source: string; title?: string; text: string }): Promise<IngestResult> {
    await this.init();
    const { store, collection, embedder } = this.#o;
    const documentId = stableUuid(`doc:${doc.source}`);
    const contentHash = sha256(doc.text);

    const [first] = await store.scroll(collection, { filter: { documentId, chunkIndex: 0 }, limit: 1 });
    if (first?.payload.contentHash === contentHash) {
      return { documentId, source: doc.source, chunks: Number(first.payload.chunkCount ?? 0), skipped: true };
    }

    const chunks = chunkText(doc.text, { chunkSize: this.#o.chunkSize, chunkOverlap: this.#o.chunkOverlap });
    await store.delete(collection, { filter: { documentId } });
    if (chunks.length === 0) return { documentId, source: doc.source, chunks: 0, skipped: false };

    const title = doc.title ?? doc.source;
    const vectors = await embedder.embed(chunks.map((c) => `${title}\n\n${c}`));
    const ingestedAt = new Date().toISOString();
    await store.upsert(
      collection,
      chunks.map((text, chunkIndex) => ({
        id: stableUuid(`${documentId}:${chunkIndex}`),
        vector: vectors[chunkIndex] ?? [],
        payload: { documentId, source: doc.source, title, chunkIndex, chunkCount: chunks.length, text, contentHash, ingestedAt },
      })),
    );
    this.#logger.info("document ingested", { source: doc.source, chunks: chunks.length });
    return { documentId, source: doc.source, chunks: chunks.length, skipped: false };
  }

  /**
   * Ingests files, directories and http(s) URLs (relative paths resolve against `baseDir`). Files are
   * named relative to `baseDir` and URLs by their address, so the same source always maps to the same
   * document. Failures are reported per source.
   */
  async ingestPaths(paths: readonly string[], baseDir: string): Promise<{ results: IngestResult[]; errors: { path: string; error: string }[] }> {
    const files = await collectFiles(paths.filter((p) => !isUrl(p)).map((p) => resolve(baseDir, p)));
    const results: IngestResult[] = [];
    const errors: { path: string; error: string }[] = [];
    for (const file of [...files, ...paths.filter(isUrl)]) {
      try {
        const loaded = isUrl(file) ? await loadUrl(file, this.#o.fetch) : await loadFile(file, baseDir);
        if (loaded.text.trim() === "") throw new Error("no extractable text");
        results.push(await this.ingestText(loaded));
      } catch (error) {
        errors.push({ path: file, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { results, errors };
  }

  async search(query: string, options: { limit: number; minScore?: number }): Promise<KnowledgeHit[]> {
    await this.init();
    const [vector] = await this.#o.embedder.embed([query]);
    const hits = await this.#o.store.search(this.#o.collection, vector ?? [], {
      limit: options.limit,
      ...(options.minScore !== undefined && { minScore: options.minScore }),
    });
    return hits.map((h) => ({
      source: String(h.payload.source ?? ""),
      title: String(h.payload.title ?? ""),
      chunkIndex: Number(h.payload.chunkIndex ?? 0),
      score: Math.round(h.score * 1000) / 1000,
      text: String(h.payload.text ?? ""),
    }));
  }

  async listDocuments(): Promise<KnowledgeDocument[]> {
    await this.init();
    const points = await this.#o.store.scroll(this.#o.collection, { filter: { chunkIndex: 0 }, limit: 10_000 });
    return points
      .map(({ payload: p }) => ({
        documentId: String(p.documentId),
        source: String(p.source),
        title: String(p.title),
        chunkCount: Number(p.chunkCount),
        ingestedAt: String(p.ingestedAt),
      }))
      .sort((a, b) => a.source.localeCompare(b.source));
  }

  /** Removes a document by source path or document id. Returns false if it wasn't found. */
  async deleteDocument(sourceOrId: string): Promise<boolean> {
    await this.init();
    const docs = await this.listDocuments();
    const doc = docs.find((d) => d.source === sourceOrId || d.documentId === sourceOrId);
    if (doc === undefined) return false;
    await this.#o.store.delete(this.#o.collection, { filter: { documentId: doc.documentId } });
    return true;
  }
}
