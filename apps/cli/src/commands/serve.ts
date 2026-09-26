import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApiKeyAuthenticator } from "@entrogic-net/auth";
import { startGateway, type RunningGateway } from "@entrogic-net/gateway";
import { Metrics } from "@entrogic-net/observability";
import { BanglaClawError, ConfigError, createLogger, parseLogLevel } from "@entrogic-net/shared";
import { createRuntime, type GlobalOptions } from "../bootstrap.js";
import { createDeliver, setupChannels } from "../channels.js";
import { print, printAlways, warn } from "../ui/output.js";
import { c, sym } from "../ui/theme.js";
import { VERSION } from "../version.js";
import { resolveWidget } from "../widget.js";
import { gatewayFileDeps } from "../workspace.js";
import { prepareKnowledge, reportMcpFailures } from "./shared.js";

export async function serve(options: GlobalOptions & { port?: string; host?: string }): Promise<void> {
  const metrics = new Metrics({ version: VERSION });
  const bundle = await createRuntime(options, { onRunComplete: metrics.observeRun });
  const { services, mcp } = bundle;
  const config = services.loaded.config;
  const gatewayConfig = {
    ...config.gateway,
    ...(options.port !== undefined && { port: Number(options.port) }),
    ...(options.host !== undefined && { host: options.host }),
  };
  const logger = createLogger({ level: parseLogLevel(process.env.BANGLACLAW_LOG_LEVEL, "info") });

  let gateway: RunningGateway;
  let channels: ReturnType<typeof setupChannels>;
  let devToken: string | undefined;
  let widget: ReturnType<typeof resolveWidget> = { warnings: [] };
  let apiFiles: ReturnType<typeof gatewayFileDeps> = {};
  const dashboardDir = config.gateway.dashboardDir === undefined ? undefined : resolve(services.loaded.baseDir, config.gateway.dashboardDir);
  try {
    if (!Number.isInteger(gatewayConfig.port) || gatewayConfig.port < 0 || gatewayConfig.port > 65_535) throw new BanglaClawError("INVALID_PORT", `Invalid port: ${options.port ?? ""}`);
    await prepareKnowledge(bundle.knowledge, true);
    channels = setupChannels(services.loaded, bundle.runtime, services.sessions, logger);
    widget = resolveWidget(services.loaded);
    apiFiles = gatewayFileDeps(services.loaded, logger);
    if (dashboardDir !== undefined && !existsSync(join(dashboardDir, "index.html"))) {
      throw new ConfigError(`gateway.dashboardDir has no index.html: ${dashboardDir}`);
    }
    const authenticator = new ApiKeyAuthenticator(services.auth);
    // Memory storage has no persistent keys: issue one for this process only. It is an admin key so the
    // dashboard, audit log and handoff queue can be tried locally; all data is gone when the process exits.
    if (!services.persistent) devToken = (await authenticator.issueKey("dev", "temporary", "admin")).token;
    gateway = await startGateway({
      runtime: bundle.runtime,
      sessions: services.sessions,
      runs: services.runs,
      auth: authenticator,
      registry: bundle.registry,
      policy: bundle.policy,
      skills: bundle.skills,
      agent: { name: config.agent.name, model: bundle.providerId },
      config: gatewayConfig,
      version: VERSION,
      logger,
      routes: channels.routes,
      webChat: config.channels.web.enabled,
      ...(widget.options !== undefined && { widget: widget.options }),
      ...apiFiles,
      ...(bundle.knowledge.kb !== undefined && { knowledge: { kb: bundle.knowledge.kb, searchLimit: config.knowledge.searchLimit, minScore: config.knowledge.minScore } }),
      ...(bundle.knowledge.memory !== undefined && { memory: bundle.knowledge.memory }),
      deliver: createDeliver(services.loaded, logger),
      audit: services.audit,
      pricing: config.pricing,
      timezone: config.timezone,
      ...(dashboardDir !== undefined && { dashboardDir }),
      ...(config.gateway.metrics && { metrics: Object.assign(metrics, services.loaded.secrets.metricsToken !== undefined ? { token: services.loaded.secrets.metricsToken } : {}) }),
    });
  } catch (error) {
    await services.close();
    throw error;
  }
  try {
    await channels.start();
  } catch (error) {
    await gateway.close();
    await services.close();
    throw error;
  }

  print();
  print(`${c.bold(`${sym.paw} BanglaClaw ${VERSION}`)} ${c.dim("gateway ready")}`);
  print();
  const rows: [string, string][] = [
    ["API", `${gateway.url}/v1  ${c.dim(`(docs: ${gateway.url}/v1/openapi.json)`)}`],
    ["Model", bundle.providerId],
    ["Storage", services.persistent ? "postgres" : c.yellow("memory (not persisted)")],
  ];
  if (config.channels.web.enabled) rows.push(["Web chat", `${gateway.url}/chat`]);
  if (widget.options !== undefined) rows.push(["Widget", `<script src="${gateway.url}/widget.js" async></script> ${c.dim(`(${widget.options.allowedOrigins.join(", ")})`)}`]);
  if (dashboardDir !== undefined) rows.push(["Admin", `${gateway.url}/admin/ ${c.dim("(admin API key)")}`]);
  if (config.gateway.metrics) rows.push(["Metrics", `${gateway.url}/metrics${services.loaded.secrets.metricsToken !== undefined ? c.dim(" (METRICS_TOKEN)") : ""}`]);
  if (bundle.profiles.length > 0) rows.push(["Agents", `supervisor → ${bundle.profiles.map((p) => p.name).join(", ")}`]);
  if (bundle.plugins.length > 0) rows.push(["Plugins", bundle.plugins.map((p) => `${p.plugin.name}@${p.plugin.version}`).join(", ")]);
  if (mcp.tools().length > 0) rows.push(["MCP", `${mcp.tools().length} tools from ${mcp.status().filter((s) => s.state === "connected").map((s) => s.name).join(", ")}`]);
  for (const line of channels.summary) rows.push(["Channel", line]);
  for (const [k, v] of rows) print(`  ${c.dim(k.padEnd(9))} ${v}`);
  print();
  reportMcpFailures(mcp);
  for (const line of channels.warnings) warn(line);
  for (const line of widget.warnings) warn(line);
  if (devToken !== undefined) {
    printAlways(c.yellow(`${sym.warn} Temporary admin API key (memory storage, valid until exit):`));
    printAlways(`  ${devToken}`);
    print(c.dim("  Use postgres storage and `banglaclaw key create` for persistent keys."));
    print();
  }
  print(c.dim(`  curl -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"text":"হ্যালো"}' ${gateway.url}/v1/agents/run`));
  print(c.dim("  Press Ctrl+C to stop."));

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      print(c.dim("\nShutting down…"));
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
  await channels.stop();
  await gateway.close();
  await services.close();
}
