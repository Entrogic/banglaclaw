import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { MessengerApi, TelegramApi } from "@entrogic-net/channels";
import { requiredApiKeyEnv } from "@entrogic-net/providers";
import { InMemorySessionStore } from "@entrogic-net/session";
import { createLogger, type LoadedConfig } from "@entrogic-net/shared";
import { AllowlistPolicy, type AnyTool } from "@entrogic-net/tools";
import { buildRegistry, connectMcp, load, loadAgents, loadSkills, openPostgres, type GlobalOptions } from "../bootstrap.js";
import { setupKnowledge } from "../knowledge.js";
import { loadPlugins } from "../plugins.js";
import { describe } from "../ui/errors.js";
import { emit, print } from "../ui/output.js";
import { withSpinner } from "../ui/spinner.js";
import { c, statusSymbol, type CheckStatus } from "../ui/theme.js";
import { firstLine } from "./shared.js";
import { workspaceTools } from "../workspace.js";

export interface Check {
  section: "Environment" | "Model" | "Tools" | "Integrations" | "Storage";
  status: CheckStatus;
  message: string;
}

/** Tool shape for allowlist checks of names that only exist at runtime. */
const stub = (name: string): AnyTool => ({ name, description: "", risk: "safe", inputSchema: undefined as never, outputSchema: undefined as never, execute: async () => undefined });

