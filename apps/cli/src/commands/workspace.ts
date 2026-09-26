import { BanglaClawError } from "@entrogic-net/shared";
import type { Workspace } from "@entrogic-net/workspace";
import { load, type GlobalOptions } from "../bootstrap.js";
import { emit, empty, print, printAlways, success } from "../ui/output.js";
import { table } from "../ui/table.js";
import { c } from "../ui/theme.js";
import { openWorkspace } from "../workspace.js";

type Options = GlobalOptions & { owner: string };

function requireWorkspace(options: GlobalOptions): Workspace {
  const workspace = openWorkspace(load(options));
  if (workspace === undefined) throw new BanglaClawError("WORKSPACE_DISABLED", "The workspace is off: set workspace.enabled: true in banglaclaw.yaml");
  return workspace;
}

const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** `banglaclaw workspace list [path]`: an owner's files. */
export async function workspaceList(path: string | undefined, options: Options): Promise<void> {
  const workspace = requireWorkspace(options);
  const { entries, truncated } = await workspace.list(options.owner, path);
  emit({ owner: options.owner, root: await workspace.ownerRoot(options.owner), entries, truncated }, (r) => {
    if (r.entries.length === 0) return empty(`No files for ${r.owner} (${r.root}).`);
    print(
      table(r.entries, [
        { header: "PATH", value: (e) => (e.type === "dir" ? `${e.path}/` : e.path), color: (s) => (s.endsWith("/") ? c.dim(s) : c.bold(s)) },
        { header: "SIZE", value: (e) => (e.type === "dir" ? "" : size(e.size)), align: "right" },
        { header: "MODIFIED", value: (e) => e.modified.replace("T", " ").slice(0, 16), color: (s) => c.dim(s) },
      ]),
    );
    if (r.truncated) print(c.dim("(first 200 entries)"));
  });
}

/** `banglaclaw workspace show <path>`: prints a file (raw content, so it can be piped). */
export async function workspaceShow(path: string, options: Options): Promise<void> {
  const file = await requireWorkspace(options).read(options.owner, path);
  emit(file, (f) => printAlways(f.content));
}

/** `banglaclaw workspace history <path>`: saved versions and whether a deleted copy is in the trash. */
export async function workspaceHistory(path: string, options: Options): Promise<void> {
  const history = await requireWorkspace(options).history(options.owner, path);
  emit(history, (h) => {
    if (h.versions.length === 0 && !h.inTrash) return empty(`${h.path} has no earlier versions.`);
    if (h.versions.length > 0)
      print(
        table(h.versions, [
          { header: "VERSION", value: (v) => String(v.version), align: "right" },
          { header: "SAVED", value: (v) => v.savedAt.replace("T", " ").slice(0, 19), color: (s) => c.dim(s) },
          { header: "SIZE", value: (v) => size(v.size), align: "right" },
        ]),
      );
    if (h.inTrash) print(c.dim(`A deleted copy is in the trash: banglaclaw workspace restore ${h.path}`));
  });
}

/** `banglaclaw workspace restore <path> [--version n]`: undo a delete or an edit. */
export async function workspaceRestore(path: string, options: Options & { version?: string }): Promise<void> {
  const version = options.version === undefined ? undefined : Number(options.version);
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) throw new BanglaClawError("INVALID_VERSION", `Invalid version: ${options.version ?? ""}`);
  const restored = await requireWorkspace(options).restore(options.owner, path, version);
  emit(restored, (r) => success(`Restored ${r.path} from ${r.restoredFrom}`));
}
