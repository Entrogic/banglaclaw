import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { AgentRuntime } from "@banglaclaw/agent";
import { createProvider } from "@banglaclaw/providers";
import { InMemoryRunStore, InMemorySessionStore, type RunStore, type SessionStore } from "@banglaclaw/session";
import { ConfigError, createLogger, loadConfig, parseLogLevel, type LoadedConfig } from "@banglaclaw/shared";
import { SkillSet, loadSkillsFromDirs } from "@banglaclaw/skills";
import { PostgresStorage } from "@banglaclaw/storage";
import { AllowlistPolicy, ToolRegistry, builtinTools } from "@banglaclaw/tools";

export interface GlobalOptions {
  config?: string;
}

export function load(options: GlobalOptions): LoadedConfig {
  return loadConfig(options.config !== undefined ? { path: options.config } : {});
}

export function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of builtinTools) registry.register(tool);
  return registry;
}

export function loadSkills(loaded: LoadedConfig): SkillSet {
  return new SkillSet(loadSkillsFromDirs(loaded.config.skills.dirs, loaded.baseDir));
}

export interface Services {
  loaded: LoadedConfig;
  sessions: SessionStore;
  runs: RunStore;
  /** Set when storage.provider is postgres. */
  postgres?: PostgresStorage;
  checkpointer?: BaseCheckpointSaver;
  persistent: boolean;
  close(): Promise<void>;
}

/** Opens the Postgres connection for `storage.provider: postgres` (without migration checks). */
export function openPostgres(loaded: LoadedConfig): PostgresStorage {
  const url = loaded.secrets.databaseUrl;
  if (url === undefined) {
    throw new ConfigError("storage.provider is postgres but DATABASE_URL is not set (see docker/compose.yaml)");
  }
  return new PostgresStorage(url);
}

/** Wires storage per config: in-memory (default) or PostgreSQL with checkpoints. */
export async function openServices(options: GlobalOptions): Promise<Services> {
  const loaded = load(options);
  if (loaded.config.storage.provider === "memory") {
    return {
      loaded,
      sessions: new InMemorySessionStore(),
      runs: new InMemoryRunStore(),
      persistent: false,
      close: async () => {},
    };
  }

  const postgres = openPostgres(loaded);
  try {
    const { applied, available } = await postgres.migrationStatus();
    if (applied < available) {
      throw new ConfigError(`Database schema is behind (${applied}/${available} migrations) — run \`banglaclaw db migrate\``);
    }
  } catch (error) {
    await postgres.close();
    throw error;
  }
  return {
    loaded,
    sessions: postgres.sessions,
    runs: postgres.runs,
    postgres,
    ...(loaded.config.storage.checkpoints && { checkpointer: postgres.checkpointer }),
    persistent: true,
    close: () => postgres.close(),
  };
}

/** Wires config → provider, tools, policy, skills, storage → AgentRuntime. */
export async function createRuntime(options: GlobalOptions): Promise<{ runtime: AgentRuntime; services: Services }> {
  const services = await openServices(options);
  try {
    const { config, secrets } = services.loaded;
    const runtime = new AgentRuntime({
      provider: createProvider(config.models.default, secrets),
      registry: buildRegistry(),
      policy: new AllowlistPolicy(config.tools.allow),
      sessions: services.sessions,
      runs: services.runs,
      limits: { maxIterations: config.runtime.maxIterations, maxToolCalls: config.runtime.maxToolCalls },
      timeoutMs: config.runtime.timeoutMs,
      timezone: config.timezone,
      agentName: config.agent.name,
      maxHistoryMessages: config.memory.maxHistoryMessages,
      skills: loadSkills(services.loaded),
      maxActiveSkills: config.skills.maxActive,
      ...(services.checkpointer !== undefined && { checkpointer: services.checkpointer }),
      logger: createLogger({ level: parseLogLevel(process.env.BANGLACLAW_LOG_LEVEL) }),
    });
    return { runtime, services };
  } catch (error) {
    await services.close();
    throw error;
  }
}
