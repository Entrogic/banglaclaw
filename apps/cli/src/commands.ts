import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { AgentRunError, type AgentRuntime } from "@banglaclaw/agent";
import { requiredApiKeyEnv } from "@banglaclaw/providers";
import { InMemorySessionStore, SessionManager, type RunRecord, type Session } from "@banglaclaw/session";
import type { KnowledgeBase, LongTermMemory } from "@banglaclaw/knowledge";
import { ApiKeyAuthenticator } from "@banglaclaw/auth";
import { TelegramApi } from "@banglaclaw/channels";
import { startGateway, type RunningGateway } from "@banglaclaw/gateway";
import { BanglaClawError, createLogger, parseLogLevel, type LoadedConfig } from "@banglaclaw/shared";
import { AllowlistPolicy } from "@banglaclaw/tools";
import type { McpManager, McpServerStatus } from "@banglaclaw/mcp";
import { buildRegistry, connectMcp, createRuntime, load, loadSkills, openPostgres, openServices, type GlobalOptions, type Services } from "./bootstrap.js";
import { setupChannels } from "./channels.js";
import { setupKnowledge, type KnowledgeSetup } from "./knowledge.js";
import { bold, createRenderer, dim, green, red, yellow } from "./render.js";

const CHANNEL = "cli";

interface SessionOption extends GlobalOptions {
  session?: string;
}

async function resolveSession(runtime: AgentRuntime, services: Services, sessionId?: string): Promise<{ session: Session; created: boolean }> {
  const manager = new SessionManager(runtime.sessions);
  return manager.resolve({
    channel: CHANNEL,
    agentId: services.loaded.config.agent.name,
    ...(sessionId !== undefined && { sessionId }),
  });
}

/** Warns (on stderr) about MCP servers that failed to connect, so the reply stream stays clean. */
function reportMcpFailures(mcp: McpManager): void {
  for (const s of mcp.status()) {
    if (s.state === "failed") process.stderr.write(yellow(`! MCP server ${s.name} unavailable: ${firstLine(s.error)}\n`));
  }
}

function firstLine(text: string | undefined): string {
  return (text ?? "").split("\n")[0] ?? "";
}

function memoryNotice(services: Services): void {
  if (!services.persistent) {
    console.log(dim("storage.provider is memory — sessions and runs are not kept between CLI invocations."));
  }
}

export async function agentRun(message: string, options: SessionOption): Promise<void> {
  const { runtime, services, mcp, knowledge } = await createRuntime(options);
  try {
    reportMcpFailures(mcp);
    await prepareKnowledge(knowledge, false);
    const { session } = await resolveSession(runtime, services, options.session);
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort());
    const record = await runtime.run(message, { sessionId: session.id, onEvent: createRenderer(), signal: controller.signal });
    if (services.persistent) process.stderr.write(dim(`session ${session.id} · run ${record.id}\n`));
    if (record.status === "limited") process.exitCode = 2;
  } finally {
    await services.close();
  }
}

export async function chat(options: SessionOption): Promise<void> {
  const { runtime, services, mcp, knowledge } = await createRuntime(options);
  await prepareKnowledge(knowledge, true).catch(async (error: unknown) => {
    await services.close();
    throw error;
  });
  let { session, created } = await resolveSession(runtime, services, options.session).catch(async (error: unknown) => {
    await services.close();
    throw error;
  });
  const render = createRenderer();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // rl.question() never settles once stdin ends (Ctrl+D, closed pipe), so race it against close.
  const closed = new Promise<null>((resolve) => rl.once("close", () => resolve(null)));

  let active: AbortController | undefined;
  rl.on("SIGINT", () => {
    if (active !== undefined) active.abort();
    else rl.close();
  });

  const model = services.loaded.config.models.default;
  console.log(bold("🐾 BanglaClaw") + dim(` — ${model.provider}:${model.model} · ${services.persistent ? "postgres" : "memory"} storage`));
  const mcpTools = mcp.tools().length;
  if (mcpTools > 0) console.log(dim(`MCP: ${mcpTools} tools from ${mcp.status().filter((s) => s.state === "connected").map((s) => s.name).join(", ")}`));
  reportMcpFailures(mcp);
  if (!created) {
    const count = await runtime.sessions.countMessages(session.id);
    console.log(dim(`Resumed session ${session.id} (${count} messages)`));
  }
  console.log(dim("Type in Bangla, Banglish or English. /help lists commands.\n"));

  try {
    for (;;) {
      let answer: string | null;
      try {
        answer = await Promise.race([rl.question(green("› ")), closed]);
      } catch {
        answer = null;
      }
      if (answer === null) break; // readline closed (Ctrl+C / Ctrl+D / end of input)
      const input = answer.trim();
      if (input === "") continue;
      if (input === "/exit" || input === "/quit") break;
      if (input === "/help") {
        console.log(dim(["/new       start a new session", "/history   show recent messages", "/session   show the session id", "/exit      quit (Ctrl+C cancels a running reply)"].join("\n")));
        continue;
      }
      if (input === "/session") {
        console.log(dim(session.id));
        continue;
      }
      if (input === "/history") {
        const recent = await runtime.sessions.recentMessages(session.id, 20);
        if (recent.length === 0) console.log(dim("No messages yet."));
        for (const m of recent) {
          const type = m.getType();
          if (type === "human") console.log(`${green("you")}   ${m.text}`);
          else if (type === "ai" && m.text.length > 0) console.log(`${bold("agent")} ${m.text}`);
        }
        continue;
      }
      if (input === "/new" || input === "/reset") {
        ({ session, created } = await resolveSession(runtime, services));
        console.log(dim(`New session ${session.id}`));
        continue;
      }

      active = new AbortController();
      try {
        await runtime.run(input, { sessionId: session.id, onEvent: render, signal: active.signal });
      } catch (error) {
        // The renderer already printed run errors; anything else is unexpected.
        if (!(error instanceof AgentRunError)) console.error(red(`✖ ${describe(error)}`));
      } finally {
        active = undefined;
      }
      console.log();
    }
  } finally {
    rl.close();
    if (services.persistent) console.log(dim(`Resume with: banglaclaw chat --session ${session.id}`));
    await services.close();
  }
}

