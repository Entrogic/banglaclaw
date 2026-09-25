import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative } from "node:path";
import { docxToText } from "./docx.js";
import type { FetchLike } from "./embeddings.js";

export const SUPPORTED_EXTENSIONS = [".txt", ".md", ".markdown", ".html", ".htm", ".pdf", ".docx"] as const;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_URL_BYTES = 10 * 1024 * 1024;
const URL_TIMEOUT_MS = 20_000;

export interface LoadedDocument {
  /** Stable source id: path relative to the base directory. */
  source: string;
  title: string;
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function htmlToText(html: string): { title?: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const text = html
    .replace(/<(head|script|style|noscript|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|br)\s*>|<br\s*\/?>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e.startsWith("#x") || e.startsWith("#X")) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
  return title !== undefined && title !== "" ? { title, text } : { text };
}

async function pdfToText(data: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join("\n\n");
}

/** Source id for a file: relative to baseDir when inside it, otherwise the absolute path. */
export function sourceName(path: string, baseDir: string): string {
  const rel = relative(baseDir, path);
  return rel === "" ? basename(path) : rel.startsWith("..") || isAbsolute(rel) ? path : rel;
}

/** Loads one supported file as plain text. */
export async function loadFile(path: string, baseDir: string): Promise<LoadedDocument> {
  const info = await stat(path);
  if (info.size > MAX_FILE_BYTES) throw new Error(`${path} is larger than 20 MB`);
  const ext = extname(path).toLowerCase();
  const source = sourceName(path, baseDir);
  const fallbackTitle = basename(path, ext);

  if (ext === ".pdf") return { source, title: fallbackTitle, text: await pdfToText(new Uint8Array(await readFile(path))) };
  if (ext === ".docx") {
    const { title, text } = docxToText(new Uint8Array(await readFile(path)));
    return { source, title: title ?? fallbackTitle, text };
  }
  const raw = await readFile(path, "utf8");
  if (ext === ".html" || ext === ".htm") {
    const { title, text } = htmlToText(raw);
    return { source, title: title ?? fallbackTitle, text };
  }
  if (ext === ".md" || ext === ".markdown") {
    const heading = /^#\s+(.+)$/m.exec(raw)?.[1]?.trim();
    return { source, title: heading ?? fallbackTitle, text: raw };
  }
  if (ext === ".txt") return { source, title: fallbackTitle, text: raw };
  throw new Error(`Unsupported file type ${ext} (supported: ${SUPPORTED_EXTENSIONS.join(", ")})`);
}

/** Recursively lists supported files under the given files/directories (skips dotfiles and node_modules). */
export async function collectFiles(paths: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  const visit = async (p: string): Promise<void> => {
    const info = await stat(p);
    if (info.isDirectory()) {
      for (const entry of (await readdir(p)).sort()) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        await visit(join(p, entry));
      }
    } else if ((SUPPORTED_EXTENSIONS as readonly string[]).includes(extname(p).toLowerCase())) {
      out.push(p);
    }
  };
  for (const p of paths) await visit(p);
  return out;
}

/** True for http(s) URLs in knowledge.sources or `kb ingest` arguments. */
export function isUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Downloads one web page or document (HTML, plain text/markdown, PDF, DOCX) as plain text. The
 * source id is the URL without its fragment. URLs come from the operator's config or CLI, never
 * from the model; they are still limited to http(s), 10 MB and 20 seconds.
 */
export async function loadUrl(url: string, fetchImpl: FetchLike = (input, init) => fetch(input, init)): Promise<LoadedDocument> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`Only http(s) URLs can be ingested: ${url}`);
  parsed.hash = "";
  const source = parsed.toString();
  const res = await fetchImpl(source, { headers: { Accept: "text/html, text/plain, text/markdown, application/pdf, " + DOCX_TYPE + ";q=0.9, */*;q=0.1" }, signal: AbortSignal.timeout(URL_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${source} returned HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_URL_BYTES) throw new Error(`${source} is larger than 10 MB`);
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength > MAX_URL_BYTES) throw new Error(`${source} is larger than 10 MB`);

  const type = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const path = decodeURIComponent(parsed.pathname);
  const ext = extname(path).toLowerCase();
  const fallbackTitle = basename(path, ext) || parsed.hostname;
  if (type === "application/pdf" || (type === "application/octet-stream" && ext === ".pdf")) return { source, title: fallbackTitle, text: await pdfToText(body) };
  if (type === DOCX_TYPE || (type === "application/octet-stream" && ext === ".docx")) {
    const { title, text } = docxToText(body);
    return { source, title: title ?? fallbackTitle, text };
  }
  const raw = new TextDecoder().decode(body);
  if (type === "text/html" || type === "application/xhtml+xml") {
    const { title, text } = htmlToText(raw);
    return { source, title: title ?? fallbackTitle, text };
  }
  if (type.startsWith("text/")) {
    const heading = type === "text/markdown" ? /^#\s+(.+)$/m.exec(raw)?.[1]?.trim() : undefined;
    return { source, title: heading ?? fallbackTitle, text: raw };
  }
  throw new Error(`${source} has unsupported content type ${type || "(none)"}`);
}
