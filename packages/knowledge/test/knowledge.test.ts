import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HashEmbedder, InMemoryVectorStore, KnowledgeBase, OpenAICompatibleEmbedder, chunkText, collectFiles, htmlToText, loadFile, stableUuid,
} from "../src/index.js";
import { makePdf } from "./pdf.js";

describe("chunkText", () => {
  it("splits on Bangla and Latin sentence ends within the size limit", () => {
    const text = "ঢাকা বাংলাদেশের রাজধানী। চট্টগ্রাম বন্দর নগরী। সিলেট চায়ের জন্য বিখ্যাত।\n\nDhaka is big. Sylhet has tea.";
    const chunks = chunkText(text, { chunkSize: 60, chunkOverlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(60);
    expect(chunks[0]).toBe("ঢাকা বাংলাদেশের রাজধানী। চট্টগ্রাম বন্দর নগরী।");
  });

  it("carries overlap and hard-splits very long words", () => {
    const sentences = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const chunks = chunkText(sentences, { chunkSize: 120, chunkOverlap: 40 });
    expect(chunks.length).toBeGreaterThan(3);
    const lastOfFirst = chunks[0]?.split(". ").at(-1)?.replace(/\.$/, "");
    expect(chunks[1]).toContain(lastOfFirst);
    expect(chunkText("x".repeat(500), { chunkSize: 200, chunkOverlap: 0 }).map((c) => c.length)).toEqual([200, 200, 100]);
    expect(chunkText("   \n\n  ", { chunkSize: 200, chunkOverlap: 0 })).toEqual([]);
  });
});

describe("loaders", () => {
  it("extracts text and titles from html, markdown, text and pdf", async () => {
    expect(htmlToText("<html><head><title>দাম</title><style>p{}</style></head><body><p>চা &amp; কফি</p><script>x()</script><p>&#2437;</p></body></html>")).toEqual({
      title: "দাম",
      text: "চা & কফি\n\nঅ",
    });
    const dir = mkdtempSync(join(tmpdir(), "banglaclaw-kb-"));
    mkdirSync(join(dir, "docs/.hidden"), { recursive: true });
    writeFileSync(join(dir, "docs/faq.md"), "# FAQ\n\nDelivery takes 3 days.");
    writeFileSync(join(dir, "docs/notes.txt"), "plain");
    writeFileSync(join(dir, "docs/ignored.docx"), "x");
    writeFileSync(join(dir, "docs/.hidden/secret.md"), "x");
    writeFileSync(join(dir, "docs/guide.pdf"), makePdf("Return policy: 7 days"));
    const files = await collectFiles([join(dir, "docs")]);
    expect(files.map((f) => f.slice(dir.length + 1))).toEqual(["docs/faq.md", "docs/guide.pdf", "docs/notes.txt"]);
    expect(await loadFile(join(dir, "docs/faq.md"), dir)).toEqual({ source: "docs/faq.md", title: "FAQ", text: "# FAQ\n\nDelivery takes 3 days." });
    const pdf = await loadFile(join(dir, "docs/guide.pdf"), dir);
    expect(pdf.text).toContain("Return policy: 7 days");
  });
});

describe("OpenAICompatibleEmbedder", () => {
  it("batches requests, keeps order and sends dimensions", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchFn = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      bodies.push(body);
      const data = body.input.map((t, index) => ({ index, embedding: [t.length, index] })).reverse();
      return new Response(JSON.stringify({ data }), { status: 200 });
    };
    const e = new OpenAICompatibleEmbedder({ model: "m", apiKey: "k", dimensions: 2, batchSize: 2, fetch: fetchFn });
    expect(await e.embed(["a", "bb", "ccc"])).toEqual([[1, 0], [2, 1], [3, 0]]);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ model: "m", dimensions: 2, input: ["a", "bb"] });
  });

  it("requires a key or base URL and reports API errors", async () => {
    expect(() => new OpenAICompatibleEmbedder({ model: "m" })).toThrow(/OPENAI_API_KEY/);
    const failing = new OpenAICompatibleEmbedder({ model: "m", baseUrl: "http://local/v1", fetch: async () => new Response(JSON.stringify({ error: { message: "bad model" } }), { status: 400 }) });
    await expect(failing.embed(["x"])).rejects.toThrow(/400.*bad model/);
  });
});

describe("KnowledgeBase", () => {
  function kb() {
    return new KnowledgeBase({ store: new InMemoryVectorStore(), embedder: new HashEmbedder(), collection: "kb", chunkSize: 200, chunkOverlap: 20 });
  }

  it("ingests, searches with citations, skips unchanged content and replaces changed content", async () => {
    const base = kb();
    const first = await base.ingestText({ source: "faq.md", title: "FAQ", text: "ডেলিভারি চার্জ ঢাকার ভিতরে ৬০ টাকা।\n\nReturns are accepted within 7 days." });
    expect(first).toMatchObject({ source: "faq.md", skipped: false, chunks: 1 });
    await base.ingestText({ source: "about.md", text: "BanglaClaw is an agent runtime written in TypeScript." });

    const hits = await base.search("ঢাকার ডেলিভারি চার্জ কত?", { limit: 2 });
    expect(hits[0]).toMatchObject({ source: "faq.md", title: "FAQ", chunkIndex: 0 });
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0);

    expect(await base.ingestText({ source: "faq.md", title: "FAQ", text: "ডেলিভারি চার্জ ঢাকার ভিতরে ৬০ টাকা।\n\nReturns are accepted within 7 days." })).toMatchObject({ skipped: true });
    const long = Array.from({ length: 10 }, (_, i) => `Policy line ${i} explains delivery rules.`).join(" ");
    expect((await base.ingestText({ source: "faq.md", text: long })).chunks).toBeGreaterThan(1);
    const docs = await base.listDocuments();
    expect(docs.map((d) => [d.source, d.chunkCount > 1])).toEqual([["about.md", false], ["faq.md", true]]);
    expect(await base.deleteDocument("faq.md")).toBe(true);
    expect(await base.deleteDocument("faq.md")).toBe(false);
    expect((await base.listDocuments()).map((d) => d.source)).toEqual(["about.md"]);
  });

  it("ingests paths and reports per-file errors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "banglaclaw-kb-"));
    writeFileSync(join(dir, "a.md"), "# A\n\nAlpha document.");
    writeFileSync(join(dir, "empty.txt"), "   ");
    const { results, errors } = await kb().ingestPaths(["."], dir);
    expect(results.map((r) => r.source)).toEqual(["a.md"]);
    expect(errors).toEqual([{ path: join(dir, "empty.txt"), error: "no extractable text" }]);
  });

  it("uses deterministic point ids", () => {
    expect(stableUuid("x")).toBe(stableUuid("x"));
    expect(stableUuid("x")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
