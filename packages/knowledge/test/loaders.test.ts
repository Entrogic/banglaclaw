import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HashEmbedder, InMemoryVectorStore, KnowledgeBase, docxToText, loadFile, loadUrl, readZipEntry, wordXmlToText } from "../src/index.js";
import { makeDocx, makeZip } from "./docx.js";
import { makePdf } from "./pdf.js";

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** fetch stub serving `routes` by URL. */
function server(routes: Record<string, { type: string; body: string | Uint8Array; status?: number }>) {
  const requested: string[] = [];
  const fetchImpl = async (url: string) => {
    requested.push(url);
    const route = routes[url];
    if (route === undefined) return new Response("not found", { status: 404 });
    return new Response(route.body, { status: route.status ?? 200, headers: { "Content-Type": route.type } });
  };
  return { fetchImpl, requested };
}

describe("docx loader", () => {
  it("extracts Bangla paragraphs, tabs, line breaks, entities and the title", () => {
    const docx = makeDocx(["ফেরত নীতি", "পণ্য হাতে পাওয়ার ৭ দিনের মধ্যে\tফেরত দেওয়া যায়।", "প্রথম লাইন\nদ্বিতীয় লাইন", "Terms & <conditions>"], { title: "নীতিমালা" });
    expect(docxToText(docx)).toEqual({
      title: "নীতিমালা",
      text: "ফেরত নীতি\n\nপণ্য হাতে পাওয়ার ৭ দিনের মধ্যে\tফেরত দেওয়া যায়।\n\nপ্রথম লাইন\nদ্বিতীয় লাইন\n\nTerms & <conditions>",
    });
  });

  it("keeps each table row on one line", () => {
    const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
    const row = (...cells: string[]) => `<w:tr>${cells.map(cell).join("")}</w:tr>`;
    const xml = `<w:document><w:body><w:p><w:r><w:t>ডেলিভারি চার্জ</w:t></w:r></w:p><w:tbl>${row("এলাকা", "চার্জ")}${row("ঢাকা", "৳৬০")}${row("ঢাকার বাইরে", "৳১২০")}</w:tbl></w:body></w:document>`;
    expect(wordXmlToText(xml)).toBe("ডেলিভারি চার্জ\n\nএলাকা | চার্জ\n\nঢাকা | ৳৬০\n\nঢাকার বাইরে | ৳১২০");
  });

  it("reads stored entries and rejects files that are not Word documents", () => {
    expect(docxToText(makeDocx(["stored"], { method: 0 })).text).toBe("stored");
    expect(() => docxToText(new TextEncoder().encode("plain text, not a zip"))).toThrow("not a zip archive");
    expect(() => docxToText(makeZip({ "hello.txt": "hi" }))).toThrow("word/document.xml missing");
    expect(readZipEntry(makeZip({ "a.txt": "A", "b.txt": "B" }), "b.txt")).toEqual(new TextEncoder().encode("B"));
  });

  it("refuses entries that inflate past 50 MB (zip bomb)", () => {
    const bomb = makeZip({ "word/document.xml": "\0".repeat(60 * 1024 * 1024) });
    expect(bomb.byteLength).toBeLessThan(200_000);
    expect(() => docxToText(bomb)).toThrow("word/document.xml is larger than 50 MB uncompressed");
  });

  it("loads .docx files from disk with the file name as fallback title", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bc-docx-"));
    writeFileSync(join(dir, "delivery.docx"), makeDocx(["ঢাকার ভেতরে ডেলিভারি চার্জ ৬০ টাকা।"]));
    expect(await loadFile(join(dir, "delivery.docx"), dir)).toEqual({ source: "delivery.docx", title: "delivery", text: "ঢাকার ভেতরে ডেলিভারি চার্জ ৬০ টাকা।" });
  });
});