/** Runs all diagnostics without printing; shared by `doctor` and the init wizard. */
export async function collectChecks(options: GlobalOptions): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (section: Check["section"], status: CheckStatus, message: string) => checks.push({ section, status, message });

  const [major] = process.versions.node.split(".").map(Number);
  add("Environment", (major ?? 0) >= 22 ? "ok" : "fail", `Node.js ${process.versions.node}${(major ?? 0) >= 22 ? "" : " — BanglaClaw needs Node.js 22+"}`);

  let loaded: LoadedConfig;
  try {
    loaded = load(options);
  } catch (error) {
    add("Environment", "fail", describe(error));
    return checks;
  }
  const { config, secrets, source } = loaded;
  add("Environment", source !== undefined ? "ok" : "warn", source !== undefined ? `Config ${source}` : "No banglaclaw.yaml — using defaults (run `banglaclaw init`)");
  if (existsSync(resolve(".env"))) add("Environment", "ok", `Environment file ${resolve(".env")}`);
  const otel = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  add("Environment", "ok", otel !== undefined && otel !== "" ? `Tracing → ${otel}` : "Tracing off (set OTEL_EXPORTER_OTLP_ENDPOINT to export traces)");

  const model = config.models.default;
  add("Model", "ok", `${model.provider}:${model.model}${model.baseUrl !== undefined ? ` @ ${model.baseUrl}` : ""}`);
  const keyEnv = requiredApiKeyEnv(model);
  const hasKey = keyEnv === "ANTHROPIC_API_KEY" ? secrets.anthropicApiKey !== undefined : secrets.openaiApiKey !== undefined;
  if (keyEnv === undefined) add("Model", "ok", "No API key needed for this base URL");
  else add("Model", hasKey ? "ok" : "fail", hasKey ? `${keyEnv} is set` : `${keyEnv} is not set — run \`banglaclaw init\` or add it to .env`);
  add("Model", "ok", `Limits: ${config.runtime.maxIterations} iterations, ${config.runtime.maxToolCalls} tool calls, ${config.runtime.timeoutMs / 1000}s timeout`);

  const policy = new AllowlistPolicy(config.tools.allow);
  const optional = new Set(["search_knowledge", "remember", "recall", "forget"]);
  let pluginTools: AnyTool[] = [];
  try {
    const plugins = await loadPlugins(loaded);
    pluginTools = plugins.flatMap((p) => p.plugin.tools ?? []);
    if (plugins.length > 0) add("Tools", "ok", `Plugins: ${plugins.map((p) => `${p.plugin.name}@${p.plugin.version}`).join(", ")}`);
    const denied = pluginTools.filter((t) => !policy.check(t).allowed).map((t) => t.name);
    if (denied.length > 0) add("Tools", "warn", `Plugin tools not in tools.allow: ${denied.join(", ")}`);
  } catch (error) {
    add("Tools", "fail", describe(error));
  }
  const registry = buildRegistry(undefined, pluginTools);
  const unknown = config.tools.allow.filter((n) => registry.get(n) === undefined && !optional.has(n) && !n.includes("__") && !n.endsWith("*"));
  add("Tools", "ok", `Allowed: ${config.tools.allow.join(", ") || "(none)"}`);
  if (unknown.length > 0) add("Tools", "warn", `Unknown tools in tools.allow: ${unknown.join(", ")}`);
  try {
    const skills = loadSkills(loaded).list();
    add("Tools", "ok", `Skills: ${skills.map((s) => s.name).join(", ") || `(none in ${config.skills.dirs.join(", ")})`}`);
  } catch (error) {
    add("Tools", "fail", describe(error));
  }
  try {
    const profiles = loadAgents(loaded);
    if (profiles.length > 0) add("Tools", "ok", `Agents: supervisor → ${profiles.map((p) => p.name).join(", ")}`);
    const notAllowed = profiles.flatMap((p) => p.tools.filter((t) => !policy.check(stub(t)).allowed).map((t) => `${p.name}:${t}`));
    if (notAllowed.length > 0) add("Tools", "warn", `Agent tools not in tools.allow: ${notAllowed.join(", ")}`);
  } catch (error) {
    add("Tools", "fail", describe(error));
  }
  const ws = config.workspace;
  if (ws.enabled) {
    const dir = resolve(loaded.baseDir, ws.dir);
    try {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, constants.W_OK);
      add("Tools", "ok", `Workspace ${dir} (channels: ${ws.channels.join(", ")})`);
    } catch (error) {
      add("Tools", "fail", `Workspace ${dir} is not writable: ${describe(error)}`);
    }
    const policy = new AllowlistPolicy(config.tools.allow);
    const allowed = workspaceTools(loaded, new InMemorySessionStore()).filter((tool) => policy.check(tool).allowed);
    if (allowed.length === 0) add("Tools", "warn", "Workspace is on but no workspace_* tool is in tools.allow");
  }
  if (config.handoff.enabled) add("Tools", "ok", `Human handoff enabled${secrets.handoffWebhookUrl !== undefined ? " (webhook notifications on)" : ""}`);

  if (Object.keys(config.mcp.servers).length > 0) {
    const mcp = await connectMcp(loaded);
    try {
      for (const s of mcp.status()) {
        if (s.state === "connected") add("Integrations", "ok", `MCP ${s.name}: ${s.tools.length} tools`);
        else if (s.state === "disabled") add("Integrations", "ok", `MCP ${s.name}: disabled`);
        else add("Integrations", "fail", `MCP ${s.name}: ${firstLine(s.error)}`);
      }
    } finally {
      await mcp.close();
    }
  }
  if (config.knowledge.enabled || config.memory.longTerm.enabled) {
    try {
      const knowledge = setupKnowledge(loaded, new InMemorySessionStore(), createLogger({ level: "error" }));
      await (knowledge.kb ?? knowledge.memory)?.init();
      add("Integrations", "ok", `Knowledge: ${config.embeddings.model}, ${knowledge.vectorStore} vectors${knowledge.vectorStore === "qdrant" ? ` @ ${config.knowledge.vectorStoreUrl}` : ""}`);
      if (knowledge.memory !== undefined && knowledge.vectorStore === "memory") add("Integrations", "warn", "Long-term memory uses in-memory vectors (lost on restart)");
    } catch (error) {
      add("Integrations", "fail", `Knowledge: ${describe(error)}`);
    }
  }
  const tg = config.channels.telegram;
  if (tg.enabled) {
    if (secrets.telegramBotToken === undefined) add("Integrations", "fail", "Telegram: TELEGRAM_BOT_TOKEN is not set");
    else {
      try {
        const me = await new TelegramApi(secrets.telegramBotToken).getMe();
        add("Integrations", "ok", `Telegram @${me.username} (${tg.mode}, ${tg.access}${tg.access === "allowlist" ? `: ${tg.allowedUserIds.length} users` : ""})`);
      } catch (error) {
        add("Integrations", "fail", `Telegram: ${describe(error)}`);
      }
      if (tg.access === "allowlist" && tg.allowedUserIds.length === 0) add("Integrations", "warn", "Telegram allowlist is empty — nobody will be answered");
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
    add("Integrations", missing.length > 0 ? "fail" : "ok", missing.length > 0 ? `WhatsApp: missing ${missing.join(", ")}` : `WhatsApp configured (${wa.access})`);
  }
  const fb = config.channels.messenger;
  if (fb.enabled) {
    const missing = [
      secrets.messengerPageAccessToken === undefined && "MESSENGER_PAGE_ACCESS_TOKEN",
      secrets.messengerAppSecret === undefined && "MESSENGER_APP_SECRET",
      secrets.messengerVerifyToken === undefined && "MESSENGER_VERIFY_TOKEN",
    ].filter(Boolean);
    if (missing.length > 0 || secrets.messengerPageAccessToken === undefined) add("Integrations", "fail", `Messenger: missing ${missing.join(", ")}`);
    else {
      try {
        const page = await new MessengerApi({ pageAccessToken: secrets.messengerPageAccessToken, graphApiVersion: fb.graphApiVersion }).getPage();
        const mismatch = fb.pageId !== undefined && fb.pageId !== page.id;
        add("Integrations", mismatch ? "fail" : "ok", `Messenger page “${page.name}” (${page.id}, ${fb.access}${fb.access === "allowlist" ? `: ${fb.allowedUserIds.length} users` : ""})${mismatch ? ` — token is for another page than channels.messenger.pageId ${fb.pageId}` : ""}`);
      } catch (error) {
        add("Integrations", "fail", `Messenger: ${describe(error)}`);
      }
      if (fb.access === "allowlist" && fb.allowedUserIds.length === 0) add("Integrations", "warn", "Messenger allowlist is empty — nobody will be answered (use access: open for a public page)");
    }
  }

  const widget = config.channels.widget;
  if (widget.enabled) {
    if (widget.allowedOrigins.length === 0) add("Integrations", "fail", "Widget: channels.widget.allowedOrigins is empty");
    else add("Integrations", widget.allowedOrigins.includes("*") ? "warn" : "ok", `Widget for ${widget.allowedOrigins.join(", ")}${widget.allowedOrigins.includes("*") ? " — any site may embed it" : ""}`);
    if (secrets.widgetSecret === undefined) add("Integrations", "warn", "Widget: BANGLACLAW_WIDGET_SECRET is not set (visitors lose their conversation on restart)");
    else if (secrets.widgetSecret.length < 32) add("Integrations", "fail", "Widget: BANGLACLAW_WIDGET_SECRET is shorter than 32 characters");
  }

  if (config.voice.enabled) {
    const keyed = secrets.transcriptionApiKey !== undefined || secrets.openaiApiKey !== undefined || config.voice.baseUrl !== undefined;
    add(
      "Integrations",
      keyed ? "ok" : "fail",
      keyed
        ? `Voice notes: ${config.voice.model}${config.voice.baseUrl !== undefined ? ` @ ${config.voice.baseUrl}` : ""}, language ${config.voice.language}, up to ${config.voice.maxSeconds} s`
        : "Voice notes: set OPENAI_API_KEY or TRANSCRIPTION_API_KEY (or voice.baseUrl)",
    );
  }

  if (config.storage.provider === "memory") add("Storage", "ok", "memory (nothing persists between runs)");
  else {
    try {
      const postgres = openPostgres(loaded);
      try {
        await postgres.ping();
        const { applied, available } = await postgres.migrationStatus();
        add("Storage", applied >= available ? "ok" : "fail", `postgres, ${applied}/${available} migrations${applied >= available ? "" : " — run `banglaclaw db migrate`"}`);
      } finally {
        await postgres.close();
      }
    } catch (error) {
      add("Storage", "fail", `postgres: ${describe(error)}`);
    }
  }
  return checks;
}

export function printChecks(checks: readonly Check[]): void {
  let section = "";
  for (const check of checks) {
    if (check.section !== section) {
      section = check.section;
      print(`\n${c.bold(section)}`);
    }
    print(`  ${statusSymbol(check.status)} ${check.message}`);
  }
  const failed = checks.filter((x) => x.status === "fail").length;
  const warned = checks.filter((x) => x.status === "warn").length;
  print();
  print(failed > 0 ? c.red(`${failed} problem${failed === 1 ? "" : "s"} found`) : warned > 0 ? c.yellow(`Ready, with ${warned} warning${warned === 1 ? "" : "s"}`) : c.green("All checks passed"));
}

export async function doctor(options: GlobalOptions): Promise<void> {
  const checks = await withSpinner("Checking your setup…", () => collectChecks(options), { done: () => "Checks complete" });
  const ok = !checks.some((x) => x.status === "fail");
  emit({ ok, checks }, () => printChecks(checks));
  if (!ok) process.exitCode = 1;
}
