import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "@entrogic-net/workspace";
import { buildProgram } from "../src/program.js";
import { configureOutput } from "../src/ui/output.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "banglaclaw-ws-cli-"));
  const config = join(dir, "banglaclaw.yaml");
  writeFileSync(
    config,
    "models:\n  default:\n    provider: openai-compatible\n    model: test-model\n    baseUrl: http://127.0.0.1:1/v1\nskills:\n  dirs: []\n  builtin: false\ntools:\n  allow: [calculator, \"workspace_*\"]\nworkspace:\n  enabled: true\n",
  );
  const workspace = new Workspace(join(dir, "workspace"), { maxFileBytes: 10_000, maxFiles: 50, maxTotalBytes: 100_000, historyVersions: 3 });
  return { config, workspace };
}

async function run(args: string[]): Promise<string> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    await buildProgram().exitOverride().parseAsync(["node", "banglaclaw", ...args]);
  } finally {
    spy.mockRestore();
  }
  return chunks.join("");
}

afterEach(() => configureOutput({ json: false, quiet: false }));

describe("workspace commands", () => {
  it("lists, shows, tracks history and restores an owner's files", async () => {
    const { config, workspace } = setup();
    await workspace.write("cli:local", "notes/todo.md", "v1");
    await workspace.write("cli:local", "notes/todo.md", "v2");

    const listed = JSON.parse(await run(["--json", "-c", config, "workspace", "list"])) as { owner: string; entries: { path: string }[] };
    expect(listed.owner).toBe("cli:local");
    expect(listed.entries.map((e) => e.path)).toEqual(["notes", "notes/todo.md"]);

    expect(JSON.parse(await run(["--json", "-c", config, "workspace", "show", "notes/todo.md"]))).toMatchObject({ content: "v2" });
    const history = JSON.parse(await run(["--json", "-c", config, "workspace", "history", "notes/todo.md"])) as { versions: unknown[] };
    expect(history.versions).toHaveLength(1);

    expect(JSON.parse(await run(["--json", "-c", config, "workspace", "restore", "notes/todo.md"]))).toMatchObject({ restoredFrom: "history" });
    expect((await workspace.read("cli:local", "notes/todo.md")).content).toBe("v1");

    const other = JSON.parse(await run(["--json", "-c", config, "workspace", "list", "--owner", "telegram:9"])) as { entries: unknown[] };
    expect(other.entries).toEqual([]);
  });

  it("shows the workspace tools in tool list when enabled", async () => {
    const { config } = setup();
    const tools = JSON.parse(await run(["--json", "-c", config, "tool", "list"])) as { name: string; source: string; allowed: boolean }[];
    expect(tools.filter((t) => t.source === "workspace").map((t) => [t.name, t.allowed])).toEqual([
      ["workspace_list", true],
      ["workspace_read", true],
      ["workspace_create", true],
      ["workspace_write", true],
      ["workspace_edit", true],
      ["workspace_delete", true],
      ["workspace_restore", true],
    ]);
  });
});
