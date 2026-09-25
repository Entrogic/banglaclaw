import { crc32, deflateRawSync } from "node:zlib";

/** Builds a zip archive (deflated or stored entries) — test fixture for .docx files. */
export function makeZip(files: Record<string, string>, method: 0 | 8 = 8): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const raw = Buffer.from(content);
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, centralDir, eocd]));
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** A minimal .docx with the given paragraphs (each may contain \t or \n) and an optional title. */
export function makeDocx(paragraphs: string[], options: { title?: string; method?: 0 | 8 } = {}): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const run = (text: string) =>
    text
      .split(/(\t|\n)/)
      .map((part) => (part === "\t" ? "<w:tab/>" : part === "\n" ? "<w:br/>" : part === "" ? "" : `<w:t xml:space="preserve">${esc(part)}</w:t>`))
      .join("");
  const body = paragraphs.map((p) => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r>${run(p)}</w:r></w:p>`).join("");
  const files: Record<string, string> = {
    "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}<w:p/><w:sectPr/></w:body></w:document>`,
  };
  if (options.title !== undefined) {
    files["docProps/core.xml"] = `<?xml version="1.0"?><cp:coreProperties xmlns:cp="c" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(options.title)}</dc:title></cp:coreProperties>`;
  }
  return makeZip(files, options.method ?? 8);
}
