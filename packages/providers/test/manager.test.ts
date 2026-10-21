import { describe, expect, it } from "vitest";
import { ConfigError, InMemoryProviderStore, ProviderSetupError, createLogger, type Secrets } from "@entrogic-net/shared";
import { FakeProvider, ProviderManager, type ModelProvider, type SecretCipher } from "../src/index.js";

const silent = createLogger({ write: () => {} });

/** Reversible stand-in for SecretBox that still binds to the row id. */
const cipher: SecretCipher = {
  encrypt: (plain, aad) => `enc:${aad}:${Buffer.from(plain).toString("base64")}`,
  decrypt: (sealed, aad) => {
    const [tag, row, data] = sealed.split(":");
    if (tag !== "enc" || row !== aad || data === undefined) throw new Error("bad");
    return Buffer.from(data, "base64").toString();
  },
};

/** Records what each built provider was given, and fails like createProvider when a hosted API has no key. */
function builder() {
  const built: { id: string; secrets: Secrets }[] = [];
  const build = (model: { provider: string; model?: string; baseUrl?: string }, secrets: Secrets): ModelProvider => {
    const key = model.provider === "anthropic" ? secrets.anthropicApiKey : secrets.openaiApiKey;
    if (key === undefined && (model.provider === "anthropic" || model.baseUrl === undefined)) throw new ConfigError("no key");
    const id = `${model.provider}:${model.model ?? ""}`;
    built.push({ id, secrets });
    return Object.assign(new FakeProvider([{ content: "OK" }]), { id });
  };
  return { built, build };
}

async function open(options: { secrets?: Secrets; store?: InMemoryProviderStore; withCipher?: boolean } = {}) {
  const store = options.store ?? new InMemoryProviderStore();
  const { built, build } = builder();
  const manager = await ProviderManager.open({
    store, config: { provider: "openai-compatible", model: "gpt-4o-mini" }, secrets: options.secrets ?? { openaiApiKey: "sk-env-key-000000" },
    persistent: false, logger: silent, build, ...(options.withCipher !== false && { cipher }),
  });
  return { manager, store, built };
}

