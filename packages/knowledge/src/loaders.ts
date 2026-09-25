import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative } from "node:path";

export const SUPPORTED_EXTENSIONS = [".txt", ".md", ".markdown", ".html", ".htm", ".pdf"] as const;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

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