export async function sessionList(options: GlobalOptions & { limit: string }): Promise<void> {
  const services = await openServices(options);
  try {
    memoryNotice(services);
    const sessions = await services.sessions.list({ limit: Number(options.limit) });
    if (sessions.length === 0) console.log(dim("No sessions."));
    for (const s of sessions) {
      const count = await services.sessions.countMessages(s.id);
      console.log(`${bold(s.id)}  ${s.channel.padEnd(8)} ${String(count).padStart(4)} msgs  ${dim(s.updatedAt.toISOString())}`);
    }
  } finally {
    await services.close();
  }
}

export async function sessionShow(id: string, options: GlobalOptions & { limit: string }): Promise<void> {
  const services = await openServices(options);
  try {
    const session = await services.sessions.get(id);
    if (session === undefined) throw new BanglaClawError("SESSION_NOT_FOUND", `Session not found: ${id}`);
    console.log(`${bold(session.id)} ${dim(`${session.channel} · agent ${session.agentId} · created ${session.createdAt.toISOString()}`)}`);
    for (const m of await services.sessions.recentMessages(id, Number(options.limit))) {
      const type = m.getType();
      if (type === "human") console.log(`${green("user")}  ${m.text}`);
      else if (type === "ai") {
        const calls = "tool_calls" in m && Array.isArray(m.tool_calls) ? m.tool_calls : [];
        if (m.text.length > 0) console.log(`${bold("agent")} ${m.text}`);
        for (const c of calls as { name: string; args: unknown }[]) console.log(dim(`      ⚙ ${c.name}(${JSON.stringify(c.args)})`));
      } else if (type === "tool") console.log(dim(`      → ${m.text}`));
    }
    const runs = await services.runs.listBySession(id, { limit: 10 });
    if (runs.length > 0) console.log(dim(`\nRecent runs:`));
    for (const r of runs) printRunLine(r);
  } finally {
    await services.close();
  }
}

function printRunLine(r: RunRecord): void {
  const status = r.status === "completed" ? green(r.status) : r.status === "limited" ? yellow(r.status) : red(r.status);
  const skills = r.skills.length > 0 ? ` skills:${r.skills.join(",")}` : "";
  console.log(`${r.id}  ${status.padEnd(9)} ${r.language.padEnd(5)} ${String(r.toolCalls.length)} tools${skills}  ${dim(`${r.durationMs}ms ${r.startedAt.toISOString()}`)}`);
}

