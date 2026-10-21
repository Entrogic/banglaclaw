import { randomUUID } from "node:crypto";
import type { ProviderId } from "./config.js";
import { BanglaClawError } from "./errors.js";

/**
 * A model provider added at runtime from the dashboard (docs/12, ADR-0019). The API key is stored
 * only as `apiKeyCiphertext` (AES-256-GCM, BANGLACLAW_SECRET_KEY); `apiKeyHint` is the masked form
 * shown to admins. At most one profile is active; with none, the config/env provider is used.
 */
export interface ProviderProfile {
  id: string;
  name: string;
  provider: ProviderId;
  model: string;
  baseUrl?: string;
  temperature?: number;
  apiKeyCiphertext?: string;
  apiKeyHint?: string;
  active: boolean;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type NewProviderProfile = Omit<ProviderProfile, "active" | "createdAt" | "updatedAt">;

/** Fields an update may change; `null` clears an optional field. */
export interface ProviderProfilePatch {
  name?: string;
  model?: string;
  baseUrl?: string | null;
  temperature?: number | null;
  apiKeyCiphertext?: string | null;
  apiKeyHint?: string | null;
}

export interface ProviderStore {
  /** Oldest first. */
  list(): Promise<ProviderProfile[]>;
  get(id: string): Promise<ProviderProfile | undefined>;
  /** Throws {@link DuplicateProviderNameError} when the name is taken. */
  create(profile: NewProviderProfile): Promise<ProviderProfile>;
  update(id: string, patch: ProviderProfilePatch): Promise<ProviderProfile | undefined>;
  delete(id: string): Promise<boolean>;
  active(): Promise<ProviderProfile | undefined>;
  /** Makes `id` the only active profile, or deactivates all with `undefined`. False if `id` is unknown. */
  setActive(id: string | undefined): Promise<boolean>;
}

export class DuplicateProviderNameError extends BanglaClawError {
  constructor(name: string) {
    super("DUPLICATE_PROVIDER_NAME", `A provider named "${name}" already exists`);
  }
}

/** A provider profile that cannot be used as given (missing key, no encryption key, bad model). The message is safe to show. */
export class ProviderSetupError extends BanglaClawError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("PROVIDER_SETUP", message, options);
  }
}

/** A profile as admins see it: never the key or its ciphertext. */
export interface ProviderView {
  id: string;
  name: string;
  provider: ProviderId;
  model: string;
  baseUrl?: string;
  temperature?: number;
  hasApiKey: boolean;
  apiKeyHint?: string;
  active: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderInput {
  name: string;
  provider: ProviderId;
  model: string;
  baseUrl?: string;
  temperature?: number;
  apiKey?: string;
  createdBy?: string;
}

/** `null` clears a field (the API key, base URL or temperature). */
export interface ProviderUpdate {
  name?: string;
  model?: string;
  baseUrl?: string | null;
  temperature?: number | null;
  apiKey?: string | null;
}

/** Which provider new runs use: the config/env one, or a stored profile. */
export interface ActiveProvider {
  source: "config" | "stored";
  /** e.g. "anthropic:claude-sonnet-5". */
  providerId: string;
  profileId?: string;
  name?: string;
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  reply?: string;
  error?: string;
}

/** Runtime provider management behind /v1/admin/providers; implemented by `ProviderManager` (providers package). */
export interface ProviderAdmin {
  status(): { active: ActiveProvider; persistent: boolean; encryption: boolean };
  list(): Promise<ProviderView[]>;
  create(input: ProviderInput): Promise<ProviderView>;
  update(id: string, patch: ProviderUpdate): Promise<ProviderView | undefined>;
  delete(id: string): Promise<boolean>;
  /** `undefined` goes back to the config provider. Returns undefined for an unknown id. */
  activate(id: string | undefined): Promise<ActiveProvider | undefined>;
  /** Sends a short prompt with the profile; undefined for an unknown id. */
  test(id: string): Promise<ProviderTestResult | undefined>;
}

/** Masked form of an API key for display: a short prefix and the last four characters. */
export function apiKeyHint(key: string): string {
  const k = key.trim();
  if (k.length < 12) return "…" + k.slice(-2);
  const dash = k.indexOf("-");
  const prefix = dash > 0 && dash <= 8 ? k.slice(0, dash + 1) : k.slice(0, 3);
  return `${prefix}…${k.slice(-4)}`;
}

export const newProviderId = (): string => randomUUID();

export class InMemoryProviderStore implements ProviderStore {
  readonly #profiles = new Map<string, ProviderProfile>();

  async list(): Promise<ProviderProfile[]> {
    return [...this.#profiles.values()].map((p) => ({ ...p }));
  }

  async get(id: string): Promise<ProviderProfile | undefined> {
    const p = this.#profiles.get(id);
    return p === undefined ? undefined : { ...p };
  }

  async create(profile: NewProviderProfile): Promise<ProviderProfile> {
    if ([...this.#profiles.values()].some((p) => p.name === profile.name)) throw new DuplicateProviderNameError(profile.name);
    const now = new Date();
    const created: ProviderProfile = { ...profile, active: false, createdAt: now, updatedAt: now };
    this.#profiles.set(created.id, created);
    return { ...created };
  }

  async update(id: string, patch: ProviderProfilePatch): Promise<ProviderProfile | undefined> {
    const current = this.#profiles.get(id);
    if (current === undefined) return undefined;
    if (patch.name !== undefined && [...this.#profiles.values()].some((p) => p.id !== id && p.name === patch.name)) throw new DuplicateProviderNameError(patch.name);
    const next: ProviderProfile = { ...applyProviderPatch(current, patch), updatedAt: new Date() };
    this.#profiles.set(id, next);
    return { ...next };
  }

  async delete(id: string): Promise<boolean> {
    return this.#profiles.delete(id);
  }

  async active(): Promise<ProviderProfile | undefined> {
    const p = [...this.#profiles.values()].find((x) => x.active);
    return p === undefined ? undefined : { ...p };
  }

  async setActive(id: string | undefined): Promise<boolean> {
    if (id !== undefined && !this.#profiles.has(id)) return false;
    for (const p of this.#profiles.values()) p.active = p.id === id;
    return true;
  }
}

/** The profile with `patch` applied; `null` removes an optional field. */
export function applyProviderPatch(profile: ProviderProfile, patch: ProviderProfilePatch): ProviderProfile {
  const { baseUrl, temperature, apiKeyCiphertext, apiKeyHint, ...rest } = profile;
  const pick = <T>(value: T | null | undefined, current: T | undefined): T | undefined => (value === null ? undefined : (value ?? current));
  const next = { baseUrl: pick(patch.baseUrl, baseUrl), temperature: pick(patch.temperature, temperature), apiKeyCiphertext: pick(patch.apiKeyCiphertext, apiKeyCiphertext), apiKeyHint: pick(patch.apiKeyHint, apiKeyHint) };
  return {
    ...rest,
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.model !== undefined && { model: patch.model }),
    ...(next.baseUrl !== undefined && { baseUrl: next.baseUrl }),
    ...(next.temperature !== undefined && { temperature: next.temperature }),
    ...(next.apiKeyCiphertext !== undefined && { apiKeyCiphertext: next.apiKeyCiphertext }),
    ...(next.apiKeyHint !== undefined && { apiKeyHint: next.apiKeyHint }),
  };
}
