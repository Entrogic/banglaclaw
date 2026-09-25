import { afterAll, describe, expect, it } from "vitest";
import { HashEmbedder, KnowledgeBase, LongTermMemory, QdrantVectorStore } from "../src/index.js";

/** Runs against a real Qdrant when TEST_QDRANT_URL is set (docker/compose.yaml: http://localhost:56333). */
const url = process.env.TEST_QDRANT_URL;
const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const collections: string[] = [];

describe.skipIf(url === undefined)("QdrantVectorStore", () => {
  const store = new QdrantVectorStore({ url: url ?? "http://unused" });
  afterAll(async () => {
    for (const c of collections) await fetch(`${url}/collections/${c}`, { method: "DELETE" });
  });

  it("backs the knowledge base", async () => {
    const collection = `test_kb_${suffix}`;
    collections.push(collection);
    const kb = new KnowledgeBase({ store, embedder: new HashEmbedder(64), collection, chunkSize: 200, chunkOverlap: 0 });
    await kb.ingestText({ source: "faq.md", title: "FAQ", text: "ডেলিভারি চার্জ ঢাকার ভিতরে ৬০ টাকা।" });
    await kb.ingestText({ source: "about.md", text: "BanglaClaw is an agent runtime." });
    expect((await kb.search("ঢাকার ডেলিভারি চার্জ", { limit: 1 }))[0]).toMatchObject({ source: "faq.md", title: "FAQ" });
    expect((await kb.ingestText({ source: "faq.md", title: "FAQ", text: "ডেলিভারি চার্জ ঢাকার ভিতরে ৬০ টাকা।" })).skipped).toBe(true);
    expect((await kb.listDocuments()).map((d) => d.source)).toEqual(["about.md", "faq.md"]);
    expect(await kb.deleteDocument("about.md")).toBe(true);
    expect(await store.count(collection)).toBe(1);

    const other = new KnowledgeBase({ store, embedder: new HashEmbedder(32), collection, chunkSize: 200, chunkOverlap: 0 });
    await expect(other.init()).rejects.toThrow(/dimensions/);
  });

  it("backs long-term memory with owner filters", async () => {
    const collection = `test_mem_${suffix}`;
    collections.push(collection);
    const memory = new LongTermMemory({ store, embedder: new HashEmbedder(64), collection, maxPerOwner: 5 });
    const { memory: m } = await memory.remember("telegram:1", "User likes mango juice");
    await memory.remember("telegram:2", "User likes mango juice too");
    expect((await memory.recall("telegram:1", "mango juice", 5)).map((r) => r.id)).toEqual([m.id]);
    expect(await memory.count("telegram:1")).toBe(1);
    expect(await memory.forget("telegram:2", m.id)).toBe(false);
    expect(await memory.forget("telegram:1", m.id)).toBe(true);
    expect(await memory.list("telegram:1")).toEqual([]);
  });
});