export async function runShow(id: string, options: GlobalOptions): Promise<void> {
  const services = await openServices(options);
  try {
    const r = await services.runs.get(id);
    if (r === undefined) throw new BanglaClawError("RUN_NOT_FOUND", `Run not found: ${id}`);
    printRunLine(r);
    console.log(dim(`session ${r.sessionId} · ${r.provider} · prompt ${r.promptVersion} · ${r.iterations} model calls${r.stopReason !== undefined ? ` · stop ${r.stopReason}` : ""}`));
    console.log(`${green("input")}  ${r.input}`);
    if (r.output !== undefined) console.log(`${bold("output")} ${r.output}`);
    if (r.error !== undefined) console.log(red(`error  ${r.error}`));
    for (const c of r.toolCalls) {
      const detail = c.status === "ok" ? JSON.stringify(c.output) : `${c.status}: ${c.error ?? ""}`;
      console.log(dim(`⚙ ${c.tool}(${JSON.stringify(c.input)}) → ${detail} ${c.durationMs}ms`));
    }
    if (services.checkpointer !== undefined) {
      const tuple = await services.checkpointer.getTuple({ configurable: { thread_id: r.id } });
      console.log(dim(tuple !== undefined ? `checkpoint ${tuple.checkpoint.id}` : "no checkpoint"));
    }
  } finally {
    await services.close();
  }
}

export async function runList(options: GlobalOptions & { session: string; limit: string }): Promise<void> {
  const services = await openServices(options);
  try {
    memoryNotice(services);
    const runs = await services.runs.listBySession(options.session, { limit: Number(options.limit) });
    if (runs.length === 0) console.log(dim("No runs."));
    runs.forEach(printRunLine);
  } finally {
    await services.close();
  }
}

export function skillList(options: GlobalOptions): void {
  const loaded = load(options);
  const policy = new AllowlistPolicy(loaded.config.tools.allow);
  // MCP tools are not connected here; skills that rely on them show as unavailable.
  const registry = buildRegistry();
  const skills = loadSkills(loaded).list();
  if (skills.length === 0) console.log(dim(`No skills found in: ${loaded.config.skills.dirs.join(", ")}`));
  for (const s of skills) {
    const tools = s.tools.map((name) => {
      const tool = registry.get(name);
      return tool !== undefined && policy.check(tool).allowed ? name : yellow(`${name} (unavailable)`);
    });
    console.log(`${bold(s.name)} ${dim(`v${s.version}`)}  ${s.description}`);
    console.log(dim(`  tools: ${tools.join(", ") || "-"}   triggers: ${s.triggers.slice(0, 8).join(", ")}${s.triggers.length > 8 ? ", …" : ""}`));
  }
}

export async function toolList(options: GlobalOptions): Promise<void> {
  const loaded = load(options);
  const policy = new AllowlistPolicy(loaded.config.tools.allow);
  const mcp = await connectMcp(loaded);
  try {
    reportMcpFailures(mcp);
    for (const tool of buildRegistry(mcp).list()) {
      const decision = policy.check(tool);
      const state = decision.allowed ? green("allowed") : yellow(`denied (${decision.reason})`);
      console.log(`${bold(tool.name.padEnd(28))} ${tool.risk.padEnd(12)} ${state}`);
      console.log(dim(`  ${tool.description}`));
    }
  } finally {
    await mcp.close();
  }
}

function printMcpStatus(s: McpServerStatus, policy: AllowlistPolicy, mcp: McpManager): void {
  const state = s.state === "connected" ? green("connected") : s.state === "failed" ? red("failed") : dim("disabled");
  const info = s.serverInfo !== undefined ? dim(` ${s.serverInfo.name} ${s.serverInfo.version}`) : "";
  console.log(`${bold(s.name)} ${dim(`(${s.transport})`)} ${state}${info}`);
  if (s.error !== undefined) console.log(red(`  ${s.error.split("\n").join("\n  ")}`));
  const tools = new Map(mcp.tools().map((t) => [t.name, t]));
  for (const name of s.tools) {
    const tool = tools.get(name);
    const allowed = tool !== undefined && policy.check(tool).allowed;
    console.log(`  ${name.padEnd(36)} ${allowed ? green("allowed") : yellow("denied")}  ${dim(tool?.risk ?? "")}`);
  }
}

export async function mcpList(options: GlobalOptions): Promise<void> {
  const loaded = load(options);
  const servers = Object.keys(loaded.config.mcp.servers);
  if (servers.length === 0) {
    console.log(dim("No MCP servers configured. Add them under mcp.servers in banglaclaw.yaml (see banglaclaw.example.yaml)."));
    return;
  }
  const policy = new AllowlistPolicy(loaded.config.tools.allow);
  const mcp = await connectMcp(loaded);
  try {
    for (const s of mcp.status()) printMcpStatus(s, policy, mcp);
    if (mcp.status().some((s) => s.state === "failed")) process.exitCode = 1;
  } finally {
    await mcp.close();
  }
}

export async function dbMigrate(options: GlobalOptions): Promise<void> {
  const postgres = openPostgres(load(options));
  try {
    await postgres.migrate();
    const { applied, available } = await postgres.migrationStatus();
    console.log(`${green("✔")} Database migrated (${applied}/${available} migrations, checkpoint tables ready)`);
  } finally {
    await postgres.close();
  }
}

