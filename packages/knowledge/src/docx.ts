import { inflateRawSync } from "node:zlib";

/** Largest uncompressed entry we inflate (zip-bomb guard). */
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;

/** Reads one file from a zip archive (stored or deflated entries; no zip64 or encryption). */
export function readZipEntry(zip: Uint8Array, name: string): Uint8Array | undefined {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // End of central directory: 22 bytes plus an optional comment of up to 65535 bytes.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a zip archive");
  const entries = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let n = 0; n < entries; n++) {
    if (p + 46 > zip.length || view.getUint32(p, true) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const entryName = decoder.decode(zip.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extraLength + commentLength;
    if (entryName !== name) continue;

    if ((flags & 0x1) !== 0) throw new Error("encrypted documents are not supported");
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error("zip64 documents are not supported");
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("corrupt zip entry");
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const data = zip.subarray(start, start + compressedSize);
    if (method === 0) return data;
    if (method === 8) {
      try {
        return new Uint8Array(inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }));
      } catch (error) {
        if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new Error(`${name} is larger than 50 MB uncompressed`);
        throw error;
      }
    }
    throw new Error(`unsupported zip compression method ${method}`);
  }
  return undefined;
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e.startsWith("#x") || e.startsWith("#X")) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return XML_ENTITIES[e] ?? m;
  });
}

function paragraphTexts(xml: string): string[] {
  const out: string[] = [];
  for (const [paragraph] of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    let line = "";
    for (const token of paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g)) {
      if (token[1] !== undefined) line += decodeXml(token[1]);
      else line += token[2] === "tab" ? "\t" : "\n";
    }
    out.push(line.trim());
  }
  return out;
}

const encodeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Paragraph text from WordprocessingML: runs (w:t), tabs and breaks, with one blank line between
 * paragraphs. Each table row becomes one line with its cells joined by " | ", so a price stays
 * next to its item when the text is chunked.
 */
export function wordXmlToText(xml: string): string {
  const rows = xml.replace(/<w:tr[ >][\s\S]*?<\/w:tr>/g, (row) => {
    const cells = [...row.matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)].map(([cell]) => paragraphTexts(cell).filter((t) => t !== "").join(" "));
    return `<w:p><w:r><w:t>${encodeXml(cells.join(" | "))}</w:t></w:r></w:p>`;
  });
  return paragraphTexts(rows)
    .filter((p) => p !== "")
    .join("\n\n");
}

/** Text and (when set) title of a .docx file. */
export function docxToText(data: Uint8Array): { title?: string; text: string } {
  const document = readZipEntry(data, "word/document.xml");
  if (document === undefined) throw new Error("not a Word document (word/document.xml missing)");
  const text = wordXmlToText(new TextDecoder().decode(document));
  const core = readZipEntry(data, "docProps/core.xml");
  const title = core === undefined ? undefined : /<dc:title>([\s\S]*?)<\/dc:title>/.exec(new TextDecoder().decode(core))?.[1];
  const cleanTitle = title === undefined ? undefined : decodeXml(title).trim();
  return cleanTitle !== undefined && cleanTitle !== "" ? { title: cleanTitle, text } : { text };
}
