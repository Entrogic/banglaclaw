import { fileURLToPath } from "node:url";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { A2aManager } from "@entrogic-net/a2a";
import { AgentRuntime, type AgentRuntimeOptions } from "@entrogic-net/agent";
import { loadAgentProfiles, type AgentProfile } from "@entrogic-net/agents";
import { InMemoryAuthStore, SecretBox, type AuthStore } from "@entrogic-net/auth";
import { McpManager } from "@entrogic-net/mcp";
import { ProviderManager } from "@entrogic-net/providers";
import { InMemoryRunStore, InMemorySessionStore, type RunStore, type SessionStore } from "@entrogic-net/session";
import { ConfigError, InMemoryAuditStore, InMemoryEvalDatasetStore, InMemoryEvalStore, InMemoryProviderStore, auditRecorder, createLogger, loadConfig, parseLogLevel, type AuditStore, type EvalDatasetStore, type EvalStore, type LoadedConfig, type ProviderStore } from "@entrogic-net/shared";
import { SkillSet, loadSkillsFromDirs } from "@entrogic-net/skills";
import type { PermissionPolicy } from "@entrogic-net/tools";
import { PostgresStorage } from "@entrogic-net/storage";
import { AllowlistPolicy, ToolRegistry, builtinTools, type AnyTool } from "@entrogic-net/tools";
import { setupKnowledge, type KnowledgeSetup } from "./knowledge.js";
import { workspaceTools } from "./workspace.js";
import { loadPlugins, type LoadedPlugin } from "./plugins.js";
import { warn } from "./ui/output.js";
import { VERSION } from "./version.js";

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
    clientVersion: VERSION,
    logger: createLogger({ level: parseLogLevel(process.env.BANGLACLAW_LOG_LEVEL) }),
  });
  await manager.connectAll();
  return manager;
}

/** Fetches the cards of configured remote A2A agents. Unreachable agents are reported via status(), not thrown. */
export async function connectA2a(loaded: LoadedConfig): Promise<A2aManager> {
  const manager = new A2aManager({ agents: loaded.config.a2a.agents, logger: createLogger({ level: parseLogLevel(process.env.BANGLACLAW_LOG_LEVEL) }) });
  await manager.connectAll();
  return manager;
}

export function loadAgents(loaded: LoadedConfig, plugins: readonly LoadedPlugin[] = []): AgentProfile[] {
  return loadAgentProfiles([...loaded.config.agents.dirs, ...plugins.flatMap((p) => p.plugin.agentsDirs ?? [])], loaded.baseDir);
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

/** Skills shipped inside this package: the repo's skills/, copied to apps/cli/skills by the build (scripts/copy-skills.mjs). */
export const BUILTIN_SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url));

/** Configured and plugin skills, plus the built-in ones they don't override (skills.builtin). */
export function loadSkills(loaded: LoadedConfig, plugins: readonly LoadedPlugin[] = [], builtinDir = BUILTIN_SKILLS_DIR): SkillSet {
  const configured = loadSkillsFromDirs([...loaded.config.skills.dirs, ...plugins.flatMap((p) => p.plugin.skillsDirs ?? [])], loaded.baseDir);
  if (!loaded.config.skills.builtin) return new SkillSet(configured);
  const taken = new Set(configured.map((s) => s.name));
  return new SkillSet([...configured, ...loadSkillsFromDirs([builtinDir]).filter((s) => !taken.has(s.name))]);
}