export async function dbStatus(options: GlobalOptions): Promise<void> {
  const postgres = openPostgres(load(options));
  try {
    await postgres.ping();
    const { applied, available } = await postgres.migrationStatus();
    const ok = applied >= available;
    console.log(`${ok ? green("✔") : yellow("!")} ${applied}/${available} migrations applied${ok ? "" : " — run `banglaclaw db migrate`"}`);
    if (!ok) process.exitCode = 1;
  } finally {
    await postgres.close();
  }
}

const CONFIG_TEMPLATE = `# BanglaClaw configuration. API keys and DATABASE_URL come from environment variables only.
agent:
  name: banglaclaw

models:
  default:
    provider: openai-compatible   # or: anthropic
    model: gpt-4o-mini
    # baseUrl: http://localhost:11434/v1

runtime:
  maxIterations: 6
  maxToolCalls: 8
  timeoutMs: 60000

tools:
  allow: [calculator, current_datetime, search_knowledge, remember, recall, forget]   # add "bangladesh__*" for an MCP server

storage:
  provider: memory                # or: postgres (needs DATABASE_URL, then \`banglaclaw db migrate\`)
  checkpoints: true

memory:
  maxHistoryMessages: 20
  longTerm:
    enabled: false               # remember/recall/forget tools, scoped per user/chat
    autoRecall: true             # add relevant memories to the prompt each run
    recallLimit: 5
    maxPerOwner: 200

embeddings:
  model: text-embedding-3-small  # uses OPENAI_API_KEY (or EMBEDDINGS_API_KEY)
  # baseUrl: http://localhost:11434/v1   # e.g. Ollama with model: bge-m3

knowledge:
  enabled: false                 # search_knowledge tool (RAG over your documents)
  vectorStore: memory            # memory (rebuilt on start) | qdrant (persistent)
  vectorStoreUrl: http://localhost:56333   # Qdrant from docker/compose.yaml
  sources: []                    # files/dirs ingested on start, e.g. [docs/faq, policies.pdf]
  chunkSize: 1200
  chunkOverlap: 150
  searchLimit: 5

gateway:
  host: 127.0.0.1            # use 0.0.0.0 only behind a reverse proxy / firewall
  port: 3000
  corsOrigins: []            # e.g. [https://app.example.com]
  maxInputChars: 8000
  rateLimit:
    requestsPerMinute: 60    # per API key
    maxConcurrentRuns: 2     # per API key

skills:
  dirs: [skills]
  maxActive: 2

channels:
  web:
    enabled: true                # browser chat at http://<gateway>/chat
  telegram:
    enabled: false               # needs TELEGRAM_BOT_TOKEN (from @BotFather)
    mode: polling                # polling (no public URL) | webhook (needs webhookUrl + TELEGRAM_WEBHOOK_SECRET)
    # webhookUrl: https://bot.example.com
    access: allowlist            # allowlist | open — every message costs model tokens
    allowedUserIds: []           # your numeric Telegram user id(s)
    rateLimitPerMinute: 10       # per chat
  whatsapp:
    enabled: false               # needs WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN
    # phoneNumberId: "123456789012345"
    access: allowlist
    allowedNumbers: []           # e.g. ["8801712345678"]
    rateLimitPerMinute: 10

mcp:
  servers: {}
  # Example: the bundled Bangladesh reference-data server (run from the repo root).
  # Its tools are named bangladesh__<tool> and must be allowed in tools.allow.
  # servers:
  #   bangladesh:
  #     transport: stdio
  #     command: node
  #     args: [--import, tsx, mcp-servers/bangladesh/src/bin.ts]   # or: [mcp-servers/bangladesh/dist/bin.js] after pnpm build
  #     timeoutMs: 30000
  #   remote:
  #     transport: http
  #     url: https://mcp.example.com/mcp
  #     headers: { Authorization: "Bearer \${REMOTE_MCP_TOKEN}" }   # \${VAR} is read from the environment

timezone: Asia/Dhaka
`;

export function init(options: { force?: boolean }): void {
  const path = resolve("banglaclaw.yaml");
  if (existsSync(path) && options.force !== true) {
    throw new BanglaClawError("CONFIG_EXISTS", `${path} already exists (use --force to overwrite)`);
  }
  writeFileSync(path, CONFIG_TEMPLATE);
  console.log(`${green("✔")} Wrote ${path}`);
}

