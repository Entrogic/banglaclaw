import type { FetchLike } from "./embeddings.js";
import type { Payload, PayloadFilter, ScoredPoint, VectorPoint, VectorStore } from "./vector-store.js";

export class QdrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QdrantError";
  }
}

function toFilter(filter?: PayloadFilter) {
  if (filter === undefined) return undefined;
  return { must: Object.entries(filter).map(([key, value]) => ({ key, match: { value } })) };
}

/** Qdrant over its REST API (no SDK). Distance: cosine. */
export class QdrantVectorStore implements VectorStore {
  readonly kind = "qdrant";
  readonly #base: string;
  readonly #apiKey: string | undefined;
  readonly #fetch: FetchLike;

  constructor(options: { url: string; apiKey?: string; fetch?: FetchLike }) {
    this.#base = options.url.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? fetch;
  }

  async #request<T>(method: string, path: string, body?: unknown, allow404 = false): Promise<T | undefined> {
    let res: Response;
    try {
      res = await this.#fetch(`${this.#base}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(this.#apiKey !== undefined && { "api-key": this.#apiKey }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new QdrantError(`Cannot reach Qdrant at ${this.#base}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (allow404 && res.status === 404) return undefined;
    const json = (await res.json().catch(() => ({}))) as { result?: T; status?: { error?: string } | string };
    if (!res.ok) {
      const detail = typeof json.status === "object" ? json.status.error : json.status;
      throw new QdrantError(`Qdrant ${method} ${path} failed (${res.status}): ${detail ?? res.statusText}`);
    }
    return json.result;
  }

  async ensureCollection(name: string, dimensions: number, indexFields: Record<string, "keyword" | "integer"> = {}): Promise<void> {
    const path = `/collections/${encodeURIComponent(name)}`;
    const info = await this.#request<{ config: { params: { vectors: { size?: number } } } }>("GET", path, undefined, true);
    if (info === undefined) {
      await this.#request("PUT", path, { vectors: { size: dimensions, distance: "Cosine" } });
    } else {
      const size = info.config.params.vectors.size;
      if (size !== undefined && size !== dimensions) {
        throw new QdrantError(`Qdrant collection ${name} has ${size} dimensions but the embedding model produces ${dimensions}; use another collection name`);
      }
    }
    for (const [field, schema] of Object.entries(indexFields)) {
      await this.#request("PUT", `${path}/index?wait=true`, { field_name: field, field_schema: schema });
    }
  }

  async upsert(name: string, points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.#request("PUT", `/collections/${encodeURIComponent(name)}/points?wait=true`, { points });
  }

  async search(name: string, vector: number[], options: { limit: number; filter?: PayloadFilter; minScore?: number }): Promise<ScoredPoint[]> {
    const result = await this.#request<{ id: string | number; score: number; payload?: Payload }[]>("POST", `/collections/${encodeURIComponent(name)}/points/search`, {
      vector,
      limit: options.limit,
      with_payload: true,
      ...(options.filter !== undefined && { filter: toFilter(options.filter) }),
      ...(options.minScore !== undefined && { score_threshold: options.minScore }),
    });
    return (result ?? []).map((p) => ({ id: String(p.id), score: p.score, payload: p.payload ?? {} }));
  }

  async scroll(name: string, options: { filter?: PayloadFilter; limit: number }): Promise<{ id: string; payload: Payload }[]> {
    const result = await this.#request<{ points: { id: string | number; payload?: Payload }[] }>("POST", `/collections/${encodeURIComponent(name)}/points/scroll`, {
      limit: options.limit,
      with_payload: true,
      with_vector: false,
      ...(options.filter !== undefined && { filter: toFilter(options.filter) }),
    });
    return (result?.points ?? []).map((p) => ({ id: String(p.id), payload: p.payload ?? {} }));
  }

  async delete(name: string, selector: { ids: string[] } | { filter: PayloadFilter }): Promise<void> {
    const body = "ids" in selector ? { points: selector.ids } : { filter: toFilter(selector.filter) };
    await this.#request("POST", `/collections/${encodeURIComponent(name)}/points/delete?wait=true`, body);
  }

  async count(name: string, filter?: PayloadFilter): Promise<number> {
    const result = await this.#request<{ count: number }>("POST", `/collections/${encodeURIComponent(name)}/points/count`, {
      exact: true,
      ...(filter !== undefined && { filter: toFilter(filter) }),
    });
    return result?.count ?? 0;
  }
}
