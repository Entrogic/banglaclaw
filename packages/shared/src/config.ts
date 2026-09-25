import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ConfigError } from "./errors.js";

export const ProviderIdSchema = z.enum(["openai-compatible", "anthropic"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

const DEFAULT_MODELS: Record<ProviderId, string> = {
  "openai-compatible": "gpt-4o-mini",
  anthropic: "claude-sonnet-5",
};

export const ModelConfigSchema = z.strictObject({
  provider: ProviderIdSchema.default("openai-compatible"),
  model: z.string().min(1).optional(),
  baseUrl: z.url().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export const ConfigSchema = z.strictObject({
  agent: z.strictObject({ name: z.string().min(1).default("banglaclaw") }).prefault({}),
  models: z
    .strictObject({ default: ModelConfigSchema.prefault({}) })
    .prefault({}),
  runtime: z
    .strictObject({
      maxIterations: z.int().min(1).max(50).default(6),
      maxToolCalls: z.int().min(0).max(100).default(8),
      timeoutMs: z.int().min(1000).max(600_000).default(60_000),
    })
    .prefault({}),
  tools: z
    .strictObject({ allow: z.array(z.string().min(1)).default(["calculator", "current_datetime"]) })
    .prefault({}),
  timezone: z.string().min(1).default("Asia/Dhaka"),
});

export type BanglaClawConfig = z.infer<typeof ConfigSchema> & {
  models: { default: { model: string } };
};

/** Secrets resolved from the environment only — never from the config file. */
export interface Secrets {
  openaiApiKey?: string;
  anthropicApiKey?: string;
}

export interface LoadConfigOptions {
  /** Path to the YAML config. Defaults to ./banglaclaw.yaml if it exists. */
  path?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface LoadedConfig {
  config: BanglaClawConfig;
  secrets: Secrets;
  /** Absolute path of the file that was read, if any. */
  source?: string;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== "" ? value.trim() : undefined;
}

export function loadConfig(options: LoadConfigOptions = {}): LoadedConfig {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const explicitPath = options.path ?? nonEmpty(env.BANGLACLAW_CONFIG);
  const path = resolve(cwd, explicitPath ?? "banglaclaw.yaml");

  let raw: unknown = {};
  let source: string | undefined;
  if (existsSync(path)) {
    try {
      raw = parseYaml(readFileSync(path, "utf8")) ?? {};
    } catch (error) {
      throw new ConfigError(`Failed to parse ${path}`, { cause: error });
    }
    source = path;
  } else if (explicitPath !== undefined) {
    throw new ConfigError(`Config file not found: ${path}`);
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`${path} must contain a YAML mapping`);
  }

  const withEnv = applyEnvOverrides(raw as Record<string, unknown>, env);
  const result = ConfigSchema.safeParse(withEnv);
  if (!result.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }

  const parsed = result.data;
  const model = parsed.models.default.model ?? DEFAULT_MODELS[parsed.models.default.provider];
  const config: BanglaClawConfig = {
    ...parsed,
    models: { default: { ...parsed.models.default, model } },
  };

  const secrets: Secrets = {};
  const openaiApiKey = nonEmpty(env.OPENAI_API_KEY);
  const anthropicApiKey = nonEmpty(env.ANTHROPIC_API_KEY);
  if (openaiApiKey !== undefined) secrets.openaiApiKey = openaiApiKey;
  if (anthropicApiKey !== undefined) secrets.anthropicApiKey = anthropicApiKey;

  return source !== undefined ? { config, secrets, source } : { config, secrets };
}

function applyEnvOverrides(raw: Record<string, unknown>, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const provider = nonEmpty(env.BANGLACLAW_PROVIDER);
  const model = nonEmpty(env.BANGLACLAW_MODEL);
  const baseUrl = nonEmpty(env.BANGLACLAW_BASE_URL);
  if (provider === undefined && model === undefined && baseUrl === undefined) return raw;

  const models = isRecord(raw.models) ? raw.models : {};
  const current = isRecord(models.default) ? models.default : {};
  const next: Record<string, unknown> = { ...current };
  if (provider !== undefined) {
    // Switching provider via env invalidates a model/baseUrl written for the other provider.
    if (provider !== current.provider) {
      delete next.model;
      delete next.baseUrl;
    }
    next.provider = provider;
  }
  if (model !== undefined) next.model = model;
  if (baseUrl !== undefined) next.baseUrl = baseUrl;
  return { ...raw, models: { ...models, default: next } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
