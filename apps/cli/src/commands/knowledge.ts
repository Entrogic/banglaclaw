import { resolve } from "node:path";
import { isUrl } from "@banglaclaw/knowledge";
import { BanglaClawError } from "@banglaclaw/shared";
import type { GlobalOptions } from "../bootstrap.js";
import { emit, empty, print, success } from "../ui/output.js";
import { withSpinner } from "../ui/spinner.js";
import { table } from "../ui/table.js";
import { c, sym } from "../ui/theme.js";
import { limit, openKnowledge, prepareKnowledge, requireKb, requireMemory } from "./shared.js";

export async function kbIngest(paths: string[], options: GlobalOptions): Promise<void> {
  const { knowledge, loaded } = openKnowledge(options);
  const kb = requireKb(knowledge);
  if (knowledge.vectorStore === "memory") {
    throw new BanglaClawError("PERSISTENT_STORE_REQUIRED", "knowledge.vectorStore is memory, so ingested documents would vanish on exit (list them under knowledge.sources instead)");
  }
  // Paths are typed relative to the shell's cwd; sources are named relative to the config file like knowledge.sources. URLs pass through.
  const result = await withSpinner("Ingesting documents…", () => kb.ingestPaths(paths.map((p) => (isUrl(p) ? p : resolve(p))), loaded.baseDir), {
    done: (r) => `Processed ${r.results.length + r.errors.length} sources`,
  });
  emit(result, ({ results, errors }) => {
    for (const r of results) print(`${r.skipped ? c.dim("= unchanged") : c.green("+ ingested ")} ${r.source} ${c.dim(`(${r.chunks} chunks)`)}`);
    for (const e of errors) print(c.red(`${sym.fail} ${e.path}: ${e.error}`));
    if (results.length === 0 && errors.length === 0) empty("No supported files found (.txt .md .html .pdf .docx) or URLs.");
  });
  if (result.errors.length > 0) process.exitCode = 1;
}

export async function kbList(options: GlobalOptions): Promise<void> {
  const { knowledge } = openKnowledge(options);
  const kb = requireKb(knowledge);
  if (knowledge.vectorStore === "memory") await prepareKnowledge(knowledge, false);
  const docs = await kb.listDocuments();
  emit(docs, (list) =>
    list.length === 0
      ? empty("No documents.")
      : print(
          table(list, [
            { header: "SOURCE", value: (d) => d.source, color: (t) => c.bold(t), shrink: true },
            { header: "TITLE", value: (d) => (d.title !== d.source ? d.title : ""), shrink: true },
            { header: "CHUNKS", value: (d) => String(d.chunkCount), align: "right" },
            { header: "INGESTED", value: (d) => d.ingestedAt, color: (t) => c.dim(t) },
          ]),
        ),
  );
}

export async function kbSearch(query: string, options: GlobalOptions & { limit: string }): Promise<void> {
  const { knowledge, loaded } = openKnowledge(options);
  const kb = requireKb(knowledge);
  if (knowledge.vectorStore === "memory") await prepareKnowledge(knowledge, false);
  const hits = await withSpinner("Searching…", () => kb.search(query, { limit: limit(options.limit), minScore: loaded.config.knowledge.minScore }), { done: (h) => `${h.length} matches` });
  emit(hits, (list) => {
    if (list.length === 0) return empty("No matches.");
    for (const h of list) {
      print(`${c.bold(`${h.source}#${h.chunkIndex}`)} ${c.dim(`score ${h.score}`)}`);
      print(`  ${h.text.slice(0, 300).replace(/\s+/g, " ")}${h.text.length > 300 ? "…" : ""}`);
      print();
    }
  });
}

export async function kbDelete(source: string, options: GlobalOptions): Promise<void> {
  const { knowledge } = openKnowledge(options);
  if (!(await requireKb(knowledge).deleteDocument(source))) throw new BanglaClawError("DOCUMENT_NOT_FOUND", `No document ${source}`);
  emit({ deleted: source }, () => success(`Deleted ${source}`));
}

export async function memoryList(options: GlobalOptions & { owner: string }): Promise<void> {
  const memory = requireMemory(openKnowledge(options).knowledge);
  const items = await memory.list(options.owner);
  emit(items, (list) =>
    list.length === 0
      ? empty(`No memories for ${options.owner}.`)
      : print(
          table(list, [
            { header: "ID", value: (m) => m.id, color: (t) => c.dim(t) },
            { header: "MEMORY", value: (m) => m.text, shrink: true },
            { header: "CREATED", value: (m) => m.createdAt, color: (t) => c.dim(t) },
          ]),
        ),
  );
}

export async function memoryForget(id: string, options: GlobalOptions & { owner: string }): Promise<void> {
  const memory = requireMemory(openKnowledge(options).knowledge);
  if (!(await memory.forget(options.owner, id))) throw new BanglaClawError("MEMORY_NOT_FOUND", `No memory ${id} for ${options.owner}`);
  emit({ forgotten: id }, () => success(`Forgot ${id}`));
}