export async function doctor(options: GlobalOptions): Promise<void> {
  let failed = false;
  const ok = (msg: string) => console.log(`${green("✔")} ${msg}`);
  const warn = (msg: string) => console.log(`${yellow("!")} ${msg}`);
  const fail = (msg: string) => {
    failed = true;
    console.log(`${red("✖")} ${msg}`);
  };

  const [major] = process.versions.node.split(".").map(Number);
  if ((major ?? 0) >= 22) ok(`Node.js ${process.versions.node}`);
  else fail(`Node.js ${process.versions.node} — BanglaClaw needs Node.js 22 or newer`);

  let loaded;
  try {
    loaded = load(options);
  } catch (error) {
    fail(describe(error));
    process.exitCode = 1;
    return;
  }
  const { config, secrets, source } = loaded;
  ok(source !== undefined ? `Config loaded from ${source}` : "No banglaclaw.yaml found — using defaults (run `banglaclaw init`)");
  if (existsSync(resolve(".env"))) ok(`Environment file loaded: ${resolve(".env")} (shell variables take precedence)`);

  const model = config.models.default;
  ok(`Model: ${model.provider}:${model.model}${model.baseUrl !== undefined ? ` @ ${model.baseUrl}` : ""}`);

  const keyEnv = requiredApiKeyEnv(model);
  const hasKey = keyEnv === "ANTHROPIC_API_KEY" ? secrets.anthropicApiKey !== undefined : secrets.openaiApiKey !== undefined;
  if (keyEnv === undefined) ok("No API key required for this base URL");
  else if (hasKey) ok(`${keyEnv} is set`);
  else fail(`${keyEnv} is not set — export it or add it to your environment`);

  // Knowledge/memory tools are allowed by default but only exist when enabled; don't flag them as unknown.
  const optional = new Set(["search_knowledge", "remember", "recall", "forget"]);
  const registry = buildRegistry();
  const unknown = config.tools.allow.filter((name) => registry.get(name) === undefined && !optional.has(name) && !name.includes("__"));
  if (unknown.length > 0) warn(`Unknown tools in tools.allow: ${unknown.join(", ")}`);
  ok(`Tools allowed: ${config.tools.allow.join(", ") || "(none)"}`);
  ok(`Limits: ${config.runtime.maxIterations} iterations, ${config.runtime.maxToolCalls} tool calls, ${config.runtime.timeoutMs}ms timeout`);

  try {
    const skills = loadSkills(loaded).list();
    ok(`Skills: ${skills.map((s) => s.name).join(", ") || `(none in ${config.skills.dirs.join(", ")})`}`);
    for (const s of skills) {
      const missing = s.tools.filter((t) => !config.tools.allow.includes(t) || registry.get(t) === undefined);
      if (missing.length > 0) warn(`Skill ${s.name} needs tools that are not available: ${missing.join(", ")}`);
    }
  } catch (error) {
    fail(describe(error));
  }

  const servers = Object.keys(config.mcp.servers);
  if (servers.length === 0) {
    ok("MCP: no servers configured");
  } else {
    const mcp = await connectMcp(loaded);
    try {
      for (const s of mcp.status()) {
        if (s.state === "connected") ok(`MCP ${s.name}: connected, ${s.tools.length} tools`);
        else if (s.state === "disabled") ok(`MCP ${s.name}: disabled`);
        else fail(`MCP ${s.name}: ${firstLine(s.error)}`);
      }
      const policy = new AllowlistPolicy(config.tools.allow);
      const denied = mcp.tools().filter((t) => !policy.check(t).allowed).length;
      if (denied > 0) warn(`${denied} MCP tools are not in tools.allow (add e.g. "<server>__*" to enable them)`);
    } finally {
      await mcp.close();
    }
  }

  if (config.knowledge.enabled || config.memory.longTerm.enabled) {
    try {
      const knowledge = setupKnowledge(loaded, new InMemorySessionStore(), createLogger({ level: "error" }));
      await (knowledge.kb ?? knowledge.memory)?.init();
      ok(`Knowledge: ${config.embeddings.model} embeddings, ${knowledge.vectorStore} vector store${knowledge.vectorStore === "qdrant" ? ` (${config.knowledge.vectorStoreUrl})` : ""}`);
      if (knowledge.kb !== undefined) {
        ok(`Knowledge base: ${config.knowledge.sources.length} source path(s)${knowledge.vectorStore === "qdrant" ? `, ${(await knowledge.kb.listDocuments()).length} documents stored` : ""}`);
      }
      if (knowledge.memory !== undefined) {
        if (knowledge.vectorStore === "memory") warn("Long-term memory uses the in-memory vector store and is lost on restart");
        else ok("Long-term memory: enabled");
      }
      const unallowed = knowledge.tools.filter((t) => !new AllowlistPolicy(config.tools.allow).check(t).allowed).map((t) => t.name);
      if (unallowed.length > 0) warn(`Not in tools.allow: ${unallowed.join(", ")}`);
    } catch (error) {
      fail(`Knowledge: ${describe(error)}`);
    }
  }

  const tg = config.channels.telegram;
  if (tg.enabled) {
    if (secrets.telegramBotToken === undefined) fail("Telegram: TELEGRAM_BOT_TOKEN is not set");
    else {
      try {
        const me = await new TelegramApi(secrets.telegramBotToken).getMe();
        ok(`Telegram: @${me.username} (${tg.mode}, access ${tg.access}${tg.access === "allowlist" ? `: ${tg.allowedUserIds.length} users` : ""})`);
      } catch (error) {
        fail(`Telegram: ${describe(error)}`);
      }
      if (tg.mode === "webhook" && (tg.webhookUrl === undefined || secrets.telegramWebhookSecret === undefined)) fail("Telegram webhook mode needs channels.telegram.webhookUrl and TELEGRAM_WEBHOOK_SECRET");
      if (tg.access === "allowlist" && tg.allowedUserIds.length === 0) warn("Telegram allowlist is empty — nobody will be answered");
    }
  }
  const wa = config.channels.whatsapp;
  if (wa.enabled) {
    const missing = [
      wa.phoneNumberId === undefined && "phoneNumberId",
      secrets.whatsappAccessToken === undefined && "WHATSAPP_ACCESS_TOKEN",
      secrets.whatsappAppSecret === undefined && "WHATSAPP_APP_SECRET",
      secrets.whatsappVerifyToken === undefined && "WHATSAPP_VERIFY_TOKEN",
    ].filter(Boolean);
    if (missing.length > 0) fail(`WhatsApp: missing ${missing.join(", ")}`);
    else ok(`WhatsApp: configured (webhook /channels/whatsapp/webhook, access ${wa.access})`);
  }

  if (config.storage.provider === "memory") {
    ok("Storage: memory (nothing persists between runs)");
  } else {
    try {
      const postgres = openPostgres(loaded);
      try {
        await postgres.ping();
        const { applied, available } = await postgres.migrationStatus();
        if (applied >= available) ok(`Storage: postgres, ${applied}/${available} migrations applied`);
        else fail(`Storage: postgres, schema behind (${applied}/${available}) — run \`banglaclaw db migrate\``);
      } finally {
        await postgres.close();
      }
    } catch (error) {
      fail(`Storage: postgres — ${describe(error)}`);
    }
  }

  if (failed) process.exitCode = 1;
}

