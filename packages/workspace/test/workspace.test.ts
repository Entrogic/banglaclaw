import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Workspace, WorkspaceError, normalizePath, workspaceFolder, type WorkspaceLimits } from "../src/index.js";

const limits: WorkspaceLimits = { maxFileBytes: 1_000, maxFiles: 5, maxTotalBytes: 5_000, historyVersions: 2 };

function setup(over: Partial<WorkspaceLimits> = {}) {
  const root = mkdtempSync(join(tmpdir(), "bc-ws-"));
  let t = Date.parse("2026-09-27T10:00:00.000Z");
  const ws = new Workspace(root, { ...limits, ...over }, () => new Date((t += 1_000)));
  return { ws, root, owner: "telegram:555", folder: join(root, "telegram_555") };
}

describe("path safety", () => {
  it("accepts plain relative paths and rejects traversal, absolute and hidden paths", () => {
    expect(normalizePath("notes/todo.md")).toBe("notes/todo.md");
    expect(normalizePath("./a.txt")).toBe("a.txt");
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:/x", "a\\b", ".history/x", "a/.trash/b", "", "a//b", "x\0y", "a/./b"]) {
      expect(() => normalizePath(bad), bad).toThrow(WorkspaceError);
    }
  });

  it("maps owners to safe folder names", () => {
    expect(workspaceFolder("user:3f2a")).toBe("user_3f2a");
    expect(workspaceFolder("cli:local")).toBe("cli_local");
    expect(workspaceFolder("../../etc")).toBe("_.._.._etc");
  });

  it("refuses symlinks that lead outside the owner's folder", async () => {
    const { ws, owner, folder } = setup();
    await ws.create(owner, "ok.txt", "fine");
    const outside = mkdtempSync(join(tmpdir(), "bc-outside-"));
    writeFileSync(join(outside, "secret.txt"), "top secret");
    symlinkSync(outside, join(folder, "escape"));
    symlinkSync(join(outside, "secret.txt"), join(folder, "link.txt"));

    await expect(ws.read(owner, "escape/secret.txt")).rejects.toThrow(/outside the workspace/);
    await expect(ws.write(owner, "escape/new.txt", "x")).rejects.toThrow(/outside the workspace/);
    await expect(ws.read(owner, "link.txt")).rejects.toThrow(WorkspaceError);
    await expect(ws.write(owner, "link.txt", "overwrite")).rejects.toThrow(WorkspaceError);
    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("top secret");
    expect(readdirSync(outside)).toEqual(["secret.txt"]);
    expect((await ws.list(owner)).entries.map((e) => e.path)).toEqual(["ok.txt"]);
  });

  it("keeps owners apart", async () => {
    const { ws } = setup();
    await ws.create("telegram:1", "a.txt", "one");
    await expect(ws.read("telegram:2", "a.txt")).rejects.toThrow(/does not exist/);
    expect((await ws.list("telegram:2")).entries).toEqual([]);
  });
});