describe("URL loader", () => {
  it("loads HTML, text, markdown, PDF and DOCX by content type", async () => {
    const { fetchImpl } = server({
      "https://shop.test/faq": { type: "text/html; charset=utf-8", body: "<html><head><title>FAQ</title><script>x()</script></head><body><h1>প্রশ্ন</h1><p>ফেরত ৭ দিনে।</p></body></html>" },
      "https://shop.test/notes.txt": { type: "text/plain", body: "plain notes" },
      "https://shop.test/guide.md": { type: "text/markdown", body: "# Guide\n\nSteps" },
      "https://shop.test/policy.pdf": { type: "application/pdf", body: makePdf("Refund policy") },
      "https://shop.test/terms.docx": { type: DOCX_TYPE, body: makeDocx(["শর্তাবলি"], { title: "Terms" }) },
    });
    expect(await loadUrl("https://shop.test/faq#top", fetchImpl)).toEqual({ source: "https://shop.test/faq", title: "FAQ", text: "প্রশ্ন\n\nফেরত ৭ দিনে।" });
    expect(await loadUrl("https://shop.test/notes.txt", fetchImpl)).toMatchObject({ title: "notes", text: "plain notes" });
    expect(await loadUrl("https://shop.test/guide.md", fetchImpl)).toMatchObject({ title: "Guide" });
    expect((await loadUrl("https://shop.test/policy.pdf", fetchImpl)).text).toContain("Refund policy");
    expect(await loadUrl("https://shop.test/terms.docx", fetchImpl)).toMatchObject({ title: "Terms", text: "শর্তাবলি" });
  });

  it("rejects bad schemes, HTTP errors, unsupported types and oversized bodies", async () => {
    const { fetchImpl, requested } = server({
      "https://shop.test/logo.png": { type: "image/png", body: "png" },
      "https://shop.test/huge": { type: "text/plain", body: "x".repeat(10 * 1024 * 1024 + 1) },
    });
    await expect(loadUrl("file:///etc/passwd", fetchImpl)).rejects.toThrow("Only http(s) URLs");
    await expect(loadUrl("https://shop.test/missing", fetchImpl)).rejects.toThrow("HTTP 404");
    await expect(loadUrl("https://shop.test/logo.png", fetchImpl)).rejects.toThrow("unsupported content type image/png");
    await expect(loadUrl("https://shop.test/huge", fetchImpl)).rejects.toThrow("larger than 10 MB");
    expect(requested).not.toContain("file:///etc/passwd");
  });

  it("ingests URLs alongside files, named by address, skipping unchanged content", async () => {
    const { fetchImpl } = server({ "https://shop.test/faq": { type: "text/html", body: "<title>FAQ</title><p>ফেরত নীতি: ৭ দিনের মধ্যে ফেরত।</p>" } });
    const kb = new KnowledgeBase({ store: new InMemoryVectorStore(), embedder: new HashEmbedder(), collection: "t", chunkSize: 500, chunkOverlap: 50, fetch: fetchImpl });
    const dir = mkdtempSync(join(tmpdir(), "bc-kb-"));
    writeFileSync(join(dir, "terms.docx"), makeDocx(["শর্তাবলি প্রযোজ্য।"]));

    const first = await kb.ingestPaths(["terms.docx", "https://shop.test/faq", "https://shop.test/gone"], dir);
    expect(first.results.map((r) => [r.source, r.skipped])).toEqual([["terms.docx", false], ["https://shop.test/faq", false]]);
    expect(first.errors).toEqual([{ path: "https://shop.test/gone", error: "https://shop.test/gone returned HTTP 404" }]);
    expect((await kb.listDocuments()).map((d) => d.source).sort()).toEqual(["https://shop.test/faq", "terms.docx"]);
    const [hit] = await kb.search("ফেরত নীতি", { limit: 1 });
    expect(hit?.source).toBe("https://shop.test/faq");

    const again = await kb.ingestPaths(["https://shop.test/faq"], dir);
    expect(again.results[0]?.skipped).toBe(true);
  });
});