export function planned(what: string, version: string): () => void {
  return () => {
    console.log(dim(`${what} is planned for ${version}. See docs/20-roadmap.md.`));
  };
}

export function describe(error: unknown): string {
  if (error instanceof BanglaClawError) return error.message;
  if (error instanceof AggregateError && error.errors.length > 0) return describe(error.errors[0]);
  return error instanceof Error ? error.message : String(error);
}

export async function serve(options: GlobalOptions & { port?: string; host?: string }): Promise<void> {
  const bundle = await createRuntime(options);
  const { services, mcp } = bundle;
  const config = services.loaded.config;
  const gatewayConfig = {
    ...config.gateway,
    ...(options.port !== undefined && { port: Number(options.port) }),
    ...(options.host !== undefined && { host: options.host }),
  };
  if (!Number.isInteger(gatewayConfig.port) || gatewayConfig.port < 0 || gatewayConfig.port > 65_535) {
    await services.close();
    throw new BanglaClawError("INVALID_PORT", `Invalid port: ${options.port ?? ""}`);
  }

  const logger = createLogger({ level: parseLogLevel(process.env.BANGLACLAW_LOG_LEVEL, "info") });
  try {
    await prepareKnowledge(bundle.knowledge, true);
  } catch (error) {
    await services.close();
    throw error;
  }
  let channels;
  try {
    channels = setupChannels(services.loaded, bundle.runtime, services.sessions, logger);
  } catch (error) {
    await services.close();
    throw error;
  }

  const authenticator = new ApiKeyAuthenticator(services.auth);
  let devToken: string | undefined;
  if (!services.persistent) {
    // Memory storage has no persistent keys: issue one for this process only.
    devToken = (await authenticator.issueKey("dev", "temporary")).token;
  }

  let gateway: RunningGateway;
  try {
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
      version: "0.6.0",
      logger,
      routes: channels.routes,
      webChat: config.channels.web.enabled,
      ...(bundle.knowledge.kb !== undefined && { knowledge: { kb: bundle.knowledge.kb, searchLimit: config.knowledge.searchLimit, minScore: config.knowledge.minScore } }),
      ...(bundle.knowledge.memory !== undefined && { memory: bundle.knowledge.memory }),
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

  console.log(`${green("✔")} BanglaClaw gateway listening on ${bold(gateway.url)} ${dim(`(${bundle.providerId}, ${services.persistent ? "postgres" : "memory"} storage)`)}`);
  reportMcpFailures(mcp);
  if (config.channels.web.enabled) console.log(`  web chat: ${gateway.url}/chat`);
  for (const line of channels.summary) console.log(`  ${line}`);
  for (const line of channels.warnings) console.log(yellow(`! ${line}`));
  if (devToken !== undefined) {
    console.log(yellow("! Memory storage: using a temporary API key valid until this process exits:"));
    console.log(`  ${devToken}`);
    console.log(dim("  Use postgres storage and `banglaclaw key create` for persistent keys."));
  }
  console.log(dim(`  curl -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"text":"হ্যালো"}' ${gateway.url}/v1/agents/run`));

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      console.log(dim("\nShutting down…"));
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
  await channels.stop();
  await gateway.close();
  await services.close();
}

async function withPersistentAuth<T>(options: GlobalOptions, fn: (auth: ApiKeyAuthenticator, services: Services) => Promise<T>): Promise<T> {
  const services = await openServices(options);
  try {
    if (!services.persistent) {
      throw new BanglaClawError(
        "STORAGE_REQUIRED",
        "API keys persist only with postgres storage (set BANGLACLAW_STORAGE=postgres and DATABASE_URL). `banglaclaw serve` issues a temporary key in memory mode.",
      );
    }
    return await fn(new ApiKeyAuthenticator(services.auth), services);
  } finally {
    await services.close();
  }
}

export async function keyCreate(options: GlobalOptions & { user: string; name: string }): Promise<void> {
  await withPersistentAuth(options, async (auth) => {
    const issued = await auth.issueKey(options.user, options.name);
    console.log(`${green("✔")} Created key ${bold(issued.key.id)} "${issued.key.name}" for user ${bold(issued.user.name)}`);
    console.log(yellow("  Store this token now — it cannot be shown again:"));
    console.log(`  ${issued.token}`);
  });
}

export async function keyList(options: GlobalOptions & { user?: string }): Promise<void> {
  await withPersistentAuth(options, async (auth) => {
    const users = new Map((await auth.store.listUsers()).map((u) => [u.id, u]));
    let userId: string | undefined;
    if (options.user !== undefined) {
      userId = (await auth.store.findUserByName(options.user))?.id;
      if (userId === undefined) throw new BanglaClawError("USER_NOT_FOUND", `User not found: ${options.user}`);
    }
    const keys = await auth.store.listApiKeys(userId !== undefined ? { userId } : {});
    if (keys.length === 0) console.log(dim("No API keys."));
    for (const k of keys) {
      const state = k.revokedAt !== undefined ? red("revoked") : green("active");
      const used = k.lastUsedAt !== undefined ? `last used ${k.lastUsedAt.toISOString()}` : "never used";
      console.log(`${bold(k.id)}  ${state.padEnd(8)} ${(users.get(k.userId)?.name ?? k.userId).padEnd(16)} ${k.name.padEnd(12)} ${dim(`created ${k.createdAt.toISOString()} · ${used}`)}`);
    }
  });
}

export async function keyRevoke(id: string, options: GlobalOptions): Promise<void> {
  await withPersistentAuth(options, async (auth) => {
    if (!(await auth.store.revokeApiKey(id))) throw new BanglaClawError("KEY_NOT_FOUND", `No active key with id ${id}`);
    console.log(`${green("✔")} Revoked key ${id}`);
  });
}

/** Ingests knowledge.sources before a run/serve and reports on stderr. */
async function prepareKnowledge(knowledge: KnowledgeSetup, verbose: boolean): Promise<void> {
  if (knowledge.kb === undefined) return;
  const { ingested, skipped, errors } = await knowledge.ingestSources();
  if (verbose || ingested > 0) {
    process.stderr.write(dim(`knowledge (${knowledge.vectorStore}): ${ingested} documents ingested, ${skipped} unchanged\n`));
  }
  for (const e of errors) process.stderr.write(yellow(`! could not ingest ${e.path}: ${e.error}\n`));
  if (knowledge.vectorStore === "memory" && verbose) {
    process.stderr.write(dim("  in-memory vectors are rebuilt on every start; use knowledge.vectorStore: qdrant to persist\n"));
  }
}

function openKnowledge(options: GlobalOptions): { knowledge: KnowledgeSetup; loaded: LoadedConfig } {
  const loaded = load(options);
  const knowledge = setupKnowledge(loaded, new InMemorySessionStore(), createLogger({ level: parseLogLevel(process.env.BANGLACLAW_LOG_LEVEL) }));
  return { knowledge, loaded };
}

function requireKb(knowledge: KnowledgeSetup): KnowledgeBase {
  if (knowledge.kb === undefined) throw new BanglaClawError("KNOWLEDGE_DISABLED", "knowledge.enabled is false in banglaclaw.yaml");
  return knowledge.kb;
}

export async function kbIngest(paths: string[], options: GlobalOptions): Promise<void> {
  const { knowledge, loaded } = openKnowledge(options);
  const kb = requireKb(knowledge);
  if (knowledge.vectorStore === "memory") {
    throw new BanglaClawError("PERSISTENT_STORE_REQUIRED", "knowledge.vectorStore is memory, so ingested documents would vanish on exit. Use qdrant, or list files under knowledge.sources to ingest them on every start.");
  }
  // Paths are typed relative to the shell's cwd; sources are named relative to the config file like knowledge.sources.
  const { results, errors } = await kb.ingestPaths(paths.map((p) => resolve(p)), loaded.baseDir);
  for (const r of results) console.log(`${r.skipped ? dim("= unchanged") : green("+ ingested ")} ${r.source} ${dim(`(${r.chunks} chunks)`)}`);
  for (const e of errors) console.log(red(`✖ ${e.path}: ${e.error}`));
  if (results.length === 0 && errors.length === 0) console.log(dim("No supported files found (.txt .md .html .pdf)."));
  if (errors.length > 0) process.exitCode = 1;
}

export async function kbList(options: GlobalOptions): Promise<void> {
  const { knowledge } = openKnowledge(options);
  const kb = requireKb(knowledge);
  if (knowledge.vectorStore === "memory") await prepareKnowledge(knowledge, false);
  const docs = await kb.listDocuments();
  if (docs.length === 0) console.log(dim("No documents."));
  for (const d of docs) console.log(`${bold(d.source)}  ${d.title !== d.source ? d.title : ""} ${dim(`${d.chunkCount} chunks · ${d.ingestedAt}`)}`);
}

export async function kbSearch(query: string, options: GlobalOptions & { limit: string }): Promise<void> {
  const { knowledge, loaded } = openKnowledge(options);
  const kb = requireKb(knowledge);
  if (knowledge.vectorStore === "memory") await prepareKnowledge(knowledge, false);
  const hits = await kb.search(query, { limit: Number(options.limit), minScore: loaded.config.knowledge.minScore });
  if (hits.length === 0) console.log(dim("No matches."));
  for (const h of hits) {
    console.log(`${bold(`${h.source}#${h.chunkIndex}`)} ${dim(`score ${h.score}`)}`);
    console.log(`  ${h.text.slice(0, 300).replace(/\s+/g, " ")}${h.text.length > 300 ? "…" : ""}`);
  }
}

export async function kbDelete(source: string, options: GlobalOptions): Promise<void> {
  const { knowledge } = openKnowledge(options);
  if (!(await requireKb(knowledge).deleteDocument(source))) throw new BanglaClawError("DOCUMENT_NOT_FOUND", `No document ${source}`);
  console.log(`${green("✔")} Deleted ${source}`);
}

function requireMemory(knowledge: KnowledgeSetup): LongTermMemory {
  if (knowledge.memory === undefined) throw new BanglaClawError("MEMORY_DISABLED", "memory.longTerm.enabled is false in banglaclaw.yaml");
  if (knowledge.vectorStore === "memory") throw new BanglaClawError("PERSISTENT_STORE_REQUIRED", "Long-term memories only persist with knowledge.vectorStore: qdrant");
  return knowledge.memory;
}

export async function memoryList(options: GlobalOptions & { owner: string }): Promise<void> {
  const memory = requireMemory(openKnowledge(options).knowledge);
  const items = await memory.list(options.owner);
  if (items.length === 0) console.log(dim(`No memories for ${options.owner}.`));
  for (const m of items) console.log(`${bold(m.id)}  ${m.text} ${dim(m.createdAt)}`);
}

export async function memoryForget(id: string, options: GlobalOptions & { owner: string }): Promise<void> {
  const memory = requireMemory(openKnowledge(options).knowledge);
  if (!(await memory.forget(options.owner, id))) throw new BanglaClawError("MEMORY_NOT_FOUND", `No memory ${id} for ${options.owner}`);
  console.log(`${green("✔")} Forgot ${id}`);
}
