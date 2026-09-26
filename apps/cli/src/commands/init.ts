import { chmodSync, cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as p from "@clack/prompts";
import { HumanMessage } from "@langchain/core/messages";
import { createProvider } from "@entrogic-net/providers";
import { BanglaClawError } from "@entrogic-net/shared";
import { PostgresStorage } from "@entrogic-net/storage";
import { DEFAULT_MODELS, buildConfigYaml, envKeys, mergeEnv, type InitAnswers, type ProviderChoice } from "../init/config.js";
import { CONFIG_TEMPLATE } from "../init/template.js";
import { EXIT, CliError, describe } from "../ui/errors.js";
import { emit, success } from "../ui/output.js";
import { c, sym } from "../ui/theme.js";
import { VERSION } from "../version.js";
import { collectChecks, printChecks } from "./doctor.js";

/** Unwraps a prompt answer; Ctrl+C / Esc cancels the whole wizard without writing anything. */
function bail<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled — nothing was written.");
    throw new CliError("Setup cancelled", { exitCode: EXIT.CANCELLED, code: "cancelled" });
  }
  return value as Exclude<T, symbol>;
}

/** Example agents shipped with the repo / Docker image. */
function examplesDir(): string | undefined {
  const candidates = [fileURLToPath(new URL("../../../../examples/agents", import.meta.url)), fileURLToPath(new URL("../../../examples/agents", import.meta.url)), "/app/examples/agents"];
  return candidates.find((d) => existsSync(d));
}

function writeTemplate(force: boolean): void {
  const path = resolve("banglaclaw.yaml");
  if (existsSync(path) && !force) throw new BanglaClawError("CONFIG_EXISTS", `${path} already exists`);
  writeFileSync(path, CONFIG_TEMPLATE);
  emit({ written: [path] }, () => success(`Wrote ${path}`));
}

async function testModel(a: InitAnswers, key: string | undefined): Promise<string | undefined> {
  const secrets = a.provider === "anthropic" ? { ...(key !== undefined && { anthropicApiKey: key }) } : { ...(key !== undefined && { openaiApiKey: key }) };
  const provider = createProvider(
    { provider: a.provider === "anthropic" ? "anthropic" : "openai-compatible", model: a.model, ...(a.baseUrl !== undefined && { baseUrl: a.baseUrl }) },
    secrets,
  );
  const reply = await provider.chat([new HumanMessage("Reply with exactly: OK")], { signal: AbortSignal.timeout(30_000) });
  return reply.text.slice(0, 40);
}

