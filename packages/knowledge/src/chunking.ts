export interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
}

// Sentence ends: Latin punctuation and the Bangla dari (।) / double dari (॥).
const SENTENCE_END = /(?<=[.!?।॥])\s+/u;

function splitLong(text: string, max: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if (word.length > max) {
      if (current !== "") out.push(current);
      for (let i = 0; i < word.length; i += max) out.push(word.slice(i, i + max));
      current = "";
    } else if (current.length + word.length + 1 > max) {
      out.push(current);
      current = word;
    } else {
      current = current === "" ? word : `${current} ${word}`;
    }
  }
  if (current !== "") out.push(current);
  return out;
}

function tail(text: string, overlap: number): string {
  if (overlap <= 0 || text.length <= overlap) return overlap <= 0 ? "" : text;
  const slice = text.slice(-overlap);
  // Start the overlap at a sentence or word boundary when possible.
  const sentence = slice.search(SENTENCE_END);
  if (sentence !== -1 && sentence < slice.length - 20) return slice.slice(sentence).trimStart();
  const space = slice.indexOf(" ");
  return space === -1 ? slice : slice.slice(space + 1);
}

/**
 * Splits text into ~chunkSize-character chunks along paragraph and sentence boundaries
 * (Bangla-aware), with `chunkOverlap` characters of context carried into the next chunk.
 */
export function chunkText(text: string, { chunkSize, chunkOverlap }: ChunkOptions): string[] {
  const units = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter((p) => p !== "")
    .flatMap((p) => p.split(SENTENCE_END))
    .flatMap((s) => (s.length > chunkSize ? splitLong(s, chunkSize) : [s]));

  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    if (current !== "" && current.length + unit.length + 1 > chunkSize) {
      chunks.push(current);
      const carry = tail(current, Math.min(chunkOverlap, Math.floor(chunkSize / 2)));
      current = carry !== "" && carry.length + unit.length + 1 <= chunkSize ? `${carry} ${unit}` : unit;
    } else {
      current = current === "" ? unit : `${current} ${unit}`;
    }
  }
  if (current !== "") chunks.push(current);
  return chunks;
}
