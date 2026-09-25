import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { AgentRunError } from "@banglaclaw/agent";
import { requiredApiKeyEnv } from "@banglaclaw/providers";
import { BanglaClawError } from "@banglaclaw/shared";
import { AllowlistPolicy } from "@banglaclaw/tools";
import { buildRegistry, createRuntime, load, type GlobalOptions } from "./bootstrap.js";
import { bold, createRenderer, dim, green, red, yellow } from "./render.js";

export async function agentRun(message: string, options: GlobalOptions): Promise<void> {
  const { runtime } = createRuntime(options);
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  const record = await runtime.run(message, {
    sessionId: randomUUID(),
    onEvent: createRenderer(),
    signal: controller.signal,
  });
  if (record.status === "limited") process.exitCode = 2;
}

export async function chat(options: GlobalOptions): Promise<void> {
  const { runtime, loaded } = createRuntime(options);
  const sessionId = randomUUID();
  const render = createRenderer();
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let active: AbortController | undefined;
  rl.on("SIGINT", () => {
    if (active !== undefined) {
      active.abort();
    } else {
      rl.close();
    }
  });

  const model = loaded.config.models.default;
  console.log(bold("🐾 BanglaClaw") + dim(` — ${model.provider}:${model.model}`));
  console.log(dim("Type in Bangla, Banglish or English. /reset clears history, /exit quits.\n"));

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
      if (input === "/reset") {
        runtime.resetSession(sessionId);
        console.log(dim("History cleared."));
        continue;
      }

      active = new AbortController();
      try {
        await runtime.run(input, { sessionId, onEvent: render, signal: active.signal });
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

export function doctor(options: GlobalOptions): void {
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
  ok(source !== undefined ? `Config loaded from ${source}` : "No banglaclaw.yaml found — using defaults (see banglaclaw.example.yaml)");

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

  if (failed) process.exitCode = 1;
}

export function planned(what: string, version: string): () => void {
  return () => {
    console.log(dim(`${what} is planned for ${version}. See docs/20-roadmap.md.`));
  };
}

export function describe(error: unknown): string {
  if (error instanceof BanglaClawError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
