import { HumanMessage } from "@langchain/core/messages";
import {
  ConfigError,
  ProviderSetupError,
  apiKeyHint,
  applyProviderPatch,
  createLogger,
  newProviderId,
  type ActiveProvider,
  type BanglaClawConfig,
  type Logger,
  type ProviderAdmin,
  type ProviderInput,
  type ProviderProfile,
  type ProviderProfilePatch,
  type ProviderStore,
  type ProviderTestResult,
  type ProviderUpdate,
  type ProviderView,
  type Secrets,
} from "@entrogic-net/shared";
import { createProvider } from "./factory.js";
import { UnconfiguredProvider } from "./unconfigured.js";
import type { ModelProvider } from "./provider.js";

type ModelConfig = BanglaClawConfig["models"]["default"];

/** Encrypts secrets at rest; `SecretBox` from the auth package implements it. */
export interface SecretCipher {
  encrypt(plaintext: string, aad: string): string;
  decrypt(ciphertext: string, aad: string): string;
}

export interface ProviderManagerOptions {
  store: ProviderStore;
  /** Absent when BANGLACLAW_SECRET_KEY is not set: profiles can then not hold an API key. */
  cipher?: SecretCipher;
  /** The config/env provider, used while no profile is active. */
  config: ModelConfig;
  secrets: Secrets;
  /** Whether the store survives a restart (postgres). */
  persistent: boolean;
  logger?: Logger;
  /** Builds a provider; defaults to {@link createProvider} (tests inject fakes). */
  build?: (model: ModelConfig, secrets: Secrets) => ModelProvider;
  testTimeoutMs?: number;
}

/**
 * Model providers added from the dashboard (docs/12, ADR-0019). Holds the provider new runs use:
 * the active stored profile, else the config/env one. The agent runtime calls {@link current} once
 * per run, so a switch applies from the next run and never in the middle of one.
 */
export class ProviderManager implements ProviderAdmin {
  readonly #options: ProviderManagerOptions;
  readonly #logger: Logger;
  readonly #build: (model: ModelConfig, secrets: Secrets) => ModelProvider;
  #current: { provider: ModelProvider; info: ActiveProvider } | undefined;

  private constructor(options: ProviderManagerOptions) {
    this.#options = options;
    this.#logger = options.logger ?? createLogger({ level: "warn" });
    this.#build = options.build ?? createProvider;
  }

  /**
   * Uses the active stored profile when it can be built; otherwise the config provider. When that
   * has no key either, it starts with an {@link UnconfiguredProvider} instead of failing, so the
   * gateway can start and an admin can add a provider in the dashboard; until then runs fail with
   * a message that says how to set one up.
   */
  static async open(options: ProviderManagerOptions): Promise<ProviderManager> {
    const manager = new ProviderManager(options);
    const active = await options.store.active();
    if (active !== undefined) {
      try {
        manager.#use(active, manager.#fromProfile(active));
        return manager;
      } catch (error) {
        manager.#logger.warn("active provider profile unusable; using the config provider", { profile: active.name, error: error instanceof Error ? error.message : String(error) });
      }
    }
    manager.#current = manager.#configOrPlaceholder();
    return manager;
  }

