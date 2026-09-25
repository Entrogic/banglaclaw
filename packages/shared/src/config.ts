import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

const McpCommonSchema = {
  enabled: z.boolean().default(true),
  /** Per tool-call timeout. */
  timeoutMs: z.int().min(100).max(600_000).default(30_000),
  /** Timeout for connecting and listing tools. */
  connectTimeoutMs: z.int().min(100).max(120_000).default(15_000),
};

/** Values may reference environment variables as ${VAR}; they are expanded at connect time. */
const EnvMapSchema = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string());

export const McpServerConfigSchema = z.discriminatedUnion("transport", [
  z.strictObject({
    transport: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    /** Extra environment for the server process. Only safe defaults (PATH, HOME, …) are inherited. */
    env: EnvMapSchema.default({}),
    /** Working directory, relative to the config file. */
    cwd: z.string().min(1).optional(),
    ...McpCommonSchema,
  }),
  z.strictObject({
    transport: z.literal("http"),
    url: z.url(),
    headers: EnvMapSchema.default({}),
    ...McpCommonSchema,
  }),
]);
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

const AccessSchema = z.enum(["allowlist", "open"]);

export const TelegramChannelSchema = z.strictObject({
  enabled: z.boolean().default(false),
  /** polling: no public URL needed. webhook: Telegram POSTs to <webhookUrl>/channels/telegram/webhook on the gateway. */
  mode: z.enum(["polling", "webhook"]).default("polling"),
  /** Public HTTPS base URL of the gateway (webhook mode), e.g. https://bot.example.com */
  webhookUrl: z.url().optional(),
  /** allowlist: only allowedUserIds are answered. open: anyone (rate limits still apply). */
  access: AccessSchema.default("allowlist"),
  allowedUserIds: z.array(z.union([z.int(), z.string().regex(/^\d+$/)]).transform(String)).default([]),
  /** Messages per chat per minute. */
  rateLimitPerMinute: z.int().min(1).max(1_000).default(10),
});

