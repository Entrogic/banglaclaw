import { AIMessageChunk } from "@langchain/core/messages";
import { render } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { AgentRuntime } from "@banglaclaw/agent";
import { InMemoryAuthStore } from "@banglaclaw/auth";
import { McpManager } from "@banglaclaw/mcp";
import { FakeProvider, type ModelProvider, type ScriptedTurn } from "@banglaclaw/providers";
import { InMemoryRunStore, InMemorySessionStore } from "@banglaclaw/session";
import { InMemoryAuditStore, createLogger, loadConfig } from "@banglaclaw/shared";
import { SkillSet } from "@banglaclaw/skills";
import { AllowlistPolicy, ToolRegistry, builtinTools } from "@banglaclaw/tools";
import type { RuntimeBundle } from "../src/bootstrap.js";
import { App } from "../src/tui/App.js";
import { setColor } from "../src/ui/theme.js";

process.env.BANGLACLAW_HISTORY_FILE = "";
setColor(false);
const silent = createLogger({ write: () => {} });
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

async function until(frame: () => string | undefined, pred: (f: string) => boolean, timeout = 3000): Promise<string> {
  const start = Date.now();
  for (;;) {
    const f = frame() ?? "";
    if (pred(f)) return f;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting. Last frame:\n${f}`);
    await tick();
  }
}

class GatedProvider implements ModelProvider {
  readonly id = "gated:model";
  release: () => void = () => {};
  chat(): never {
    throw new Error("unused");
  }
  async *stream(_m: unknown, o: { signal?: AbortSignal } = {}): AsyncIterable<AIMessageChunk> {
    await new Promise<void>((resolve, reject) => {
      this.release = resolve;
      o.signal?.addEventListener("abort", () => reject(o.signal?.reason), { once: true });
    });
    yield new AIMessageChunk({ content: "late" });
  }
}

async function setup(provider: ModelProvider) {
  const sessions = new InMemorySessionStore();
  const runs = new InMemoryRunStore();
  const registry = new ToolRegistry();
  for (const t of builtinTools) registry.register(t);
  const policy = new AllowlistPolicy(["calculator"]);
  const runtime = new AgentRuntime({ provider, registry, policy, sessions, runs, limits: { maxIterations: 4, maxToolCalls: 4 }, timeoutMs: 5000, timezone: "Asia/Dhaka", logger: silent, team: { profiles: [], handoff: true, maxTransfers: 2 } });
  const loaded = loadConfig({ cwd: "/", env: {} });
  const bundle = {
    runtime,
    services: { loaded, sessions, runs, auth: new InMemoryAuthStore(), audit: new InMemoryAuditStore(), persistent: false, close: async () => {} },
    mcp: new McpManager({ servers: {} }),
    registry,
    policy,
    skills: new SkillSet([]),
    providerId: provider.id,
    knowledge: { tools: [], contextProviders: [], ingestSources: async () => ({ ingested: 0, skipped: 0, errors: [] }) },
    profiles: [],
    plugins: [],
  } as unknown as RuntimeBundle;
  const session = await sessions.create({ channel: "cli", agentId: "banglaclaw" });
  let exited: string | undefined;
  const app = render(<App bundle={bundle} initial={session} onExit={(s) => (exited = s.id)} />);
  return { app, exited: () => exited, session };
}

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe("chat TUI", () => {
  it("shows the banner, streams a reply with a tool line and a status summary", async () => {
    const script: ScriptedTurn[] = [
      { toolCalls: [{ name: "calculator", args: { expression: "25*4" } }], usage: { input: 100, output: 10 } },
      { content: "**উত্তর:** ১০০", usage: { input: 120, output: 8 } },
    ];
    const { app } = await setup(new FakeProvider(script));
    cleanup = app.unmount;
    expect(app.lastFrame()).toContain("🐾 BanglaClaw");
    expect(app.lastFrame()).toContain("fake:scripted");

    app.stdin.write("২৫ * ৪ কত?");
    await until(app.lastFrame, (f) => f.includes("২৫ * ৪ কত?"));
    app.stdin.write("\r");
    const done = await until(app.lastFrame, (f) => f.includes("completed"));
    expect(done).toContain("⚙ calculator(25*4) → 100");
    expect(done).toContain("উত্তর:");
    expect(done).toContain("220→18 tokens");
    expect(done).toContain("1 tool");
  });

  it("opens the slash menu and runs commands", async () => {
    const { app } = await setup(new FakeProvider([{ content: "hi" }]));
    cleanup = app.unmount;
    app.stdin.write("/");
    const menu = await until(app.lastFrame, (f) => f.includes("/history"));
    expect(menu).toContain("/help");
    app.stdin.write("he");
    await until(app.lastFrame, (f) => f.includes("▸ /help"));
    app.stdin.write("\r");
    const help = await until(app.lastFrame, (f) => f.includes("Keyboard") || f.includes("Esc cancel"));
    expect(help).toContain("/new");
  });

  it("cancels a running reply with Esc", async () => {
    const provider = new GatedProvider();
    const { app } = await setup(provider);
    cleanup = app.unmount;
    app.stdin.write("slow question");
    await until(app.lastFrame, (f) => f.includes("slow question"));
    app.stdin.write("\r");
    await until(app.lastFrame, (f) => f.includes("Esc to cancel"));
    app.stdin.write("\u001b");
    const f = await until(app.lastFrame, (x) => x.includes("aborted"));
    expect(f).toContain("Cancelled.");
  });

  it("shows the handoff banner and quits with Ctrl+C twice", async () => {
    const { app, exited, session } = await setup(new FakeProvider([{ toolCalls: [{ name: "request_human", args: { reason: "angry customer" } }] }]));
    cleanup = app.unmount;
    app.stdin.write("manusher sathe kotha bolbo");
    await until(app.lastFrame, (f) => f.includes("manusher"));
    app.stdin.write("\r");
    const f = await until(app.lastFrame, (x) => x.includes("handed to a human") || x.includes("Handed to a human"));
    expect(f).toContain("angry customer");
    app.stdin.write("\u0003");
    await until(app.lastFrame, (x) => x.includes("Press Ctrl+C again"));
    app.stdin.write("\u0003");
    await until(() => exited() ?? "", (x) => x === session.id);
  });
});

describe("chat TUI tool cards and sessions", () => {
  const calc: ScriptedTurn[] = [{ toolCalls: [{ name: "calculator", args: { expression: "25*4" } }] }, { content: "১০০" }];

  it("folds tool calls under Worked for and expands them with Ctrl+O", async () => {
    const { app } = await setup(new FakeProvider(calc));
    cleanup = app.unmount;
    app.stdin.write("25*4?\r");
    const done = await until(app.lastFrame, (f) => f.includes("completed"));
    expect(done).toMatch(/Worked for \d+\.\ds · 1 tool/);
    expect(done).toContain("⚙ calculator(25*4) → 100");
    app.stdin.write("\u000f");
    const open = await until(app.lastFrame, (f) => f.includes("result"));
    expect(open).toContain('"expression": "25*4"');
    expect(open).toContain('"result": 100');
    expect(open).toContain("^O collapse");
  });

  it("switches to an earlier session from the Ctrl+P picker", async () => {
    const { app } = await setup(new FakeProvider(calc));
    cleanup = app.unmount;
    app.stdin.write("pichhoner prosno\r");
    await until(app.lastFrame, (f) => f.includes("completed"));
    app.stdin.write("/new\r");
    await until(app.lastFrame, (f) => f.includes("New session"));
    app.stdin.write("\u0010");
    const list = await until(app.lastFrame, (f) => f.includes("Enter open"));
    expect(list).toContain("pichhoner prosno");
    expect(list).toContain("· current");
    app.stdin.write("\u001b[B");
    await tick(50);
    app.stdin.write("\r");
    const back = await until(app.lastFrame, (f) => f.includes("Used 1 tool"));
    expect(back).toContain("› pichhoner prosno");
    expect(back).toContain("১০০");
  });
});

describe("chat TUI input", () => {
  it("sends text and Enter that arrive in one chunk", async () => {
    const { app } = await setup(new FakeProvider([{ content: "five" }]));
    cleanup = app.unmount;
    app.stdin.write("2+3?\r");
    const f = await until(app.lastFrame, (x) => x.includes("completed"));
    expect(f).toContain("› 2+3?");
    expect(f).toContain("five");
  });
});
