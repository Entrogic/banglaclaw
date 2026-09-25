import { AgentRuntime } from "@banglaclaw/agent";
import { createProvider } from "@banglaclaw/providers";
import { createLogger, loadConfig, parseLogLevel, type LoadedConfig } from "@banglaclaw/shared";
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

/** Wires config → provider, tools, policy → AgentRuntime. */
export function createRuntime(options: GlobalOptions): { runtime: AgentRuntime; loaded: LoadedConfig } {
  const loaded = load(options);
  const { config, secrets } = loaded;
  const runtime = new AgentRuntime({
    provider: createProvider(config.models.default, secrets),
    registry: buildRegistry(),
    policy: new AllowlistPolicy(config.tools.allow),
    limits: { maxIterations: config.runtime.maxIterations, maxToolCalls: config.runtime.maxToolCalls },
    timeoutMs: config.runtime.timeoutMs,
    timezone: config.timezone,
    agentName: config.agent.name,
    logger: createLogger({ level: parseLogLevel(process.env.BANGLACLAW_LOG_LEVEL) }),
  });
  return { runtime, loaded };
}