export const WhatsAppChannelSchema = z.strictObject({
  enabled: z.boolean().default(false),
  /** WhatsApp Cloud API phone number id (not the phone number). */
  phoneNumberId: z.string().regex(/^\d+$/).optional(),
  graphApiVersion: z.string().regex(/^v\d+\.\d+$/).default("v21.0"),
  access: AccessSchema.default("allowlist"),
  /** Sender numbers in international format without "+", e.g. 8801712345678. */
  allowedNumbers: z.array(z.string().regex(/^\d{6,15}$/)).default([]),
  rateLimitPerMinute: z.int().min(1).max(1_000).default(10),
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
    // Knowledge/memory tools only exist when those features are enabled, so allowing them by default is safe.
    .strictObject({ allow: z.array(z.string().min(1)).default(["calculator", "current_datetime", "search_knowledge", "remember", "recall", "forget"]) })
    .prefault({}),
  timezone: z.string().min(1).default("Asia/Dhaka"),
  storage: z
    .strictObject({
      /** memory: zero-setup, lost on exit. postgres: requires DATABASE_URL. */
      provider: z.enum(["memory", "postgres"]).default("memory"),
      /** LangGraph checkpoints per run (postgres storage only). */
      checkpoints: z.boolean().default(true),
    })
    .prefault({}),
  memory: z
    .strictObject({
      /** Short-term memory window: most recent session messages sent to the model. */
      maxHistoryMessages: z.int().min(0).max(500).default(20),
      /** Long-term memory: remember/recall/forget tools, scoped to the session owner. */
      longTerm: z
        .strictObject({
          enabled: z.boolean().default(false),
          /** Add the most relevant memories to the system prompt before each run. */
          autoRecall: z.boolean().default(true),
          recallLimit: z.int().min(1).max(50).default(5),
          maxPerOwner: z.int().min(1).max(10_000).default(200),
          collection: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default("banglaclaw_memories"),
        })
        .prefault({}),
    })
    .prefault({}),
  embeddings: z
    .strictObject({
      /** OpenAI-compatible /embeddings endpoint (OpenAI, Ollama, vLLM, …). */
      provider: z.literal("openai-compatible").default("openai-compatible"),
      model: z.string().min(1).default("text-embedding-3-small"),
      /** Output dimensions (models that support shortening, e.g. text-embedding-3-*). */
      dimensions: z.int().min(8).max(8192).optional(),
      baseUrl: z.url().optional(),
    })
    .prefault({}),
  knowledge: z
    .strictObject({
      enabled: z.boolean().default(false),
      /** memory: rebuilt from `sources` on each start. qdrant: persistent (needs vectorStoreUrl). */
      vectorStore: z.enum(["memory", "qdrant"]).default("memory"),
      /** Qdrant URL; also used by long-term memory. */
      vectorStoreUrl: z.url().default("http://localhost:6333"),
      collection: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default("banglaclaw_knowledge"),
      /** Files/directories (relative to the config file) ingested on startup; unchanged files are skipped. */
      sources: z.array(z.string().min(1)).default([]),
      chunkSize: z.int().min(200).max(8_000).default(1_200),
      chunkOverlap: z.int().min(0).max(2_000).default(150),
      searchLimit: z.int().min(1).max(50).default(5),
      /** Hits below this cosine similarity are dropped. */
      minScore: z.number().min(-1).max(1).default(0.2),
    })
    .prefault({}),
  skills: z
    .strictObject({
      /** Directories (relative to the config file / cwd) scanned for <name>/SKILL.md. */
      dirs: z.array(z.string().min(1)).default(["skills"]),
      /** Maximum skills activated for a single message. */
      maxActive: z.int().min(0).max(10).default(2),
    })
    .prefault({}),
  gateway: z
    .strictObject({
      /** Bind address. Keep 127.0.0.1 unless the gateway sits behind a reverse proxy. */
      host: z.string().min(1).default("127.0.0.1"),
      port: z.int().min(0).max(65_535).default(3000),
      /** Allowed browser origins for CORS; empty disables CORS. */
      corsOrigins: z.array(z.string().min(1)).default([]),
      /** Maximum characters per message. */
      maxInputChars: z.int().min(1).max(100_000).default(8_000),
      /** Take the client IP from X-Forwarded-For (only behind a trusted reverse proxy). */
      trustProxy: z.boolean().default(false),
      /** Serve Prometheus metrics at GET /metrics (protect with METRICS_TOKEN or the network). */
      metrics: z.boolean().default(true),
      rateLimit: z
        .strictObject({
          /** Requests per API key per minute (all endpoints). */
          requestsPerMinute: z.int().min(1).max(100_000).default(60),
          /** Agent runs in flight per API key. */
          maxConcurrentRuns: z.int().min(1).max(100).default(2),
        })
        .prefault({}),
    })
    .prefault({}),
  channels: z
    .strictObject({
      telegram: TelegramChannelSchema.prefault({}),
      whatsapp: WhatsAppChannelSchema.prefault({}),
      /** Serve the browser chat page at /chat on the gateway. */
      web: z.strictObject({ enabled: z.boolean().default(true) }).prefault({}),
    })
    .prefault({}),
  agents: z
    .strictObject({
      /** Directories (relative to the config file) scanned for <name>/AGENT.md specialists. None found = single agent. */
      dirs: z.array(z.string().min(1)).default(["agents"]),
      /** Agent transfers allowed per run. */
      maxTransfers: z.int().min(1).max(10).default(3),
    })
    .prefault({}),
  handoff: z
    .strictObject({
      /** Offer the request_human tool; handed-off sessions wait for an operator (docs/04). */
      enabled: z.boolean().default(false),
    })
    .prefault({}),
  /** Plugin modules: paths relative to the config file ("./plugins/x") or installed package names. Trusted code only. */
  plugins: z.array(z.string().min(1)).default([]),
  mcp: z
    .strictObject({
      /** Server name → connection. Names prefix tool names: <server>__<tool>. */
      servers: z
        .record(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, "use lower snake_case (max 31 chars)"), McpServerConfigSchema)
        .default({}),
    })
    .prefault({}),
});

