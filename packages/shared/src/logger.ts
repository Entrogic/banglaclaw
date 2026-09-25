export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /key|token|secret|password|authorization|cookie/i;

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  child(ctx: LogContext): Logger;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export interface LoggerOptions {
  level?: LogLevel;
  context?: LogContext;
  write?: (line: string) => void;
}

/** Structured JSON logger writing to stderr so it never mixes with streamed agent output. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const base = options.context ?? {};
  const write = options.write ?? ((line: string) => process.stderr.write(line + "\n"));

  const log = (lvl: LogLevel, msg: string, ctx?: LogContext) => {
    if (LEVELS[lvl] < LEVELS[level]) return;
    const entry = redact({ time: new Date().toISOString(), level: lvl, msg, ...base, ...ctx });
    write(JSON.stringify(entry));
  };

  return {
    debug: (msg, ctx) => log("debug", msg, ctx),
    info: (msg, ctx) => log("info", msg, ctx),
    warn: (msg, ctx) => log("warn", msg, ctx),
    error: (msg, ctx) => log("error", msg, ctx),
    child: (ctx) => createLogger({ level, write, context: { ...base, ...ctx } }),
  };
}

export function parseLogLevel(value: string | undefined, fallback: LogLevel = "warn"): LogLevel {
  return value !== undefined && value in LEVELS ? (value as LogLevel) : fallback;
}
