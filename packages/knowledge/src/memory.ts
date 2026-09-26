import { randomUUID } from "node:crypto";
import type { Session } from "@entrogic-net/session";
import type { Embedder } from "./embeddings.js";
import type { VectorStore } from "./vector-store.js";

export interface MemoryRecord {
  id: string;
  ownerId: string;
  text: string;
  createdAt: string;
  sessionId?: string;
  score?: number;
}

export class MemoryLimitError extends Error {
  constructor(max: number) {
    super(`Memory limit reached (${max} memories); forget something first`);
    this.name = "MemoryLimitError";
  }
}

/**
 * Who a memory belongs to:
 * - gateway sessions → the API user
 * - channel sessions → the channel conversation (Telegram chat, WhatsApp number), stable across /new
 * - CLI → one local owner
 */
export function memoryOwner(session: Session): string {
  if (session.userId !== undefined) return ownerForUser(session.userId);
  if (session.channel === "cli") return "cli:local";
  if (session.externalId !== undefined) return `${session.channel}:${session.externalId}`;
  return `session:${session.id}`;
}

/** Memory owner id for a gateway API user. */
export function ownerForUser(userId: string): string {
  return `user:${userId}`;
}

const DUPLICATE_SCORE = 0.97;

/** Long-term memory (docs/07): short durable facts per owner, stored as vectors for recall. */
export class LongTermMemory {
  #ready: Promise<void> | undefined;

  constructor(
    private readonly options: { store: VectorStore; embedder: Embedder; collection: string; maxPerOwner: number },
  ) {}

  init(): Promise<void> {
    this.#ready ??= (async () => {
      const [probe] = await this.options.embedder.embed(["dimension probe"]);
      await this.options.store.ensureCollection(this.options.collection, probe?.length ?? 0, { ownerId: "keyword" });
    })().catch((error: unknown) => {
      this.#ready = undefined;
      throw error;
    });
    return this.#ready;
  }

  /** Stores a fact; returns the existing memory instead when an almost identical one exists. */
  async remember(ownerId: string, text: string, sessionId?: string): Promise<{ memory: MemoryRecord; duplicate: boolean }> {
    await this.init();
    const { store, embedder, collection, maxPerOwner } = this.options;
    const [vector] = await embedder.embed([text]);
    const [nearest] = await store.search(collection, vector ?? [], { limit: 1, filter: { ownerId }, minScore: DUPLICATE_SCORE });
    if (nearest !== undefined) return { memory: toRecord(nearest.id, nearest.payload), duplicate: true };
    if ((await store.count(collection, { ownerId })) >= maxPerOwner) throw new MemoryLimitError(maxPerOwner);

    const memory: MemoryRecord = { id: randomUUID(), ownerId, text, createdAt: new Date().toISOString(), ...(sessionId !== undefined && { sessionId }) };
    await store.upsert(collection, [{ id: memory.id, vector: vector ?? [], payload: { ...memory } }]);
    return { memory, duplicate: false };
  }

  async recall(ownerId: string, query: string, limit: number, minScore = 0.2): Promise<MemoryRecord[]> {
    await this.init();
    const [vector] = await this.options.embedder.embed([query]);
    const hits = await this.options.store.search(this.options.collection, vector ?? [], { limit, filter: { ownerId }, minScore });
    return hits.map((h) => ({ ...toRecord(h.id, h.payload), score: Math.round(h.score * 1000) / 1000 }));
  }

  async list(ownerId: string, limit = 100): Promise<MemoryRecord[]> {
    await this.init();
    const points = await this.options.store.scroll(this.options.collection, { filter: { ownerId }, limit });
    return points.map((p) => toRecord(p.id, p.payload)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Deletes one of the owner's memories. Returns false for unknown ids or other owners' memories. */
  async forget(ownerId: string, id: string): Promise<boolean> {
    await this.init();
    const owned = (await this.list(ownerId, 10_000)).some((m) => m.id === id);
    if (!owned) return false;
    await this.options.store.delete(this.options.collection, { ids: [id] });
    return true;
  }

  async count(ownerId: string): Promise<number> {
    await this.init();
    return this.options.store.count(this.options.collection, { ownerId });
  }
}

function toRecord(id: string, p: Record<string, unknown>): MemoryRecord {
  return {
    id,
    ownerId: String(p.ownerId),
    text: String(p.text),
    createdAt: String(p.createdAt),
    ...(typeof p.sessionId === "string" && { sessionId: p.sessionId }),
  };
}
