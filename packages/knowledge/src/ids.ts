import { createHash } from "node:crypto";

/** Deterministic UUID (v5-style) from a name, so re-ingesting a document overwrites its points. */
export function stableUuid(name: string): string {
  const h = createHash("sha256").update(name).digest("hex");
  const variant = ((parseInt(h[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
