import { AgentRuntime } from "@banglaclaw/agent";
import { FakeProvider, type ModelProvider, type ScriptedTurn } from "@banglaclaw/providers";
import { InMemoryRunStore, InMemorySessionStore } from "@banglaclaw/session";
import { createLogger } from "@banglaclaw/shared";
import { AllowlistPolicy, ToolRegistry } from "@banglaclaw/tools";
import { ChannelRouter, type AccessPolicy, type ChannelAdapter, type VoiceOptions } from "../src/index.js";

export const silent = createLogger({ write: () => {} });

export function makeRouter(options: { script?: ScriptedTurn[]; provider?: ModelProvider; access?: AccessPolicy; rateLimitPerMinute?: number; voice?: VoiceOptions } = {}) {
  const sessions = new InMemorySessionStore();
  const fake = new FakeProvider(options.script ?? [{ content: "reply" }]);
  const provider = options.provider ?? fake;
  const runtime = new AgentRuntime({
    provider, registry: new ToolRegistry(), policy: new AllowlistPolicy([]), sessions, runs: new InMemoryRunStore(),
    limits: { maxIterations: 3, maxToolCalls: 3 }, timeoutMs: 5_000, timezone: "Asia/Dhaka", logger: silent,
  });
  const router = new ChannelRouter({
    runtime, sessions, agentName: "banglaclaw",
    access: options.access ?? { access: "allowlist", allowed: ["100"] },
    rateLimitPerMinute: options.rateLimitPerMinute ?? 100,
    logger: silent,
    ...(options.voice !== undefined && { voice: options.voice }),
  });
  return { router, sessions, provider: fake };
}

export class RecordingAdapter implements ChannelAdapter {
  readonly name = "test";
  readonly sent: [string, string][] = [];
  typingCount = 0;
  constructor(readonly maxMessageLength = 4096) {}
  async send(conversationId: string, text: string) {
    this.sent.push([conversationId, text]);
  }
  async typing() {
    this.typingCount++;
  }
}

/** fetch stub that records Bot/Graph API calls and answers from a handler. */
export function fakeFetch(handler: (url: string, body: Record<string, unknown>) => unknown | Promise<unknown>) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    const result = await handler(url, body);
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { fn, calls };
}
