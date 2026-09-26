import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { ToolExecutionError } from "@entrogic-net/shared";

/** A workspace problem the model can act on. Messages never contain absolute server paths. */
export class WorkspaceError extends ToolExecutionError {}

export interface WorkspaceLimits {
  /** Largest file that may be written, in bytes. */
  maxFileBytes: number;
  /** Files an owner may keep (history and trash excluded). */
  maxFiles: number;
  /** Everything under an owner's folder, history and trash included, in bytes. */
  maxTotalBytes: number;
  /** Previous versions kept per file. */
  historyVersions: number;
}

export interface WorkspaceEntry {
  path: string;
  type: "file" | "dir";
  size: number;
  modified: string;
}

export interface HistoryVersion {
  version: number;
  savedAt: string;
  size: number;
}

const HISTORY = ".history";
const TRASH = ".trash";
const MAX_PATH = 200;
const MAX_LIST = 200;
const MAX_READ_BYTES = 100 * 1024;

/** Owner id (e.g. "telegram:555") → a folder name that is safe on every filesystem. */
export function workspaceFolder(owner: string): string {
  const safe = owner.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return safe === "" || safe.startsWith(".") ? `_${safe}` : safe;
}

/** A relative path inside a workspace, checked for traversal and hidden segments. */
export function normalizePath(path: string): string {
  const trimmed = path.trim().replace(/^\.\/+/, "");
  if (trimmed === "" || trimmed === ".") throw new WorkspaceError("Path is empty");
  if (trimmed.length > MAX_PATH) throw new WorkspaceError(`Path is longer than ${MAX_PATH} characters`);
  if (trimmed.includes("\0") || trimmed.includes("\\")) throw new WorkspaceError("Path contains an invalid character");
  if (trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed)) throw new WorkspaceError("Use a path relative to the workspace, not an absolute path");
  const segments = trimmed.replace(/\/+$/, "").split("/");
  for (const s of segments) {
    if (s === "" || s === "." || s === "..") throw new WorkspaceError(`Invalid path "${path}": use plain folder and file names, no "." or ".." segments`);
    if (s.startsWith(".")) throw new WorkspaceError(`Invalid path "${path}": names starting with "." are reserved`);
  }
  return segments.join("/");
}

const stamp = (date = new Date()) => date.toISOString().replace(/[:.]/g, "-");
const isNotFound = (error: unknown) => (error as { code?: string } | undefined)?.code === "ENOENT";

/**
 * Per-owner sandboxed file storage (docs/24, ADR-0014). Every owner gets `<root>/<folder>/`;
 * paths are relative and may not escape it (no "..", no absolute paths, no symlinks out).
 * Nothing is ever destroyed: overwrites and edits keep the previous version in `.history/`,
 * and deletes move files to `.trash/`, so every change can be restored.
 */
export class Workspace {
  readonly root: string;
  /** Orders backups written within the same millisecond. */
  #seq = 0;

  constructor(
    root: string,
    readonly limits: WorkspaceLimits,
    readonly now: () => Date = () => new Date(),
  ) {
    this.root = resolve(root);
  }

  /** The owner's folder, created on first use. */
  async ownerRoot(owner: string): Promise<string> {
    const dir = join(this.root, workspaceFolder(owner));
    await mkdir(dir, { recursive: true });
    return realpath(dir);
  }

  async list(owner: string, dir?: string): Promise<{ entries: WorkspaceEntry[]; truncated: boolean }> {
    const root = await this.ownerRoot(owner);
    const start = dir === undefined || dir.trim() === "" || dir.trim() === "." ? root : await this.#resolve(root, normalizePath(dir));
    const entries: WorkspaceEntry[] = [];
    const walk = async (current: string): Promise<void> => {
      let names: string[];
      try {
        names = (await readdir(current)).sort();
      } catch (error) {
        if (isNotFound(error)) throw new WorkspaceError(`Folder "${dir ?? ""}" does not exist`);
        if ((error as { code?: string }).code === "ENOTDIR") throw new WorkspaceError(`"${dir ?? ""}" is a file, not a folder`);
        throw error;
      }
      for (const name of names) {
        if (name.startsWith(".") || entries.length >= MAX_LIST) continue;
        const full = join(current, name);
        const info = await lstat(full);
        if (info.isSymbolicLink()) continue;
        const path = relative(root, full).split(sep).join("/");
        entries.push({ path, type: info.isDirectory() ? "dir" : "file", size: info.isDirectory() ? 0 : info.size, modified: info.mtime.toISOString() });
        if (info.isDirectory()) await walk(full);
      }
    };
    await walk(start);
    return { entries, truncated: entries.length >= MAX_LIST };
  }

