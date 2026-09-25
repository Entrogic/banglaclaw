import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { AgentRunError, type AgentRuntime } from "@banglaclaw/agent";
import { requiredApiKeyEnv } from "@banglaclaw/providers";
import { SessionManager, type RunRecord, type Session } from "@banglaclaw/session";
import { BanglaClawError } from "@banglaclaw/shared";
import { AllowlistPolicy } from "@banglaclaw/tools";
import { buildRegistry, createRuntime, load, loadSkills, openPostgres, openServices, type GlobalOptions, type Services } from "./bootstrap.js";
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

function memoryNotice(services: Services): void {
  if (!services.persistent) {
    console.log(dim("storage.provider is memory — sessions and runs are not kept between CLI invocations."));
  }
}

export async function agentRun(message: string, options: SessionOption): Promise<void> {
  const { runtime, services } = await createRuntime(options);
  try {
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
  const { runtime, services } = await createRuntime(options);
  let { session, created } = await resolveSession(runtime, services, options.session).catch(async (error: unknown) => {
    await services.close();
    throw error;
  });
  const render = createRenderer();
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let active: AbortController | undefined;
  rl.on("SIGINT", () => {
    if (active !== undefined) active.abort();
    else rl.close();
  });

  const model = services.loaded.config.models.default;
  console.log(bold("🐾 BanglaClaw") + dim(` — ${model.provider}:${model.model} · ${services.persistent ? "postgres" : "memory"} storage`));
  if (!created) {
    const count = await runtime.sessions.countMessages(session.id);
    console.log(dim(`Resumed session ${session.id} (${count} messages)`));
  }
  console.log(dim("Type in Bangla, Banglish or English. /new starts a new session, /session shows its id, /exit quits.\n"));

  try {
    for (;;) {
      let input: string;
      try {
        input = (await rl.question(green("› "))).trim();
      } catch {
        break; // readline closed (Ctrl+C / Ctrl+D)
      }
      if (input === "") continue;
      if (input === "/exit" || input === "/quit") break;
      if (input === "/session") {
        console.log(dim(session.id));
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

export function toolList(options: GlobalOptions): void {
  const { config } = load(options);
  const policy = new AllowlistPolicy(config.tools.allow);
  for (const tool of buildRegistry().list()) {
    const decision = policy.check(tool);
    const state = decision.allowed ? green("allowed") : yellow(`denied (${decision.reason})`);
    console.log(`${bold(tool.name.padEnd(18))} ${tool.risk.padEnd(12)} ${state}`);
    console.log(dim(`  ${tool.description}`));
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
  allow: [calculator, current_datetime]

storage:
  provider: memory                # or: postgres (needs DATABASE_URL, then \`banglaclaw db migrate\`)
  checkpoints: true

memory:
  maxHistoryMessages: 20

skills:
  dirs: [skills]
  maxActive: 2

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

  const model = config.models.default;
  ok(`Model: ${model.provider}:${model.model}${model.baseUrl !== undefined ? ` @ ${model.baseUrl}` : ""}`);

  const keyEnv = requiredApiKeyEnv(model);
  const hasKey = keyEnv === "ANTHROPIC_API_KEY" ? secrets.anthropicApiKey !== undefined : secrets.openaiApiKey !== undefined;
  if (keyEnv === undefined) ok("No API key required for this base URL");
  else if (hasKey) ok(`${keyEnv} is set`);
  else fail(`${keyEnv} is not set — export it or add it to your environment`);

  const registry = buildRegistry();
  const unknown = config.tools.allow.filter((name) => registry.get(name) === undefined);
  if (unknown.length > 0) warn(`Unknown tools in tools.allow: ${unknown.join(", ")}`);
  ok(`Tools allowed: ${config.tools.allow.filter((n) => registry.get(n) !== undefined).join(", ") || "(none)"}`);
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