  current(): ModelProvider {
    if (this.#current === undefined) throw new Error("ProviderManager used before open()");
    return this.#current.provider;
  }

  /**
   * A provider for other work than agent runs (an eval judge): the profile `id`, or the current
   * provider when absent. Undefined for an unknown id; ProviderSetupError when it cannot be built.
   */
  async providerFor(id?: string): Promise<ModelProvider | undefined> {
    if (id === undefined) return this.current();
    const profile = await this.#options.store.get(id);
    return profile === undefined ? undefined : this.#fromProfile(profile);
  }

  status(): { active: ActiveProvider; persistent: boolean; encryption: boolean } {
    if (this.#current === undefined) throw new Error("ProviderManager used before open()");
    return { active: { ...this.#current.info }, persistent: this.#options.persistent, encryption: this.#options.cipher !== undefined };
  }

  async list(): Promise<ProviderView[]> {
    return (await this.#options.store.list()).map(toView);
  }

  async create(input: ProviderInput): Promise<ProviderView> {
    const id = newProviderId();
    const key = input.apiKey?.trim();
    const profile: ProviderProfile = {
      id,
      name: input.name,
      provider: input.provider,
      model: input.model,
      ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(key !== undefined && key !== "" && { apiKeyCiphertext: this.#seal(key, id), apiKeyHint: apiKeyHint(key) }),
      ...(input.createdBy !== undefined && { createdBy: input.createdBy }),
      active: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // Fails early on a profile that could never run (no key for a hosted API).
    this.#fromProfile(profile);
    const { active: _a, createdAt: _c, updatedAt: _u, ...fields } = profile;
    return toView(await this.#options.store.create(fields));
  }

  async update(id: string, patch: ProviderUpdate): Promise<ProviderView | undefined> {
    const current = await this.#options.store.get(id);
    if (current === undefined) return undefined;
    const changes: ProviderProfilePatch = {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.model !== undefined && { model: patch.model }),
      ...(patch.baseUrl !== undefined && { baseUrl: patch.baseUrl }),
      ...(patch.temperature !== undefined && { temperature: patch.temperature }),
    };
    if (patch.apiKey === null || patch.apiKey?.trim() === "") Object.assign(changes, { apiKeyCiphertext: null, apiKeyHint: null });
    else if (patch.apiKey !== undefined) Object.assign(changes, { apiKeyCiphertext: this.#seal(patch.apiKey.trim(), id), apiKeyHint: apiKeyHint(patch.apiKey) });

    const next = applyProviderPatch(current, changes);
    const provider = this.#fromProfile(next);
    const updated = await this.#options.store.update(id, changes);
    if (updated === undefined) return undefined;
    if (updated.active) this.#use(updated, provider);
    return toView(updated);
  }

  async delete(id: string): Promise<boolean> {
    const profile = await this.#options.store.get(id);
    if (profile === undefined) return false;
    if (profile.active) await this.activate(undefined);
    return this.#options.store.delete(id);
  }

  async activate(id: string | undefined): Promise<ActiveProvider | undefined> {
    if (id === undefined) {
      await this.#options.store.setActive(undefined);
      this.#current = this.#configOrPlaceholder();
      this.#logger.info("provider switched", { source: "config", provider: this.#current.provider.id });
      return { ...this.#current.info };
    }
    const profile = await this.#options.store.get(id);
    if (profile === undefined) return undefined;
    const provider = this.#fromProfile(profile);
    await this.#options.store.setActive(id);
    return { ...this.#use(profile, provider) };
  }

  async test(id: string): Promise<ProviderTestResult | undefined> {
    const profile = await this.#options.store.get(id);
    if (profile === undefined) return undefined;
    const timeoutMs = this.#options.testTimeoutMs ?? 20_000;
    const signal = AbortSignal.timeout(timeoutMs);
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    let key: string | undefined;
    try {
      key = this.#keyOf(profile);
      const provider = this.#fromProfile(profile);
      const reply = await provider.chat([new HumanMessage("Reply with the single word OK.")], { signal });
      return { ok: true, latencyMs: elapsed(), reply: reply.text.slice(0, 200) };
    } catch (error) {
      let message = signal.aborted ? `No answer within ${timeoutMs / 1000}s (check the base URL, model name and network)` : error instanceof Error ? error.message : String(error);
      // Provider errors sometimes echo the key; never return it.
      if (key !== undefined && key !== "") message = message.split(key).join("[redacted]");
      return { ok: false, latencyMs: elapsed(), error: message.slice(0, 300) };
    }
  }

  #use(profile: ProviderProfile, provider: ModelProvider): ActiveProvider {
    const info: ActiveProvider = { source: "stored", providerId: provider.id, profileId: profile.id, name: profile.name };
    this.#current = { provider, info };
    this.#logger.info("provider in use", { source: "stored", profile: profile.name, provider: provider.id });
    return info;
  }

  /** The config/env provider, or a placeholder (with the reason) when it has no key. */
  #configOrPlaceholder(): { provider: ModelProvider; info: ActiveProvider } {
    try {
      const provider = this.#build(this.#options.config, this.#options.secrets);
      return { provider, info: { source: "config", providerId: provider.id } };
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      const placeholder = new UnconfiguredProvider(error.message);
      this.#logger.warn("no usable model provider; runs fail until one is configured", { reason: error.message });
      return { provider: placeholder, info: { source: "config", providerId: placeholder.id, error: placeholder.message } };
    }
  }

  /** A profile without its own key uses the matching key from the environment, if any. */
  #fromProfile(profile: ProviderProfile): ModelProvider {
    const key = this.#keyOf(profile);
    const model: ModelConfig = {
      provider: profile.provider,
      model: profile.model,
      ...(profile.baseUrl !== undefined && { baseUrl: profile.baseUrl }),
      ...(profile.temperature !== undefined && { temperature: profile.temperature }),
    };
    const env = this.#options.secrets;
    const secrets: Secrets =
      profile.provider === "anthropic"
        ? { ...((key ?? env.anthropicApiKey) !== undefined && { anthropicApiKey: key ?? env.anthropicApiKey }) }
        : { ...((key ?? env.openaiApiKey) !== undefined && { openaiApiKey: key ?? env.openaiApiKey }) };
    try {
      return this.#build(model, secrets);
    } catch (error) {
      if (error instanceof ConfigError) {
        throw new ProviderSetupError(profile.provider === "anthropic" ? "An API key is required for Anthropic" : "An API key is required (or set a base URL for a keyless OpenAI-compatible server)");
      }
      throw error;
    }
  }

  #keyOf(profile: ProviderProfile): string | undefined {
    if (profile.apiKeyCiphertext === undefined) return undefined;
    const cipher = this.#options.cipher;
    if (cipher === undefined) throw new ProviderSetupError("BANGLACLAW_SECRET_KEY is not set, so the stored API key cannot be read");
    try {
      return cipher.decrypt(profile.apiKeyCiphertext, profile.id);
    } catch {
      throw new ProviderSetupError("The stored API key cannot be decrypted (was BANGLACLAW_SECRET_KEY changed?); enter the key again");
    }
  }

  #seal(key: string, id: string): string {
    if (this.#options.cipher === undefined) throw new ProviderSetupError("Set BANGLACLAW_SECRET_KEY on the server to store API keys");
    return this.#options.cipher.encrypt(key, id);
  }
}

export function toView(p: ProviderProfile): ProviderView {
  return {
    id: p.id,
    name: p.name,
    provider: p.provider,
    model: p.model,
    ...(p.baseUrl !== undefined && { baseUrl: p.baseUrl }),
    ...(p.temperature !== undefined && { temperature: p.temperature }),
    hasApiKey: p.apiKeyCiphertext !== undefined,
    ...(p.apiKeyHint !== undefined && { apiKeyHint: p.apiKeyHint }),
    active: p.active,
    ...(p.createdBy !== undefined && { createdBy: p.createdBy }),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
