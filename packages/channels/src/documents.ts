import type { Session } from "@entrogic-net/session";

/** A file sent in a chat (Telegram document, WhatsApp document, Messenger file). */
export interface InboundDocument {
  /** Name as sent by the user; untrusted. */
  filename: string;
  mimeType?: string;
  /** Size reported by the platform, when it does; checked before downloading. */
  sizeBytes?: number;
  download(): Promise<Uint8Array>;
}

/** Why a document was refused: shown to the user as a notice. */
export class DocumentRejected extends Error {
  constructor(
    readonly reason: "unsupported" | "tooLarge",
    message: string,
  ) {
    super(message);
    this.name = "DocumentRejected";
  }
}

/** Stores documents from chats (the CLI wires one that writes to the workspace, docs/24). */
export interface DocumentHandler {
  /** Largest download accepted, in bytes. */
  maxBytes: number;
  /** Saves the document for the session's owner; throws DocumentRejected for files it won't take. */
  save(session: Session, document: { filename: string; mimeType?: string; data: Uint8Array }): Promise<{ path: string; characters: number }>;
}

/** A file name safe to quote to the model: no line breaks, quotes or brackets, at most 80 characters. */
export function displayName(filename: string): string {
  const clean = filename.replace(/[\r\n"'`[\]<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return clean === "" ? "file" : clean;
}
