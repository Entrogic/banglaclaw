import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completionScript } from "../src/commands/completion.js";
import { buildProgram } from "../src/program.js";
import { configureOutput } from "../src/ui/output.js";

function tempConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "banglaclaw-cli-"));
  const path = join(dir, "banglaclaw.yaml");
  writeFileSync(path, "models:\n  default:\n    provider: openai-compatible\n    model: test-model\n    baseUrl: http://127.0.0.1:1/v1\nskills:\n  dirs: []\n");
  return path;
}

async function run(args: string[]): Promise<string> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    const program = buildProgram().exitOverride();
    await program.parseAsync(["node", "banglaclaw", ...args]);
  } finally {
    spy.mockRestore();
  }
  return chunks.join("");
}

afterEach(() => configureOutput({ json: false, quiet: false }));

describe("CLI commands", () => {
  it("lists tools as JSON", async () => {
    const out = JSON.parse(await run(["--json", "-c", tempConfig(), "tool", "list"])) as { name: string; allowed: boolean; source: string }[];
    expect(out.map((t) => t.name)).toEqual(["calculator", "current_datetime"]);
    expect(out[0]).toMatchObject({ allowed: true, source: "builtin" });
  });

  it("accepts global options after the subcommand", async () => {
    const out = JSON.parse(await run(["-c", tempConfig(), "agent", "list", "--json"])) as { supervisor: { name: string }; specialists: unknown[] };
    expect(out.supervisor.name).toBe("supervisor");
    expect(out.specialists).toEqual([]);
  });

  it("reports doctor checks as JSON", async () => {
    const report = JSON.parse(await run(["--json", "-c", tempConfig(), "doctor"])) as { ok: boolean; checks: { section: string; status: string; message: string }[] };
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.section === "Model")?.message).toContain("openai-compatible:test-model");
    expect(report.checks.some((c) => c.message.includes("No API key needed"))).toBe(true);
  });

  it("prints version details as JSON", async () => {
    const info = JSON.parse(await run(["--json", "-c", tempConfig(), "version"])) as Record<string, string>;
    expect(info).toMatchObject({ cli: expect.stringMatching(/^\d+\.\d+\.\d+$/), model: "openai-compatible:test-model", storage: "memory" });
  });
});

describe("completion", () => {
  const program = buildProgram();
  const names = program.commands.map((c) => c.name());

  it.each(["bash", "zsh", "fish"])("%s script covers every command", (shell) => {
    const script = completionScript(program, shell);
    for (const name of names) expect(script).toContain(name);
    expect(script).toContain("list");
  });

  it("rejects unknown shells", () => {
    expect(() => completionScript(program, "tcsh")).toThrow(/Unsupported shell/);
  });
});
