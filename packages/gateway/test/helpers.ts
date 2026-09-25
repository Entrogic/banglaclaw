import { AIMessageChunk } from "@langchain/core/messages";
import { AgentRuntime } from "@banglaclaw/agent";
import { ApiKeyAuthenticator, InMemoryAuthStore } from "@banglaclaw/auth";
import { FakeProvider, type ModelProvider, type ScriptedTurn } from "@banglaclaw/providers";
import { InMemoryRunStore, InMemorySessionStore } from "@banglaclaw/session";
import { createLogger } from "@banglaclaw/shared";
import { SkillSet, parseSkill } from "@banglaclaw/skills";
import { AllowlistPolicy, ToolRegistry, builtinTools } from "@banglaclaw/tools";
import type { GatewayConfig, GatewayDeps } from "../src/index.js";

export const silent = createLogger({ write: () => {} });

/** Provider that blocks until released — for concurrency and cancellation tests. */
export class GatedProvider implements ModelProvider {
  readonly id = "gated";
  #release: (() => void) | undefined;
  #onStart: () => void = () => {};
  readonly started = new Promise<void>((resolve) => {
    this.#onStart = resolve;
  });
  release(): void {
    this.#release?.();
  }
  chat(): never {
    throw new Error("not used");
  }
  async *stream(_messages: unknown, options: { signal?: AbortSignal } = {}): AsyncIterable<AIMessageChunk> {
    this.#onStart();
    await new Promise<void>((resolve, reject) => {
      this.#release = resolve;
      options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    });
    yield new AIMessageChunk({ content: "released" });
  }
}

export async function makeDeps(options: { script?: ScriptedTurn[]; provider?: ModelProvider; config?: Partial<GatewayConfig> } = {}) {
  const sessions = new InMemorySessionStore();
  const runs = new InMemoryRunStore();
  const registry = new ToolRegistry();
  for (const tool of builtinTools) registry.register(tool);
  const policy = new AllowlistPolicy(["calculator"]);
  const skills = new SkillSet([parseSkill("---\nname: calculation\ndescription: math\ntools: [calculator]\ntriggers: [calculate]\n---\nUse the calculator.\n")]);
  const provider = options.provider ?? new FakeProvider(options.script ?? [{ content: "Hello from BanglaClaw" }]);
  const runtime = new AgentRuntime({
    provider, registry, policy, sessions, runs, skills,
    limits: { maxIterations: 4, maxToolCalls: 4 }, timeoutMs: 5_000, timezone: "Asia/Dhaka", logger: silent,
  });
  const auth = new ApiKeyAuthenticator(new InMemoryAuthStore());
  const alice = await auth.issueKey("alice");
  const bob = await auth.issueKey("bob");
  const deps: GatewayDeps = {
    runtime, sessions, runs, auth, registry, policy, skills,
    agent: { name: "banglaclaw", model: provider.id },
    config: {
      host: "127.0.0.1", port: 0, corsOrigins: [], maxInputChars: 100, trustProxy: false, metrics: true,
      ...options.config,
      rateLimit: { requestsPerMinute: 1000, maxConcurrentRuns: 2, ...options.config?.rateLimit },
    },
    version: "test",
    logger: silent,
  };
  return { deps, alice: alice.token, bob: bob.token, provider };
}

export function parseSSE(text: string): { event: string; data: unknown }[] {
  return text
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim() ?? "message";
      const data = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
      return { event, data: JSON.parse(data) as unknown };
    });
}
