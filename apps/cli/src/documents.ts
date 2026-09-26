import { extname } from "node:path";
import { DocumentRejected, type DocumentHandler } from "@entrogic-net/channels";
import { TEXT_EXTENSIONS, extractText } from "@entrogic-net/knowledge";
import { sessionOwner } from "@entrogic-net/session";
import type { LoadedConfig } from "@entrogic-net/shared";
import { WorkspaceError, type Workspace } from "@entrogic-net/workspace";
import { openWorkspace } from "./workspace.js";

/** Formats saved as-is; everything else is stored as its extracted text (name.txt). */
const KEEP_AS_IS = new Set([".txt", ".md", ".markdown", ".csv", ".json"]);

/** A workspace-safe file name: letters (Bangla too), digits, "._-"; spaces become "_"; no leading dot. */
export function uploadName(filename: string): string {
  const cleaned = filename
    .normalize("NFC")
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{M}\p{N}._-]/gu, "")
    .replace(/^[.]+/, "")
    .slice(-100);
  return cleaned === "" || cleaned.startsWith(".") ? "document" : cleaned;
}

/**
 * Saves files sent in chats to the sender's workspace under `uploads/` (docs/24): text formats
 * as they are, PDF/DOCX/HTML as extracted text. The owner comes from the session. Name clashes
 * get "-2", "-3"… so nothing is overwritten.
 */
export function createDocumentSaver(workspace: Workspace, maxBytes: number): DocumentHandler {
  return {
    maxBytes,
    async save(session, document) {
      const safe = uploadName(document.filename);
      const ext = extname(safe).toLowerCase();
      if (!(TEXT_EXTENSIONS as readonly string[]).includes(ext)) throw new DocumentRejected("unsupported", `Unsupported file type ${ext || "(none)"}`);
      let text: string;
      try {
        text = (await extractText(document.data, safe)).text;
      } catch (error) {
        throw new DocumentRejected("unsupported", error instanceof Error ? error.message : String(error));
      }
      if (text.includes("\0")) throw new DocumentRejected("unsupported", "Not a text document");
      const base = KEEP_AS_IS.has(ext) ? safe : `${safe.slice(0, safe.length - ext.length)}.txt`;
      const baseExt = extname(base);
      const stem = base.slice(0, base.length - baseExt.length);
      const owner = sessionOwner(session);
      for (let n = 1; n <= 50; n++) {
        const path = `uploads/${n === 1 ? base : `${stem}-${n}${baseExt}`}`;
        try {
          await workspace.create(owner, path, text);
          return { path, characters: [...text].length };
        } catch (error) {
          if (error instanceof WorkspaceError && error.message.includes("already exists")) continue;
          if (error instanceof WorkspaceError && /limit is|full|files \(limit/.test(error.message)) throw new DocumentRejected("tooLarge", error.message);
          throw error;
        }
      }
      throw new DocumentRejected("tooLarge", "Too many files with this name");
    },
  };
}

/** The saver for chat uploads, when the workspace and uploads are on and the channel may use the workspace. */
export function documentHandlerFor(loaded: LoadedConfig, channel: string): DocumentHandler | undefined {
  const { uploads, channels, maxUploadBytes } = loaded.config.workspace;
  if (!uploads || !channels.includes(channel)) return undefined;
  const workspace = openWorkspace(loaded);
  return workspace === undefined ? undefined : createDocumentSaver(workspace, maxUploadBytes);
}