  async read(owner: string, path: string, window: { offset?: number; limit?: number } = {}): Promise<{ path: string; content: string; totalLines: number; truncated: boolean }> {
    const rel = normalizePath(path);
    const full = await this.#resolve(await this.ownerRoot(owner), rel);
    const text = await this.#readText(full, rel);
    const lines = text.split("\n");
    const offset = Math.max(0, (window.offset ?? 1) - 1);
    const selected = lines.slice(offset, window.limit !== undefined ? offset + window.limit : undefined).join("\n");
    const bytes = Buffer.from(selected, "utf8");
    const content = bytes.length > MAX_READ_BYTES ? bytes.subarray(0, MAX_READ_BYTES).toString("utf8") : selected;
    return { path: rel, content, totalLines: lines.length, truncated: content.length < selected.length || offset + (window.limit ?? lines.length) < lines.length };
  }

  async create(owner: string, path: string, content: string): Promise<{ path: string; bytes: number }> {
    const rel = normalizePath(path);
    const root = await this.ownerRoot(owner);
    const full = await this.#resolve(root, rel);
    if (await this.#exists(full)) throw new WorkspaceError(`"${rel}" already exists; use workspace_write to replace it or workspace_edit to change it`);
    await this.#checkQuota(root, content, undefined);
    await this.#writeFile(full, content);
    return { path: rel, bytes: Buffer.byteLength(content) };
  }

  /** Creates or replaces a file; a replaced version goes to history. */
  async write(owner: string, path: string, content: string): Promise<{ path: string; bytes: number; replaced: boolean }> {
    const rel = normalizePath(path);
    const root = await this.ownerRoot(owner);
    const full = await this.#resolve(root, rel);
    const existing = await this.#fileSize(full, rel);
    await this.#checkQuota(root, content, existing);
    if (existing !== undefined) await this.#backup(root, full, rel);
    await this.#writeFile(full, content);
    return { path: rel, bytes: Buffer.byteLength(content), replaced: existing !== undefined };
  }

  /** Replaces exact text. It must occur once unless `replaceAll` is set. */
  async edit(owner: string, path: string, oldText: string, newText: string, replaceAll = false): Promise<{ path: string; replacements: number; bytes: number }> {
    if (oldText === "") throw new WorkspaceError("old_text must not be empty");
    const rel = normalizePath(path);
    const root = await this.ownerRoot(owner);
    const full = await this.#resolve(root, rel);
    const text = await this.#readText(full, rel);
    const count = text.split(oldText).length - 1;
    if (count === 0) throw new WorkspaceError(`old_text was not found in "${rel}"; read the file and copy the text exactly`);
    if (count > 1 && !replaceAll) throw new WorkspaceError(`old_text occurs ${count} times in "${rel}"; include more surrounding text or set replace_all`);
    const updated = replaceAll ? text.split(oldText).join(newText) : text.replace(oldText, () => newText);
    await this.#checkQuota(root, updated, Buffer.byteLength(text));
    await this.#backup(root, full, rel);
    await this.#writeFile(full, updated);
    return { path: rel, replacements: replaceAll ? count : 1, bytes: Buffer.byteLength(updated) };
  }

  /** Moves a file to the trash; `restore` brings it back. */
  async delete(owner: string, path: string): Promise<{ path: string; trashed: string }> {
    const rel = normalizePath(path);
    const root = await this.ownerRoot(owner);
    const full = await this.#resolve(root, rel);
    if ((await this.#fileSize(full, rel)) === undefined) throw new WorkspaceError(`"${rel}" does not exist`);
    const trashed = join(TRASH, stamp(this.now()), rel);
    await mkdir(dirname(join(root, trashed)), { recursive: true });
    await rename(full, join(root, trashed));
    return { path: rel, trashed: trashed.split(sep).join("/") };
  }

  async history(owner: string, path: string): Promise<{ path: string; versions: HistoryVersion[]; inTrash: boolean }> {
    const rel = normalizePath(path);
    const root = await this.ownerRoot(owner);
    return { path: rel, versions: await this.#versions(root, rel), inTrash: (await this.#latestTrashed(root, rel)) !== undefined };
  }

  /**
   * Restores a file: from the trash if it was deleted, otherwise its newest (or the given)
   * history version. The current content, if any, is saved to history first.
   */
  async restore(owner: string, path: string, version?: number): Promise<{ path: string; restoredFrom: "history" | "trash"; bytes: number }> {
    const rel = normalizePath(path);
    const root = await this.ownerRoot(owner);
    const full = await this.#resolve(root, rel);
    const current = await this.#fileSize(full, rel);
    let source: string;
    let from: "history" | "trash";
    const trashed = version === undefined && current === undefined ? await this.#latestTrashed(root, rel) : undefined;
    if (trashed !== undefined) {
      source = trashed;
      from = "trash";
    } else {
      const versions = await this.#versions(root, rel);
      const chosen = version === undefined ? versions[0] : versions.find((v) => v.version === version);
      if (chosen === undefined) throw new WorkspaceError(version === undefined ? `"${rel}" has no earlier version or trashed copy` : `"${rel}" has no version ${version}`);
      source = join(root, HISTORY, rel, (await this.#historyFiles(root, rel))[chosen.version - 1] ?? "");
      from = "history";
    }
    const content = await readFile(source, "utf8");
    await this.#checkQuota(root, content, current);
    if (current !== undefined) await this.#backup(root, full, rel);
    await this.#writeFile(full, content);
    if (from === "trash") await rm(source, { force: true });
    return { path: rel, restoredFrom: from, bytes: Buffer.byteLength(content) };
  }

  /** Absolute path for `rel` inside `root`; refuses anything that resolves outside it (symlinks included). */
  async #resolve(root: string, rel: string): Promise<string> {
    const full = join(root, ...rel.split("/"));
    let probe = full;
    for (;;) {
      try {
        const real = await realpath(probe);
        if (real !== root && !real.startsWith(root + sep)) throw new WorkspaceError(`"${rel}" points outside the workspace`);
        break;
      } catch (error) {
        if (!isNotFound(error)) throw error;
        const parent = dirname(probe);
        if (parent === probe) break;
        probe = parent;
      }
    }
    return full;
  }

  async #exists(full: string): Promise<boolean> {
    try {
      await lstat(full);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /** Size of an existing regular file, undefined if missing; refuses folders and symlinks. */
  async #fileSize(full: string, rel: string): Promise<number | undefined> {
    try {
      const info = await lstat(full);
      if (info.isSymbolicLink()) throw new WorkspaceError(`"${rel}" is a link and cannot be used`);
      if (!info.isFile()) throw new WorkspaceError(`"${rel}" is a folder, not a file`);
      return info.size;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async #readText(full: string, rel: string): Promise<string> {
    const size = await this.#fileSize(full, rel);
    if (size === undefined) throw new WorkspaceError(`"${rel}" does not exist`);
    const buffer = await readFile(full);
    if (buffer.includes(0)) throw new WorkspaceError(`"${rel}" is not a text file`);
    return buffer.toString("utf8");
  }

  async #writeFile(full: string, content: string): Promise<void> {
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }

  async #checkQuota(root: string, content: string, replacedBytes: number | undefined): Promise<void> {
    const bytes = Buffer.byteLength(content);
    if (bytes > this.limits.maxFileBytes) throw new WorkspaceError(`File is ${bytes} bytes; the limit is ${this.limits.maxFileBytes}`);
    const usage = await this.#usage(root);
    if (replacedBytes === undefined && usage.files >= this.limits.maxFiles) throw new WorkspaceError(`Workspace already has ${usage.files} files (limit ${this.limits.maxFiles})`);
    // A replaced file's old content moves to history, so it still counts.
    if (usage.bytes + bytes > this.limits.maxTotalBytes) throw new WorkspaceError(`Workspace is full (${usage.bytes} of ${this.limits.maxTotalBytes} bytes used); delete or shorten files first`);
  }

  async #usage(root: string): Promise<{ files: number; bytes: number }> {
    let files = 0;
    let bytes = 0;
    const walk = async (dir: string, live: boolean): Promise<void> => {
      for (const name of await readdir(dir)) {
        const full = join(dir, name);
        const info = await lstat(full);
        if (info.isDirectory()) await walk(full, live && !name.startsWith("."));
        else if (info.isFile()) {
          bytes += info.size;
          if (live) files++;
        }
      }
    };
    await walk(root, true);
    return { files, bytes };
  }

  async #backup(root: string, full: string, rel: string): Promise<void> {
    const dir = join(root, HISTORY, rel);
    await mkdir(dir, { recursive: true });
    await copyFile(full, join(dir, `${stamp(this.now())}-${String(this.#seq++ % 10_000).padStart(4, "0")}`));
    const files = await this.#historyFiles(root, rel);
    for (const old of files.slice(this.limits.historyVersions)) await rm(join(dir, old), { force: true });
  }

  /** History file names, newest first. */
  async #historyFiles(root: string, rel: string): Promise<string[]> {
    try {
      return (await readdir(join(root, HISTORY, rel))).sort().reverse();
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  async #versions(root: string, rel: string): Promise<HistoryVersion[]> {
    const files = await this.#historyFiles(root, rel);
    return Promise.all(
      files.map(async (name, i) => {
        const info = await stat(join(root, HISTORY, rel, name));
        return { version: i + 1, savedAt: info.mtime.toISOString(), size: info.size };
      }),
    );
  }

  async #latestTrashed(root: string, rel: string): Promise<string | undefined> {
    let stamps: string[];
    try {
      stamps = (await readdir(join(root, TRASH))).sort().reverse();
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    for (const s of stamps) {
      const candidate = join(root, TRASH, s, rel);
      if (await this.#exists(candidate)) return candidate;
    }
    return undefined;
  }
}
