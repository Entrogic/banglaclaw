import { AgentRunError } from "@banglaclaw/agent";
import { BanglaClawError, ConfigError } from "@banglaclaw/shared";
import { isJson } from "./output.js";
import { c, sym } from "./theme.js";

export const EXIT = {
  OK: 0,
  ERROR: 1,
  /** A run stopped at an iteration/tool-call limit. */
  LIMIT: 2,
  CONFIG: 3,
  /** A prerequisite (storage, feature, key) is missing. */
  PREREQUISITE: 4,
  CANCELLED: 130,
} as const;

export class CliError extends Error {
  readonly hint: string | undefined;
  readonly exitCode: number;
  readonly code: string;

  constructor(message: string, options: { hint?: string; exitCode?: number; code?: string; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "CliError";
    this.hint = options.hint;
    this.exitCode = options.exitCode ?? EXIT.ERROR;
    this.code = options.code ?? "error";
  }
}

export function describe(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) return describe(error.errors[0]);
  return error instanceof Error ? error.message : String(error);
}

/** Maps any error to a CliError with an actionable hint and a stable exit code. */
export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  const message = describe(error);
  if (error instanceof AgentRunError) {
    return new CliError(message, { exitCode: error.record.status === "aborted" ? EXIT.CANCELLED : EXIT.ERROR, code: error.code.toLowerCase() });
  }
  if (error instanceof Error && error.name === "AbortError") return new CliError("Cancelled", { exitCode: EXIT.CANCELLED, code: "cancelled" });
  if (error instanceof ConfigError) {
    let hint: string | undefined;
    if (/API_KEY is not set|OPENAI_API_KEY|ANTHROPIC_API_KEY/.test(message)) hint = "Run `banglaclaw init` to set up a model provider, or add the key to .env";
    else if (/schema is behind/.test(message)) hint = "Run `banglaclaw db migrate`";
    else if (/DATABASE_URL/.test(message)) hint = "Set DATABASE_URL (docker compose -f docker/compose.yaml up -d starts a local PostgreSQL)";
    else if (/TELEGRAM_BOT_TOKEN|WHATSAPP_/.test(message)) hint = "Add the channel secrets to .env, or disable the channel in banglaclaw.yaml";
    else if (/Config file not found/.test(message)) hint = "Check the --config path, or run `banglaclaw init` to create banglaclaw.yaml";
    else if (/Invalid configuration|YAML/.test(message)) hint = "Check banglaclaw.yaml (see banglaclaw.example.yaml) or run `banglaclaw doctor`";
    return new CliError(message, { exitCode: EXIT.CONFIG, code: "config_error", ...(hint !== undefined && { hint }) });
  }
  if (error instanceof BanglaClawError) {
    const code = error.code.toLowerCase();
    switch (error.code) {
      case "STORAGE_REQUIRED":
        return new CliError(message, { exitCode: EXIT.PREREQUISITE, code, hint: "Use PostgreSQL: set BANGLACLAW_STORAGE=postgres and DATABASE_URL, then `banglaclaw db migrate`" });
      case "PERSISTENT_STORE_REQUIRED":
        return new CliError(message, { exitCode: EXIT.PREREQUISITE, code, hint: "Set knowledge.vectorStore: qdrant (docker compose -f docker/compose.yaml up -d starts Qdrant on :56333)" });
      case "KNOWLEDGE_DISABLED":
      case "MEMORY_DISABLED":
        return new CliError(message, { exitCode: EXIT.PREREQUISITE, code, hint: "Enable it in banglaclaw.yaml, or run `banglaclaw init`" });
      case "CONFIG_EXISTS":
        return new CliError(message, { exitCode: EXIT.CONFIG, code, hint: "Pass --force to overwrite" });
      default:
        return new CliError(message, { code });
    }
  }
  return new CliError(message);
}

/** Prints an error to stderr (or as JSON under --json). */
export function printError(error: CliError): void {
  if (isJson()) {
    process.stdout.write(`${JSON.stringify({ error: { code: error.code, message: error.message, ...(error.hint !== undefined && { hint: error.hint }) } }, null, 2)}\n`);
    return;
  }
  process.stderr.write(`${c.red(`${sym.fail} ${error.message}`)}\n`);
  if (error.hint !== undefined) process.stderr.write(`${c.dim(`  hint: ${error.hint}`)}\n`);
}
