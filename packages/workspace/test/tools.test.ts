import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "@entrogic-net/agent";
import { FakeProvider, type ScriptedTurn } from "@entrogic-net/providers";
import { InMemoryRunStore, InMemorySessionStore } from "@entrogic-net/session";
import { createLogger } from "@entrogic-net/shared";
import { AllowlistPolicy, ToolRegistry } from "@entrogic-net/tools";
import { Workspace, createWorkspaceTools } from "../src/index.js";

const silent = createLogger({ write: () => {} });

function setup(script: ScriptedTurn[], allow: string[] = ["workspace_*"]) {
  const root = mkdtempSync(join(tmpdir(), "bc-ws-tools-"));
  const sessions = new InMemorySessionStore();
  const runs = new InMemoryRunStore(sessions);
  const registry = new ToolRegistry();
  const workspace = new Workspace(root, { maxFileBytes: 10_000, maxFiles: 50, maxTotalBytes: 100_000, historyVersions: 3 });
  for (const tool of createWorkspaceTools(workspace, sessions, { channels: ["cli", "telegram"] })) registry.register(tool);
  const runtime = new AgentRuntime({
    provider: new FakeProvider(script), registry, policy: new AllowlistPolicy(allow), sessions, runs,
    limits: { maxIterations: 6, maxToolCalls: 6 }, timeoutMs: 5_000, timezone: "Asia/Dhaka", logger: silent,
  });
  return { runtime, sessions, root };
}

describe("workspace tools in an agent run", () => {
  it("creates, edits and reads a file in the session owner's folder", async () => {
    const { runtime, sessions, root } = setup([
      { toolCalls: [{ name: "workspace_create", args: { path: "shop/list.md", content: "- চাল ৫ কেজি\n- ডাল ১ কেজি" } }] },
      { toolCalls: [{ name: "workspace_edit", args: { path: "shop/list.md", old_text: "ডাল ১ কেজি", new_text: "ডাল ২ কেজি" } }] },
      { toolCalls: [{ name: "workspace_read", args: { path: "shop/list.md" } }] },
      { content: "তালিকা হালনাগাদ হয়েছে।" },
    ]);
    const session = await sessions.create({ channel: "telegram", externalId: "555", agentId: "banglaclaw" });
    const record = await runtime.run("bazar list e dal 2 kg koro", { sessionId: session.id });

    expect(record.status).toBe("completed");
    expect(record.toolCalls.map((c) => [c.tool, c.status])).toEqual([
      ["workspace_create", "ok"],
      ["workspace_edit", "ok"],
      ["workspace_read", "ok"],
    ]);
    expect(readFileSync(join(root, "telegram_555", "shop", "list.md"), "utf8")).toBe("- চাল ৫ কেজি\n- ডাল ২ কেজি");
    expect(record.toolCalls[2]?.output).toMatchObject({ content: "- চাল ৫ কেজি\n- ডাল ২ কেজি" });
  });

  it("refuses channels that are not enabled for the workspace", async () => {
    const { runtime, sessions, root } = setup([{ toolCalls: [{ name: "workspace_create", args: { path: "x.txt", content: "hi" } }] }, { content: "ok" }]);
    const session = await sessions.create({ channel: "widget", externalId: "visitor-1", agentId: "banglaclaw" });
    const record = await runtime.run("make a file", { sessionId: session.id });
    expect(record.toolCalls[0]).toMatchObject({ tool: "workspace_create", status: "error", error: expect.stringContaining("not available in the widget channel") });
    expect(existsSync(join(root, "widget_visitor-1"))).toBe(false);
  });

  it("is denied unless the tools are allowed", async () => {
    const { runtime, sessions } = setup([{ toolCalls: [{ name: "workspace_write", args: { path: "x.txt", content: "hi" } }] }, { content: "ok" }], ["calculator"]);
    const session = await sessions.create({ channel: "cli", agentId: "banglaclaw" });
    const record = await runtime.run("write a file", { sessionId: session.id });
    expect(record.toolCalls[0]?.status).toBe("denied");
  });

  it("reports model mistakes as error observations the model can fix", async () => {
    const { runtime, sessions } = setup([
      { toolCalls: [{ name: "workspace_read", args: { path: "../../etc/passwd" } }] },
      { toolCalls: [{ name: "workspace_edit", args: { path: "none.md", old_text: "a", new_text: "b" } }] },
      { content: "sorry" },
    ]);
    const session = await sessions.create({ channel: "cli", agentId: "banglaclaw" });
    const record = await runtime.run("read passwd", { sessionId: session.id });
    expect(record.toolCalls.map((c) => c.status)).toEqual(["error", "error"]);
    expect(record.toolCalls[0]?.error).toMatch(/Invalid path/);
    expect(record.toolCalls[1]?.error).toMatch(/does not exist/);
  });
});