describe("files", () => {
  it("creates, lists, reads windows and refuses to create over an existing file", async () => {
    const { ws, owner } = setup();
    expect(await ws.create(owner, "notes/todo.md", "১. দুধ\n২. ডিম\n৩. চাল")).toEqual({ path: "notes/todo.md", bytes: expect.any(Number) });
    await expect(ws.create(owner, "notes/todo.md", "again")).rejects.toThrow(/already exists/);
    expect((await ws.list(owner)).entries.map((e) => [e.path, e.type])).toEqual([["notes", "dir"], ["notes/todo.md", "file"]]);
    expect(await ws.read(owner, "notes/todo.md", { offset: 2, limit: 1 })).toEqual({ path: "notes/todo.md", content: "২. ডিম", totalLines: 3, truncated: true });
    await expect(ws.read(owner, "notes")).rejects.toThrow(/folder/);
    await expect(ws.list(owner, "notes/todo.md")).rejects.toThrow(/file, not a folder/);
  });

  it("edits exact text once, all occurrences on request, and explains failures", async () => {
    const { ws, owner } = setup();
    await ws.create(owner, "a.txt", "price 100, price 100");
    await expect(ws.edit(owner, "a.txt", "price 100", "price 90")).rejects.toThrow(/occurs 2 times/);
    await expect(ws.edit(owner, "a.txt", "missing", "x")).rejects.toThrow(/not found/);
    expect(await ws.edit(owner, "a.txt", "price 100", "price 90", true)).toMatchObject({ replacements: 2 });
    expect((await ws.read(owner, "a.txt")).content).toBe("price 90, price 90");
    expect(await ws.edit(owner, "a.txt", "90, price", "$& 80, price")).toMatchObject({ replacements: 1 });
    expect((await ws.read(owner, "a.txt")).content).toBe("price $& 80, price 90");
  });

  it("keeps previous versions, prunes old ones and restores them", async () => {
    const { ws, owner } = setup();
    await ws.write(owner, "a.txt", "v1");
    expect(await ws.write(owner, "a.txt", "v2")).toMatchObject({ replaced: true });
    await ws.write(owner, "a.txt", "v3");
    await ws.edit(owner, "a.txt", "v3", "v4");
    const { versions } = await ws.history(owner, "a.txt");
    expect(versions.map((v) => v.version)).toEqual([1, 2]);

    expect(await ws.restore(owner, "a.txt")).toMatchObject({ restoredFrom: "history" });
    expect((await ws.read(owner, "a.txt")).content).toBe("v3");
    // Restoring saved "v4" first, so it can be brought back too.
    await ws.restore(owner, "a.txt", 1);
    expect((await ws.read(owner, "a.txt")).content).toBe("v4");
    await expect(ws.restore(owner, "a.txt", 9)).rejects.toThrow(/no version 9/);
  });

  it("moves deleted files to the trash and restores them", async () => {
    const { ws, owner, folder } = setup();
    await ws.create(owner, "docs/plan.md", "the plan");
    const { trashed } = await ws.delete(owner, "docs/plan.md");
    expect(trashed).toMatch(/^\.trash\/.+\/docs\/plan\.md$/);
    await expect(ws.read(owner, "docs/plan.md")).rejects.toThrow(/does not exist/);
    await expect(ws.delete(owner, "docs/plan.md")).rejects.toThrow(/does not exist/);
    expect((await ws.list(owner)).entries.map((e) => e.path)).toEqual(["docs"]);
    expect(await ws.history(owner, "docs/plan.md")).toMatchObject({ inTrash: true });

    expect(await ws.restore(owner, "docs/plan.md")).toMatchObject({ restoredFrom: "trash" });
    expect((await ws.read(owner, "docs/plan.md")).content).toBe("the plan");
    expect(readdirSync(join(folder, ".trash"), { recursive: true }).filter((f) => String(f).endsWith("plan.md"))).toEqual([]);
  });

  it("enforces file size, file count and total size", async () => {
    const { ws, owner } = setup({ maxFileBytes: 10, maxFiles: 2, maxTotalBytes: 25 });
    await expect(ws.create(owner, "big.txt", "x".repeat(11))).rejects.toThrow(/limit is 10/);
    await ws.create(owner, "a.txt", "1234567890");
    await ws.create(owner, "b.txt", "1234567890");
    await expect(ws.create(owner, "c.txt", "1")).rejects.toThrow(/2 files/);
    // Replacing keeps the old copy in history, which counts towards the total.
    await expect(ws.write(owner, "a.txt", "abcdefghij")).rejects.toThrow(/full/);
  });

  it("never reveals the server path in errors", async () => {
    const { ws, owner, root } = setup();
    mkdirSync(join(root, "telegram_555", "dir"), { recursive: true });
    for (const attempt of [() => ws.read(owner, "nope.txt"), () => ws.read(owner, "dir"), () => ws.edit(owner, "nope.txt", "a", "b")]) {
      const error = await attempt().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WorkspaceError);
      expect(String((error as Error).message)).not.toContain(root);
    }
  });
});
