import type { Context, Hono } from "hono";
import { z } from "zod";
import { ownerForUser } from "@entrogic-net/session";
import { audioFilename } from "@entrogic-net/shared";
import type { GatewayDeps, GatewayEnv } from "./context.js";
import { HttpError } from "./errors.js";

/** Largest audio accepted by POST /v1/transcriptions (the OpenAI endpoint's limit). */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
/** Paths whose bodies are checked by their own limits instead of the 256 KB /v1 default. */
export const LARGE_BODY_PATHS = new Set(["/v1/workspace/uploads", "/v1/transcriptions"]);

const pathQuery = z.string().min(1).max(200);
const restoreBody = z.strictObject({ path: pathQuery, version: z.int().min(1).optional() });

/** Reads a raw request body up to `max` bytes, or answers 413. */
async function readBody(c: Context<GatewayEnv>, max: number): Promise<Uint8Array> {
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > max) throw new HttpError(413, "payload_too_large", `Body is larger than ${max} bytes`);
  const data = new Uint8Array(await c.req.arrayBuffer());
  if (data.byteLength > max) throw new HttpError(413, "payload_too_large", `Body is larger than ${max} bytes`);
  if (data.byteLength === 0) throw new HttpError(400, "invalid_request", "Body is empty");
  return data;
}

/**
 * Workspace problems (bad path, missing file, full quota) become 400s with their message;
 * anything else is an internal error whose details (server paths) are never sent.
 */
async function workspaceCall<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof Error && (error.name === "WorkspaceError" || error.name === "DocumentRejected")) {
      const status = /does not exist|no earlier version|no version/.test(error.message) ? 404 : 400;
      throw new HttpError(status, status === 404 ? "file_not_found" : "workspace_error", error.message);
    }
    throw error;
  }
}

/**
 * /v1/workspace (the caller's own files, docs/24), /v1/transcriptions and /v1/features. The
 * owner is always the authenticated user; features that aren't configured answer 404.
 */
export function registerFileRoutes(v1: Hono<GatewayEnv>, deps: GatewayDeps): void {
  const workspace = () => {
    if (deps.workspace === undefined) throw new HttpError(404, "workspace_disabled", "The workspace is not enabled on this gateway");
    return deps.workspace;
  };
  const owner = (c: Context<GatewayEnv>) => ownerForUser(c.get("principal").user.id);
  const path = (c: Context<GatewayEnv>) => {
    const parsed = pathQuery.safeParse(c.req.query("path"));
    if (!parsed.success) throw new HttpError(400, "invalid_request", "Query parameter path is required");
    return parsed.data;
  };

  v1.get("/features", (c) =>
    c.json({
      workspace: deps.workspace !== undefined,
      uploads: deps.uploads === undefined ? null : { maxBytes: deps.uploads.maxBytes },
      transcription: deps.transcriber !== undefined,
    }),
  );

  v1.get("/workspace/files", async (c) => {
    const dir = c.req.query("path");
    return c.json(await workspaceCall(() => workspace().list(owner(c), dir === undefined || dir === "" ? undefined : dir)));
  });

  /** A file's text as JSON, or with ?download=1 as an attachment. */
  v1.get("/workspace/file", async (c) => {
    const file = await workspaceCall(() => workspace().read(owner(c), path(c)));
    if (c.req.query("download") !== "1") return c.json(file);
    const name = file.path.split("/").at(-1) ?? "file.txt";
    return c.body(file.content, 200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
  });

  v1.delete("/workspace/file", async (c) => c.json(await workspaceCall(() => workspace().delete(owner(c), path(c)))));

  v1.get("/workspace/history", async (c) => c.json(await workspaceCall(() => workspace().history(owner(c), path(c)))));

  v1.post("/workspace/restore", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new HttpError(400, "invalid_json", "Request body must be JSON");
    }
    const body = restoreBody.safeParse(raw);
    if (!body.success) throw new HttpError(400, "invalid_request", "Body must be {path, version?}");
    return c.json(await workspaceCall(() => workspace().restore(owner(c), body.data.path, body.data.version)));
  });

  /** Raw file bytes with ?filename=; stored under uploads/ like chat uploads (PDF/DOCX as text). */
  v1.post("/workspace/uploads", async (c) => {
    const uploads = deps.uploads;
    if (uploads === undefined || deps.workspace === undefined) throw new HttpError(404, "uploads_disabled", "Uploads are not enabled on this gateway");
    const filename = z.string().trim().min(1).max(200).safeParse(c.req.query("filename"));
    if (!filename.success) throw new HttpError(400, "invalid_request", "Query parameter filename is required");
    const data = await readBody(c, uploads.maxBytes);
    return c.json(await workspaceCall(() => uploads.save(owner(c), { filename: filename.data, data })), 201);
  });

  /** Raw audio (Content-Type audio/webm, audio/ogg, audio/mp4…) → { text }. */
  v1.post("/transcriptions", async (c) => {
    const transcriber = deps.transcriber;
    if (transcriber === undefined) throw new HttpError(404, "transcription_disabled", "Transcription is not enabled on this gateway (voice.enabled)");
    const mimeType = (c.req.header("content-type") ?? "audio/webm").split(";")[0]?.trim() || "audio/webm";
    if (!mimeType.startsWith("audio/") && mimeType !== "video/webm") throw new HttpError(415, "unsupported_media_type", "Send audio (audio/webm, audio/ogg, audio/mp4, audio/mpeg)");
    const data = await readBody(c, MAX_AUDIO_BYTES);
    const language = c.req.query("language") ?? deps.transcriptionLanguage;
    const text = (await transcriber.transcribe({ data, mimeType, filename: audioFilename(mimeType) }, language !== undefined && language !== "auto" ? { language } : {})).trim();
    return c.json({ text });
  });
}