/** `banglaclaw init`: interactive onboarding (TTY) or the commented template (--yes / non-TTY). */
export async function init(options: { force?: boolean; yes?: boolean }): Promise<void> {
  if (options.yes === true || process.stdin.isTTY !== true || process.stdout.isTTY !== true) return writeTemplate(options.force === true);

  const configPath = resolve("banglaclaw.yaml");
  const envPath = resolve(".env");
  const envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const haveKeys = envKeys(envText);

  p.intro(`${c.bold(`${sym.paw} BanglaClaw ${VERSION}`)} ${c.dim("setup · সেটআপ")}`);
  if (existsSync(configPath) && options.force !== true) {
    const overwrite = bail(await p.confirm({ message: `${configPath} already exists. Replace it?`, initialValue: false }));
    if (!overwrite) {
      p.outro("Kept your existing config. Run `banglaclaw doctor` to check it.");
      return;
    }
  }

  const provider = bail(
    await p.select<ProviderChoice>({
      message: "Which model provider?",
      options: [
        { value: "openai", label: "OpenAI", hint: "gpt-4o-mini — good Bangla, low cost" },
        { value: "anthropic", label: "Anthropic Claude" },
        { value: "local", label: "Local / OpenAI-compatible", hint: "Ollama, vLLM, DeepSeek, OpenRouter…" },
      ],
    }),
  );
  let baseUrl: string | undefined;
  if (provider === "local") {
    baseUrl = bail(
      await p.text({
        message: "Base URL of the OpenAI-compatible server",
        placeholder: "http://localhost:11434/v1",
        defaultValue: "http://localhost:11434/v1",
        validate: (v) => (v === undefined || v === "" || /^https?:\/\//.test(v) ? undefined : "Must start with http:// or https://"),
      }),
    );
  }
  const model = bail(await p.text({ message: "Model", placeholder: DEFAULT_MODELS[provider], defaultValue: DEFAULT_MODELS[provider] }));

  const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const env: Record<string, string> = {};
  let key: string | undefined = provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  const keyOptional = provider === "local";
  if (haveKeys.has(keyName) || (key !== undefined && key !== "")) {
    p.log.info(`${keyName} is already set — keeping it.`);
  } else {
    const entered = bail(
      await p.password({
        message: keyOptional ? `API key for the server (optional, Enter to skip)` : `${keyName}`,
        validate: (v) => (keyOptional || (v !== undefined && v.trim().length > 10) ? undefined : "Paste your API key"),
      }),
    ).trim();
    if (entered !== "") {
      key = entered;
      env[keyName] = entered;
    }
  }

  const answers: InitAnswers = { provider, model, ...(baseUrl !== undefined && { baseUrl }), storage: "memory" };
  if (bail(await p.confirm({ message: "Test the model connection now? (one tiny request)", initialValue: true }))) {
    const s = p.spinner();
    s.start("Asking the model to say OK…");
    try {
      const reply = await testModel(answers, key);
      s.stop(`${c.green(sym.ok)} Model replied: ${reply ?? ""}`);
    } catch (error) {
      s.stop(`${c.red(sym.fail)} ${describe(error)}`);
      if (!bail(await p.confirm({ message: "Continue anyway?", initialValue: true }))) {
        p.cancel("Setup cancelled — nothing was written.");
        throw new CliError("Setup cancelled", { exitCode: EXIT.CANCELLED, code: "cancelled" });
      }
    }
  }

  answers.storage = bail(
    await p.select<"memory" | "postgres">({
      message: "Where should conversations be stored?",
      options: [
        { value: "memory", label: "Memory", hint: "zero setup, cleared on exit" },
        { value: "postgres", label: "PostgreSQL", hint: "persistent sessions, API keys, audit log" },
      ],
    }),
  );
  if (answers.storage === "postgres") {
    const url = haveKeys.has("DATABASE_URL")
      ? undefined
      : bail(
          await p.text({
            message: "DATABASE_URL",
            placeholder: "postgres://banglaclaw:banglaclaw@localhost:54329/banglaclaw",
            defaultValue: "postgres://banglaclaw:banglaclaw@localhost:54329/banglaclaw",
          }),
        );
    if (url !== undefined) env.DATABASE_URL = url;
    const dbUrl = url ?? process.env.DATABASE_URL;
    if (dbUrl !== undefined && bail(await p.confirm({ message: "Connect and apply database migrations now?", initialValue: true }))) {
      const s = p.spinner();
      s.start("Migrating…");
      const storage = new PostgresStorage(dbUrl);
      try {
        await storage.migrate();
        const { applied, available } = await storage.migrationStatus();
        s.stop(`${c.green(sym.ok)} Database ready (${applied}/${available} migrations)`);
      } catch (error) {
        s.stop(`${c.red(sym.fail)} ${describe(error)} — start one with: docker compose -f docker/compose.yaml up -d`);
      } finally {
        await storage.close();
      }
    }
  }

  const features = bail(
    await p.multiselect<"knowledge" | "memory" | "telegram" | "agents" | "handoff">({
      message: "Enable extras? (space to toggle, enter to continue)",
      required: false,
      options: [
        { value: "knowledge", label: "Knowledge base", hint: "answer from your documents (RAG)" },
        { value: "memory", label: "Long-term memory", hint: "remember users' facts" },
        { value: "telegram", label: "Telegram bot" },
        { value: "agents", label: "Example sales + support agents" },
        { value: "handoff", label: "Human handoff", hint: "agents can pass chats to a person" },
      ],
    }),
  );

  if (features.includes("knowledge") || features.includes("memory")) {
    const sources = features.includes("knowledge")
      ? bail(await p.text({ message: "Documents to ingest (comma-separated files/folders)", placeholder: "docs", defaultValue: "docs" }))
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const vectorStore = bail(
      await p.select<"memory" | "qdrant">({
        message: "Vector store",
        options: [
          { value: "memory", label: "Memory", hint: "rebuilt on every start" },
          { value: "qdrant", label: "Qdrant", hint: "persistent (docker compose provides :56333)" },
        ],
      }),
    );
    answers.knowledge = { sources, vectorStore, ...(vectorStore === "qdrant" && { qdrantUrl: "http://localhost:56333" }) };
    if (!features.includes("knowledge")) answers.knowledge.sources = [];
    answers.longTermMemory = features.includes("memory");
  }
  if (features.includes("telegram")) {
    if (!haveKeys.has("TELEGRAM_BOT_TOKEN")) env.TELEGRAM_BOT_TOKEN = bail(await p.password({ message: "TELEGRAM_BOT_TOKEN (from @BotFather)", validate: (v) => (/^\d+:[\w-]{20,}$/.test(v ?? "") ? undefined : "Looks like 123456:ABC…") }));
    const ids = bail(await p.text({ message: "Your numeric Telegram user id(s), comma-separated (blank = find it later)", defaultValue: "", placeholder: "123456789" }));
    answers.telegram = { allowedUserIds: ids.split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s)) };
  }
  if (features.includes("agents")) answers.agents = true;
  if (features.includes("handoff")) answers.handoff = true;

  // Write files.
  writeFileSync(configPath, buildConfigYaml(answers));
  const written = [configPath];
  if (Object.keys(env).length > 0) {
    const merged = mergeEnv(envText, env);
    writeFileSync(envPath, merged.text, { mode: 0o600 });
    chmodSync(envPath, 0o600);
    written.push(envPath);
    if (merged.kept.length > 0) p.log.warn(`Kept existing values for ${merged.kept.join(", ")}`);
  }
  if (answers.agents === true) {
    const from = examplesDir();
    if (from !== undefined && !existsSync(resolve("agents"))) {
      cpSync(from, resolve("agents"), { recursive: true });
      written.push(resolve("agents"));
    }
  }
  const gitignore = resolve(".gitignore");
  if (existsSync(gitignore) || existsSync(resolve(".git"))) {
    const current = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
    const missing = [".env", "banglaclaw.yaml"].filter((e) => !current.split("\n").some((l) => l.trim() === e));
    if (missing.length > 0) writeFileSync(gitignore, `${current}${current === "" || current.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
  }
  p.log.success(`Wrote ${written.map((w) => w.replace(`${process.cwd()}/`, "")).join(", ")}`);

  // .env was just written; make its values visible to the checks in this process.
  for (const [k, v] of Object.entries(env)) process.env[k] ??= v;
  const checks = await collectChecks({});
  printChecks(checks);

  const steps: [string, string][] = [
    ["banglaclaw chat", "talk to your agent"],
    ["banglaclaw serve", `start the API${answers.telegram !== undefined ? " + Telegram bot" : ""} and web chat`],
  ];
  const firstSource = answers.knowledge?.sources[0];
  if (firstSource !== undefined) steps.push([`mkdir -p ${firstSource}`, "put your documents there"]);
  const width = Math.max(...steps.map(([cmd]) => cmd.length)) + 2;
  p.note(steps.map(([cmd, what]) => `${c.bold(cmd.padEnd(width))}${what}`).join("\n"), "Next steps");
  p.outro(checks.some((x) => x.status === "fail") ? c.yellow("Setup written — fix the problems above, then run `banglaclaw doctor`.") : c.green("You're all set! · সব ঠিক আছে!"));
}
