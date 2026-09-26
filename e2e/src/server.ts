/**
 * Gateway for the browser tests: memory storage, a rule-based fake model (deterministic, so
 * tests can run in parallel), the web chat, the website widget and — when built — the admin
 * dashboard. API keys are written to E2E_STATE for the tests to read.
 */
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AIMessage, AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import { Hono } from "hono";
import { AgentRuntime } from "@entrogic-net/agent";
import { ApiKeyAuthenticator, InMemoryAuthStore } from "@entrogic-net/auth";
import { startGateway } from "@entrogic-net/gateway";
import { FakeProvider, type ModelCallOptions, type ModelProvider, type ScriptedTurn } from "@entrogic-net/providers";
import { InMemoryRunStore, InMemorySessionStore } from "@entrogic-net/session";
import { createLogger } from "@entrogic-net/shared";
import { SkillSet } from "@entrogic-net/skills";
import { AllowlistPolicy, ToolRegistry, builtinTools } from "@entrogic-net/tools";
import { Workspace, createWorkspaceTools } from "@entrogic-net/workspace";

const port = Number(process.env.E2E_PORT ?? 4319);
const statePath = process.env.E2E_STATE ?? fileURLToPath(new URL("../.state.json", import.meta.url));
const dashboardDir = fileURLToPath(new URL("../../apps/dashboard/dist", import.meta.url));

/**
 * "25 * 4" style questions call the calculator, then answer with a markdown table; anything
 * else is echoed. Decided from the conversation, not from call order.
 */
class RuleProvider implements ModelProvider {
  readonly id = "e2e:rules";

  #turn(messages: BaseMessage[]): ScriptedTurn {
    const last = messages.at(-1);
    if (last?.getType() === "tool" && last.text.includes('"path"')) return { content: "ফাইলটি workspace-এ রাখা হয়েছে।" };
    if (last?.getType() === "tool") {
      const result = /"result":\s*(-?[\d.]+)/.exec(last.text)?.[1] ?? "?";
      return { content: `**উত্তর:** ${result}\n\n| হিসাব | ফল |\n|---|---|\n| গুণ | ${result} |`, usage: { input: 120, output: 18 } };
    }
    const text = last?.text ?? "";
    // "note: <name>: <content>" writes a workspace file.
    const note = /^note:\s*([\w.-]+):\s*([\s\S]+)$/.exec(text);
    if (note !== null) return { toolCalls: [{ name: "workspace_write", args: { path: `notes/${note[1]}`, content: note[2] ?? "" } }] };
    const expression = /(\d+)\s*[*x×]\s*(\d+)/.exec(text);
    if (expression !== null) return { toolCalls: [{ name: "calculator", args: { expression: `${expression[1]}*${expression[2]}` } }], usage: { input: 100, output: 10 } };
    return { content: `আপনি লিখেছেন: ${text}`, usage: { input: 50, output: 8 } };
  }

  chat(messages: BaseMessage[], options?: ModelCallOptions): Promise<AIMessage> {
    return new FakeProvider([this.#turn(messages)]).chat(messages, options);
  }

  stream(messages: BaseMessage[], options?: ModelCallOptions): AsyncIterable<AIMessageChunk> {
    return new FakeProvider([this.#turn(messages)]).stream(messages, options);
  }
}

const logger = createLogger({ write: () => {} });
const sessions = new InMemorySessionStore();
const runs = new InMemoryRunStore(sessions);
const registry = new ToolRegistry();
for (const tool of builtinTools) registry.register(tool);
const workspace = new Workspace(mkdtempSync(join(tmpdir(), "banglaclaw-e2e-ws-")), { maxFileBytes: 100_000, maxFiles: 200, maxTotalBytes: 5_000_000, historyVersions: 5 });
for (const tool of createWorkspaceTools(workspace, sessions, { channels: ["api"] })) registry.register(tool);
const policy = new AllowlistPolicy(["calculator", "workspace_*"]);
const provider = new RuleProvider();
const runtime = new AgentRuntime({ provider, registry, policy, sessions, runs, limits: { maxIterations: 4, maxToolCalls: 4 }, timeoutMs: 10_000, timezone: "Asia/Dhaka", logger });
const auth = new ApiKeyAuthenticator(new InMemoryAuthStore());
const user = await auth.issueKey("e2e-user", "browser");
const admin = await auth.issueKey("e2e-admin", "browser", "admin");

// A "customer site" on another origin (localhost vs 127.0.0.1) that embeds the widget.
const host = new Hono();
host.get("/e2e/host.html", (c) =>
  c.html(`<!doctype html><html lang="bn"><head><meta charset="utf-8"><title>Dokan</title></head><body><h1>Dokan</h1><script src="http://127.0.0.1:${port}/widget.js" async></script></body></html>`),
);

const gateway = await startGateway({
  runtime, sessions, runs, auth, registry, policy, skills: new SkillSet([]),
  agent: { name: "banglaclaw", model: provider.id },
  config: { host: "127.0.0.1", port, corsOrigins: [], maxInputChars: 4_000, trustProxy: false, metrics: false, rateLimit: { requestsPerMinute: 10_000, maxConcurrentRuns: 10 } },
  version: "e2e", logger, timezone: "Asia/Dhaka",
  webChat: true,
  workspace,
  uploads: {
    maxBytes: 1_000_000,
    save: async (owner, file) => {
      const text = new TextDecoder().decode(file.data);
      const path = `uploads/${file.filename.replace(/[^\p{L}\p{M}\p{N}._-]/gu, "_")}`;
      await workspace.write(owner, path, text);
      return { path, characters: text.length };
    },
  },
  transcriber: { id: "e2e:transcriber", transcribe: async (audio) => `ভয়েস থেকে লেখা (${audio.mimeType})` },
  widget: {
    allowedOrigins: [`http://localhost:${port}`], title: "Dokan সহায়তা", greeting: "আসসালামু আলাইকুম! কীভাবে সাহায্য করতে পারি?", color: "#0b6b4f", position: "right",
    messagesPerMinute: 100, sessionsPerMinute: 100, maxInputChars: 1_000, maxConcurrentRuns: 10, visitorTtlDays: 1, secret: "e2e-widget-secret-e2e-widget-secret-00",
  },
  routes: [host],
  ...(existsSync(`${dashboardDir}/index.html`) && { dashboardDir }),
});

writeFileSync(statePath, JSON.stringify({ baseUrl: gateway.url, userKey: user.token, adminKey: admin.token, dashboard: existsSync(`${dashboardDir}/index.html`) }));
process.stdout.write(`e2e gateway on ${gateway.url}\n`);