export interface Services {
  loaded: LoadedConfig;
  sessions: SessionStore;
  runs: RunStore;
  auth: AuthStore;
  audit: AuditStore;
  /** Eval results recorded through /v1/admin/evals (docs/26). */
  evals: EvalStore;
  /** Datasets admins run from the dashboard (ADR-0020). */
  evalDatasets: EvalDatasetStore;
  /** Model provider profiles added from the dashboard (ADR-0019). */
  providers: ProviderStore;
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
    const sessions = new InMemorySessionStore();
    return {
      loaded,
      sessions,
      runs: new InMemoryRunStore(sessions),
      auth: new InMemoryAuthStore(),
      audit: new InMemoryAuditStore(),
      evals: new InMemoryEvalStore(),
      evalDatasets: new InMemoryEvalDatasetStore(),
      providers: new InMemoryProviderStore(),
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
    audit: postgres.audit,
    evals: postgres.evals,
    evalDatasets: postgres.evalDatasets,
    providers: postgres.providers,
    postgres,
    ...(loaded.config.storage.checkpoints && { checkpointer: postgres.checkpointer }),
    persistent: true,
    close: () => postgres.close(),
  };
}

/** Wires config → provider, tools (built-in + MCP + A2A), policy, skills, storage → AgentRuntime. */
export interface RuntimeBundle {
  runtime: AgentRuntime;
  services: Services;
  mcp: McpManager;
  a2a: A2aManager;
  registry: ToolRegistry;
  policy: PermissionPolicy;
  skills: SkillSet;
  /** The provider new runs use (config/env, or a profile chosen in the dashboard). */
  providers: ProviderManager;
  /** Provider id at startup, for banners. */
  providerId: string;
  knowledge: KnowledgeSetup;
  profiles: AgentProfile[];
  plugins: LoadedPlugin[];
}

export async function createRuntime(options: GlobalOptions, hooks: { onRunComplete?: AgentRuntimeOptions["onRunComplete"] } = {}): Promise<RuntimeBundle> {
  const services = await openServices(options);
  let mcp: McpManager | undefined;
  let a2a: A2aManager | undefined;
  try {
    const { config, secrets } = services.loaded;
    const logger = createLogger({ level: parseLogLevel(process.env.BANGLACLAW_LOG_LEVEL) });
    const providers = await ProviderManager.open({
      store: services.providers,
      ...(secrets.secretKey !== undefined && { cipher: new SecretBox(secrets.secretKey) }),
      config: config.models.default,
      secrets,
      persistent: services.persistent,
      logger,
    });
    if (providers.status().active.error !== undefined) {
      // stderr only: `mcp serve` keeps stdout for the protocol.
      warn("No model provider is configured, so the agent cannot answer yet. Run `banglaclaw serve` and add one at /admin/providers, or set OPENAI_API_KEY / ANTHROPIC_API_KEY in .env.");
    }
    [mcp, a2a] = await Promise.all([connectMcp(services.loaded), connectA2a(services.loaded)]);
    const connected = mcp;
    const closeStorage = services.close;
    services.close = async () => {
      await connected.close();
      await closeStorage();
    };
    const knowledge = setupKnowledge(services.loaded, services.sessions, logger);
    const plugins = await loadPlugins(services.loaded);
    const registry = buildRegistry(mcp, [...knowledge.tools, ...workspaceTools(services.loaded, services.sessions, logger), ...plugins.flatMap((p) => p.plugin.tools ?? []), ...a2a.tools()]);
    const policy = new AllowlistPolicy(config.tools.allow);
    const skills = loadSkills(services.loaded, plugins);
    const profiles = loadAgents(services.loaded, plugins);
    const notify = handoffNotifier(services.loaded);
    const runtime = new AgentRuntime({
      provider: () => providers.current(),
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
      contextProviders: [...knowledge.contextProviders, ...plugins.flatMap((p) => p.plugin.contextProviders ?? [])],
      ...((profiles.length > 0 || config.handoff.enabled) && {
        team: { profiles, handoff: config.handoff.enabled, maxTransfers: config.agents.maxTransfers },
      }),
      ...(notify !== undefined && { onHandoff: notify }),
      audit: auditRecorder(services.audit, logger),
      ...(hooks.onRunComplete !== undefined && { onRunComplete: hooks.onRunComplete }),
      logger,
    });
    return { runtime, services, mcp, a2a, registry, policy, skills, providers, providerId: providers.current().id, knowledge, profiles, plugins };
  } catch (error) {
    await services.close();
    await mcp?.close();
    throw error;
  }
}