export type BanglaClawConfig = z.infer<typeof ConfigSchema> & {
  models: { default: { model: string } };
};

/** Secrets resolved from the environment only — never from the config file. */
export interface Secrets {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  /** Contains credentials, so it is treated as a secret. */
  databaseUrl?: string;
  telegramBotToken?: string;
  /** Verifies Telegram webhook requests (X-Telegram-Bot-Api-Secret-Token). */
  telegramWebhookSecret?: string;
  whatsappAccessToken?: string;
  /** Meta app secret used to verify X-Hub-Signature-256 on webhooks. */
  whatsappAppSecret?: string;
  /** Token echoed during webhook verification (hub.verify_token). */
  whatsappVerifyToken?: string;
  qdrantApiKey?: string;
  /** Overrides OPENAI_API_KEY for the embeddings endpoint. */
  embeddingsApiKey?: string;
  /** POSTed a JSON notification whenever a session is handed to a human. */
  handoffWebhookUrl?: string;
  /** Bearer token required to scrape GET /metrics (optional). */
  metricsToken?: string;
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
  /** Directory relative paths in the config resolve against (config file dir, else cwd). */
  baseDir: string;
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
  const databaseUrl = nonEmpty(env.DATABASE_URL);
  if (databaseUrl !== undefined) secrets.databaseUrl = databaseUrl;
  const secretEnv: [keyof Secrets, string][] = [
    ["telegramBotToken", "TELEGRAM_BOT_TOKEN"],
    ["telegramWebhookSecret", "TELEGRAM_WEBHOOK_SECRET"],
    ["whatsappAccessToken", "WHATSAPP_ACCESS_TOKEN"],
    ["whatsappAppSecret", "WHATSAPP_APP_SECRET"],
    ["whatsappVerifyToken", "WHATSAPP_VERIFY_TOKEN"],
    ["qdrantApiKey", "QDRANT_API_KEY"],
    ["embeddingsApiKey", "EMBEDDINGS_API_KEY"],
    ["handoffWebhookUrl", "HANDOFF_WEBHOOK_URL"],
    ["metricsToken", "METRICS_TOKEN"],
  ];
  for (const [key, name] of secretEnv) {
    const value = nonEmpty(env[name]);
    if (value !== undefined) secrets[key] = value;
  }

  const baseDir = source !== undefined ? dirname(source) : cwd;
  return source !== undefined ? { config, secrets, source, baseDir } : { config, secrets, baseDir };
}

function applyEnvOverrides(input: Record<string, unknown>, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const provider = nonEmpty(env.BANGLACLAW_PROVIDER);
  const model = nonEmpty(env.BANGLACLAW_MODEL);
  const baseUrl = nonEmpty(env.BANGLACLAW_BASE_URL);
  const storage = nonEmpty(env.BANGLACLAW_STORAGE);
  const gatewayPort = nonEmpty(env.BANGLACLAW_GATEWAY_PORT);
  const gatewayHost = nonEmpty(env.BANGLACLAW_GATEWAY_HOST);
  const qdrantUrl = nonEmpty(env.QDRANT_URL);
  let raw = input;
  if (qdrantUrl !== undefined) {
    const current = isRecord(raw.knowledge) ? raw.knowledge : {};
    raw = { ...raw, knowledge: { ...current, vectorStoreUrl: qdrantUrl } };
  }
  if (gatewayPort !== undefined || gatewayHost !== undefined) {
    const current = isRecord(raw.gateway) ? raw.gateway : {};
    raw = {
      ...raw,
      gateway: {
        ...current,
        ...(gatewayPort !== undefined && { port: Number(gatewayPort) }),
        ...(gatewayHost !== undefined && { host: gatewayHost }),
      },
    };
  }
  if (storage !== undefined) {
    const current = isRecord(raw.storage) ? raw.storage : {};
    raw = { ...raw, storage: { ...current, provider: storage } };
  }
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
