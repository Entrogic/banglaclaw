import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "@banglaclaw/agent";
import { FakeProvider } from "@banglaclaw/providers";
import { InMemoryRunStore, InMemorySessionStore, type Session } from "@banglaclaw/session";
import { ConfigError, createLogger, loadConfig } from "@banglaclaw/shared";
import { AllowlistPolicy, ToolRegistry } from "@banglaclaw/tools";
import { createDeliver, createTranscriber, setupChannels } from "../src/channels.js";

const silent = createLogger({ write: () => {} });
const MESSENGER_ENV = { MESSENGER_PAGE_ACCESS_TOKEN: "page-token", MESSENGER_APP_SECRET: "secret", MESSENGER_VERIFY_TOKEN: "verify-me" };

function loaded(yaml: string, env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "bc-channels-"));
  writeFileSync(join(dir, "banglaclaw.yaml"), yaml);
  return loadConfig({ cwd: dir, env });
}

function runtime() {
  const sessions = new InMemorySessionStore();
  const rt = new AgentRuntime({
    provider: new FakeProvider([{ content: "hi" }]), registry: new ToolRegistry(), policy: new AllowlistPolicy([]), sessions, runs: new InMemoryRunStore(),
    limits: { maxIterations: 2, maxToolCalls: 2 }, timeoutMs: 5_000, timezone: "Asia/Dhaka", logger: silent,
  });
  return { rt, sessions };
}

afterEach(() => vi.unstubAllGlobals());

describe("Messenger channel wiring", () => {
  const yaml = "channels:\n  messenger:\n    enabled: true\n    pageId: \"4455\"\n    access: open\n    humanAgentTag: true\n";

  it("fails fast when secrets are missing", () => {
    const { rt, sessions } = runtime();
    expect(() => setupChannels(loaded(yaml, { MESSENGER_APP_SECRET: "s" }), rt, sessions, silent)).toThrow(ConfigError);
    expect(() => setupChannels(loaded(yaml, { MESSENGER_APP_SECRET: "s" }), rt, sessions, silent)).toThrow(/MESSENGER_PAGE_ACCESS_TOKEN, MESSENGER_VERIFY_TOKEN/);
  });

  it("mounts the webhook with the configured verify token", async () => {
    const { rt, sessions } = runtime();
    const setup = setupChannels(loaded(yaml, MESSENGER_ENV), rt, sessions, silent);
    expect(setup.summary.some((s) => s.includes("/channels/messenger/webhook"))).toBe(true);
    expect(setup.warnings).toEqual([]);
    const res = await setup.routes[0]?.request("/channels/messenger/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42");
    expect(await res?.text()).toBe("42");
  });

  it("delivers operator replies to Messenger users with the HUMAN_AGENT tag", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 200 });
    });
    const deliver = createDeliver(loaded(yaml, MESSENGER_ENV), silent);
    const session = { id: "s1", channel: "messenger", externalId: "7001" } as Session;
    expect(await deliver(session, "আমি অপারেটর")).toBe(true);
    expect(calls[0]?.url).toBe("https://graph.facebook.com/v21.0/me/messages");
    expect(calls[0]?.body).toEqual({ recipient: { id: "7001" }, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT", message: { text: "আমি অপারেটর" } });
    expect(await deliver({ ...session, channel: "api" }, "x")).toBe(false);
  });
});

describe("voice wiring", () => {
  const yaml = "voice:\n  enabled: true\nchannels:\n  messenger:\n    enabled: true\n    access: open\n";

  it("needs a transcription key unless a keyless base URL is set", () => {
    expect(() => createTranscriber(loaded(yaml, MESSENGER_ENV))).toThrow(/TRANSCRIPTION_API_KEY/);
    expect(createTranscriber(loaded(yaml, { ...MESSENGER_ENV, OPENAI_API_KEY: "sk-x" }))?.id).toBe("openai-compatible:whisper-1");
    expect(createTranscriber(loaded("voice:\n  enabled: true\n  model: large-v3\n  baseUrl: http://localhost:8000/v1\n", {}))?.id).toBe("openai-compatible:large-v3");
    expect(createTranscriber(loaded("{}", {}))).toBeUndefined();
  });

  it("gives channel routers the transcriber and reports it at startup", () => {
    const { rt, sessions } = runtime();
    const setup = setupChannels(loaded(yaml, { ...MESSENGER_ENV, TRANSCRIPTION_API_KEY: "sk-t" }), rt, sessions, silent);
    expect(setup.summary).toContain("voice notes: openai-compatible:whisper-1 (up to 120 s)");
  });
});

