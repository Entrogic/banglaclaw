export type Payload = Record<string, unknown>;
/** Equality filter on payload fields (AND). */
export type PayloadFilter = Record<string, string | number | boolean>;

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: Payload;
}

export interface ScoredPoint {
  id: string;
  score: number;
  payload: Payload;
}

export interface VectorStore {
  readonly kind: string;
  /** Creates the collection if missing; throws if it exists with different dimensions. */
  ensureCollection(name: string, dimensions: number, indexFields?: Record<string, "keyword" | "integer">): Promise<void>;
  upsert(name: string, points: VectorPoint[]): Promise<void>;
  search(name: string, vector: number[], options: { limit: number; filter?: PayloadFilter; minScore?: number }): Promise<ScoredPoint[]>;
  scroll(name: string, options: { filter?: PayloadFilter; limit: number }): Promise<{ id: string; payload: Payload }[]>;
  delete(name: string, selector: { ids: string[] } | { filter: PayloadFilter }): Promise<void>;
  count(name: string, filter?: PayloadFilter): Promise<number>;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

function matches(payload: Payload, filter?: PayloadFilter): boolean {
  if (filter === undefined) return true;
  return Object.entries(filter).every(([k, v]) => payload[k] === v);
}

/** Process-local vector store (exact cosine search). Contents are lost on exit. */
export class InMemoryVectorStore implements VectorStore {
  readonly kind = "memory";
  readonly #collections = new Map<string, { dimensions: number; points: Map<string, VectorPoint> }>();

  #get(name: string) {
    const c = this.#collections.get(name);
    if (c === undefined) throw new Error(`Collection ${name} does not exist`);
    return c;
  }

  async ensureCollection(name: string, dimensions: number): Promise<void> {
    const existing = this.#collections.get(name);
    if (existing !== undefined && existing.dimensions !== dimensions) {
      throw new Error(`Collection ${name} has ${existing.dimensions} dimensions, embeddings produce ${dimensions}`);
    }
    if (existing === undefined) this.#collections.set(name, { dimensions, points: new Map() });
  }

  async upsert(name: string, points: VectorPoint[]): Promise<void> {
    const c = this.#get(name);
    for (const p of points) {
      if (p.vector.length !== c.dimensions) throw new Error(`Vector has ${p.vector.length} dimensions, expected ${c.dimensions}`);
      c.points.set(p.id, { ...p, payload: { ...p.payload } });
    }
  }

  async search(name: string, vector: number[], options: { limit: number; filter?: PayloadFilter; minScore?: number }): Promise<ScoredPoint[]> {
    return [...this.#get(name).points.values()]
      .filter((p) => matches(p.payload, options.filter))
      .map((p) => ({ id: p.id, score: cosine(vector, p.vector), payload: { ...p.payload } }))
      .filter((p) => options.minScore === undefined || p.score >= options.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit);
  }

  async scroll(name: string, options: { filter?: PayloadFilter; limit: number }): Promise<{ id: string; payload: Payload }[]> {
    return [...this.#get(name).points.values()]
      .filter((p) => matches(p.payload, options.filter))
      .slice(0, options.limit)
      .map((p) => ({ id: p.id, payload: { ...p.payload } }));
  }

  async delete(name: string, selector: { ids: string[] } | { filter: PayloadFilter }): Promise<void> {
    const c = this.#get(name);
    if ("ids" in selector) for (const id of selector.ids) c.points.delete(id);
    else for (const [id, p] of c.points) if (matches(p.payload, selector.filter)) c.points.delete(id);
  }

  async count(name: string, filter?: PayloadFilter): Promise<number> {
    return [...this.#get(name).points.values()].filter((p) => matches(p.payload, filter)).length;
  }
}
