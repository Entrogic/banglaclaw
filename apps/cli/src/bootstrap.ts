import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { AgentRuntime } from "@banglaclaw/agent";
import { loadAgentProfiles, type AgentProfile } from "@banglaclaw/agents";
import { InMemoryAuthStore, type AuthStore } from "@banglaclaw/auth";
import { McpManager } from "@banglaclaw/mcp";
import { createProvider } from "@banglaclaw/providers";
import { InMemoryRunStore, InMemorySessionStore, type RunStore, type SessionStore } from "@banglaclaw/session";
import { ConfigError, createLogger, loadConfig, parseLogLevel, type LoadedConfig } from "@banglaclaw/shared";
import { SkillSet, loadSkillsFromDirs } from "@banglaclaw/skills";
import type { PermissionPolicy } from "@banglaclaw/tools";
import { PostgresStorage } from "@banglaclaw/storage";
import { AllowlistPolicy, ToolRegistry, builtinTools, type AnyTool } from "@banglaclaw/tools";
import { setupKnowledge, type KnowledgeSetup } from "./knowledge.js";

export interface GlobalOptions {
  config?: string;
}

export function load(options: GlobalOptions): LoadedConfig {
  return loadConfig(options.config !== undefined ? { path: options.config } : {});
}

export function buildRegistry(mcp?: McpManager, extra: AnyTool[] = []): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of builtinTools) registry.register(tool);
  for (const tool of extra) registry.register(tool);
  for (const tool of mcp?.tools() ?? []) registry.register(tool);
  return registry;
}

/** Connects configured MCP servers. Failed servers are reported via status(), not thrown. */
export async function connectMcp(loaded: LoadedConfig): Promise<McpManager> {
  const manager = new McpManager({
    servers: loaded.config.mcp.servers,
    baseDir: loaded.baseDir,
    clientVersion: "0.3.0",
    logger: createLogger({ level: parseLogLevel(process.env.BANGLACLAW_LOG_LEVEL) }),
  });
  await manager.connectAll();
  return manager;
}

export function loadAgents(loaded: LoadedConfig): AgentProfile[] {
  return loadAgentProfiles(loaded.config.agents.dirs, loaded.baseDir);
}

/** POSTs {event, sessionId, channel, reason} to HANDOFF_WEBHOOK_URL (Slack/Discord bridges, n8n, …). */
function handoffNotifier(loaded: LoadedConfig) {
  const url = loaded.secrets.handoffWebhookUrl;
  if (url === undefined) return undefined;
  return async (session: { id: string; channel: string; externalId?: string }, reason: string) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "handoff", sessionId: session.id, channel: session.channel, reason, at: new Date().toISOString() }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`handoff webhook returned ${res.status}`);
  };
}

export function loadSkills(loaded: LoadedConfig): SkillSet {
  return new SkillSet(loadSkillsFromDirs(loaded.config.skills.dirs, loaded.baseDir));
}

export interface Services {
  loaded: LoadedConfig;
  sessions: SessionStore;
  runs: RunStore;
  auth: AuthStore;
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
      auth: new InMemoryAuthStore(),
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
    auth: postgres.auth,
    postgres,
    ...(loaded.config.storage.checkpoints && { checkpointer: postgres.checkpointer }),
    persistent: true,
    close: () => postgres.close(),
  };
}

/** Wires config → provider, tools (built-in + MCP), policy, skills, storage → AgentRuntime. */
export interface RuntimeBundle {
  runtime: AgentRuntime;
  services: Services;
  mcp: McpManager;
  registry: ToolRegistry;
  policy: PermissionPolicy;
  skills: SkillSet;
  providerId: string;
  knowledge: KnowledgeSetup;
  profiles: AgentProfile[];
}

export async function createRuntime(options: GlobalOptions): Promise<RuntimeBundle> {
  const services = await openServices(options);
  let mcp: McpManager | undefined;
  try {
    const { config, secrets } = services.loaded;
    const provider = createProvider(config.models.default, secrets);
    mcp = await connectMcp(services.loaded);
    const connected = mcp;
    const closeStorage = services.close;
    services.close = async () => {
      await connected.close();
      await closeStorage();
    };
    const logger = createLogger({ level: parseLogLevel(process.env.BANGLACLAW_LOG_LEVEL) });
    const knowledge = setupKnowledge(services.loaded, services.sessions, logger);
    const registry = buildRegistry(mcp, knowledge.tools);
    const policy = new AllowlistPolicy(config.tools.allow);
    const skills = loadSkills(services.loaded);
    const profiles = loadAgents(services.loaded);
    const notify = handoffNotifier(services.loaded);
    const runtime = new AgentRuntime({
      provider,
      registry,
      policy,
      sessions: services.sessions,
      runs: services.runs,
      limits: { maxIterations: config.runtime.maxIterations, maxToolCalls: config.runtime.maxToolCalls },
      timeoutMs: config.runtime.timeoutMs,
      timezone: config.timezone,
      agentName: config.agent.name,
      maxHistoryMessages: config.memory.maxHistoryMessages,
      skills,
      maxActiveSkills: config.skills.maxActive,
      ...(services.checkpointer !== undefined && { checkpointer: services.checkpointer }),
      contextProviders: knowledge.contextProviders,
      ...((profiles.length > 0 || config.handoff.enabled) && {
        team: { profiles, handoff: config.handoff.enabled, maxTransfers: config.agents.maxTransfers },
      }),
      ...(notify !== undefined && { onHandoff: notify }),
      logger,
    });
    return { runtime, services, mcp, registry, policy, skills, providerId: provider.id, knowledge, profiles };
  } catch (error) {
    await services.close();
    await mcp?.close();
    throw error;
  }
}