describe("ProviderManager", () => {
  it("starts on the config provider and switches to a stored profile for new runs", async () => {
    const { manager, store, built } = await open();
    expect(manager.status().active).toEqual({ source: "config", providerId: "openai-compatible:gpt-4o-mini" });

    const view = await manager.create({ name: "Claude", provider: "anthropic", model: "claude-sonnet-5", apiKey: "sk-ant-api03-abcdefghijkl" });
    expect(view).toMatchObject({ name: "Claude", hasApiKey: true, apiKeyHint: "sk-…ijkl", active: false });
    expect(JSON.stringify(view)).not.toContain("abcdefghijkl");
    expect((await store.get(view.id))?.apiKeyCiphertext).toMatch(/^enc:/);

    const before = manager.current();
    expect(await manager.activate(view.id)).toEqual({ source: "stored", providerId: "anthropic:claude-sonnet-5", profileId: view.id, name: "Claude" });
    expect(manager.current()).not.toBe(before);
    expect(manager.current().id).toBe("anthropic:claude-sonnet-5");
    expect(built.at(-1)?.secrets).toEqual({ anthropicApiKey: "sk-ant-api03-abcdefghijkl" });

    // Going back to the config provider.
    expect(await manager.activate(undefined)).toMatchObject({ source: "config" });
    expect((await store.active())).toBeUndefined();
  });

  it("restores the active profile on open and falls back when it is unusable", async () => {
    const first = await open();
    const view = await first.manager.create({ name: "Groq", provider: "openai-compatible", model: "llama-3.3", baseUrl: "https://api.groq.com/openai/v1", apiKey: "gsk_abcdefghijklmnop" });
    await first.manager.activate(view.id);

    const again = await open({ store: first.store });
    expect(again.manager.current().id).toBe("openai-compatible:llama-3.3");

    // Without the secret key the stored key cannot be read: use the config provider and say so.
    const noKey = await open({ store: first.store, withCipher: false });
    expect(noKey.manager.status()).toMatchObject({ active: { source: "config" }, encryption: false });
  });

  it("validates profiles before storing or activating them", async () => {
    // No config key and nothing stored: startup fails as before.
    await expect(open({ secrets: {} })).rejects.toThrow(ConfigError);

    const ok = await open();
    await expect(ok.manager.create({ name: "Claude", provider: "anthropic", model: "claude-sonnet-5" })).rejects.toThrow(ProviderSetupError);
    // A keyless local server is fine; a hosted OpenAI-compatible profile uses the env key when it has none.
    await expect(ok.manager.create({ name: "Ollama", provider: "openai-compatible", model: "qwen3", baseUrl: "http://localhost:11434/v1" })).resolves.toMatchObject({ hasApiKey: false });
    await expect(ok.manager.create({ name: "OpenAI", provider: "openai-compatible", model: "gpt-5" })).resolves.toMatchObject({ hasApiKey: false });
    await expect(ok.manager.create({ name: "Ollama", provider: "openai-compatible", model: "x", baseUrl: "http://localhost:1/v1" })).rejects.toThrow(/already exists/);

    const plain = await open({ withCipher: false });
    await expect(plain.manager.create({ name: "Claude", provider: "anthropic", model: "claude-sonnet-5", apiKey: "sk-ant-xxxxxxxxxxxx" })).rejects.toThrow(/BANGLACLAW_SECRET_KEY/);
  });

  it("rebuilds the active provider on update, and switches to config when it is deleted", async () => {
    const { manager, store } = await open();
    const view = await manager.create({ name: "Claude", provider: "anthropic", model: "claude-sonnet-5", apiKey: "sk-ant-api03-abcdefghijkl" });
    await manager.activate(view.id);
    await manager.update(view.id, { model: "claude-opus-5-5" });
    expect(manager.current().id).toBe("anthropic:claude-opus-5-5");
    // Clearing the only key of an Anthropic profile would break it, so the update is refused and nothing changes.
    await expect(manager.update(view.id, { apiKey: null })).rejects.toThrow(ProviderSetupError);
    expect((await store.get(view.id))?.apiKeyHint).toBe("sk-…ijkl");

    expect(await manager.delete(view.id)).toBe(true);
    expect(manager.status().active.source).toBe("config");
    expect(await manager.list()).toEqual([]);
    expect(await manager.update("missing", { model: "x" })).toBeUndefined();
    expect(await manager.activate("missing")).toBeUndefined();
  });

  it("tests a profile and never echoes its key", async () => {
    const store = new InMemoryProviderStore();
    const manager = await ProviderManager.open({
      store, cipher, config: { provider: "openai-compatible", model: "gpt-4o-mini" }, secrets: { openaiApiKey: "sk-env-key-000000" }, persistent: true, logger: silent,
      build: (model, secrets) => ({
        id: `${model.provider}:${model.model ?? ""}`,
        chat: () => (model.model === "bad" ? Promise.reject(new Error(`401 Incorrect API key ${secrets.openaiApiKey ?? ""}`)) : new FakeProvider([{ content: "OK" }]).chat([])),
        stream: () => new FakeProvider([]).stream([]),
      }),
    });
    const good = await manager.create({ name: "good", provider: "openai-compatible", model: "gpt-5" });
    const bad = await manager.create({ name: "bad", provider: "openai-compatible", model: "bad", apiKey: "sk-proj-supersecretvalue" });
    expect(await manager.test(good.id)).toMatchObject({ ok: true, reply: "OK" });
    const failed = await manager.test(bad.id);
    expect(failed).toMatchObject({ ok: false });
    expect(failed?.error).toContain("[redacted]");
    expect(failed?.error).not.toContain("supersecretvalue");
  });

  it("reports a test that gets no answer in time", async () => {
    const manager = await ProviderManager.open({
      store: new InMemoryProviderStore(), config: { provider: "openai-compatible", model: "gpt-4o-mini" }, secrets: { openaiApiKey: "sk-env-key-000000" }, persistent: false, logger: silent, testTimeoutMs: 20,
      build: (model) => ({
        id: `${model.provider}:${model.model ?? ""}`,
        chat: (_m, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("Request was aborted.")))),
        stream: () => new FakeProvider([]).stream([]),
      }),
    });
    const slow = await manager.create({ name: "slow", provider: "openai-compatible", model: "x", baseUrl: "http://127.0.0.1:9/v1" });
    expect((await manager.test(slow.id))?.error).toMatch(/^No answer within 0.02s/);
  });
});
