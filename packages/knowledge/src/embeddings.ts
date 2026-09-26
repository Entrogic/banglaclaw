import { ConfigError } from "@entrogic-net/shared";

export interface Embedder {
  /** e.g. "openai-compatible:text-embedding-3-small" */
  readonly id: string;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export interface OpenAICompatibleEmbedderOptions {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  dimensions?: number;
  batchSize?: number;
  fetch?: FetchLike;
}

/** Embeddings via any OpenAI-compatible /embeddings endpoint (OpenAI, Ollama, vLLM, …). */
export class OpenAICompatibleEmbedder implements Embedder {
  readonly id: string;
  readonly #options: OpenAICompatibleEmbedderOptions;
  readonly #url: string;
  readonly #fetch: FetchLike;

  constructor(options: OpenAICompatibleEmbedderOptions) {
    if (options.apiKey === undefined && options.baseUrl === undefined) {
      throw new ConfigError("Embeddings need OPENAI_API_KEY (or EMBEDDINGS_API_KEY), or embeddings.baseUrl for a keyless local server");
    }
    this.#options = options;
    this.id = `openai-compatible:${options.model}`;
    this.#url = `${(options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/embeddings`;
    this.#fetch = options.fetch ?? fetch;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const out: number[][] = [];
    const batchSize = this.#options.batchSize ?? 64;
    for (let i = 0; i < texts.length; i += batchSize) {
      out.push(...(await this.#embedBatch(texts.slice(i, i + batchSize), signal)));
    }
    return out;
  }

  async #embedBatch(input: string[], signal?: AbortSignal): Promise<number[][]> {
    const { model, dimensions, apiKey } = this.#options;
    let res: Response;
    try {
      res = await this.#fetch(this.#url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey !== undefined && { Authorization: `Bearer ${apiKey}` }) },
        body: JSON.stringify({ model, input, ...(dimensions !== undefined && { dimensions }) }),
        ...(signal !== undefined && { signal }),
      });
    } catch (error) {
      if (signal?.aborted === true) throw error;
      throw new EmbeddingError(`Cannot reach embeddings endpoint ${new URL(this.#url).host}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const body = (await res.json().catch(() => ({}))) as { data?: { index: number; embedding: number[] }[]; error?: { message?: string } };
    if (!res.ok || body.data === undefined) {
      throw new EmbeddingError(`Embeddings request failed (${res.status}): ${body.error?.message ?? res.statusText}`);
    }
    const vectors = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.length !== input.length) throw new EmbeddingError(`Expected ${input.length} embeddings, got ${vectors.length}`);
    return vectors;
  }
}

/**
 * Deterministic offline embedder (feature hashing of word tokens). Similarity reflects shared
 * words only — for tests and demos, not real semantic search.
 */
export class HashEmbedder implements Embedder {
  readonly id: string;

  constructor(readonly dimensions = 256) {
    this.id = `hash:${dimensions}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array<number>(this.dimensions).fill(0);
      for (const token of text.normalize("NFC").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []) {
        let h = 2166136261;
        for (const ch of token) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619);
        const idx = Math.abs(h) % this.dimensions;
        v[idx] = (v[idx] ?? 0) + (h & 1 ? 1 : -1);
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}
