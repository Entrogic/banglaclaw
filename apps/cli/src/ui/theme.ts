import { styleText } from "node:util";

type Style = Parameters<typeof styleText>[0];

function defaultColor(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  const force = process.env.FORCE_COLOR;
  if (force !== undefined && force !== "") return force !== "0";
  return process.stdout.isTTY === true;
}

let enabled = defaultColor();

/** Turns ANSI colors on/off (`--no-color`, NO_COLOR, FORCE_COLOR, non-TTY output). */
export function setColor(on: boolean): void {
  enabled = on;
}

export function colorEnabled(): boolean {
  return enabled;
}

const paint = (style: Style) => (text: string) => (enabled ? styleText(style, text, { validateStream: false }) : text);

export const c = {
  bold: paint("bold"),
  dim: paint("dim"),
  italic: paint("italic"),
  green: paint("green"),
  red: paint("red"),
  yellow: paint("yellow"),
  cyan: paint("cyan"),
  magenta: paint("magenta"),
  gray: paint("gray"),
};

/**
 * Ink colours for the chat UI (src/tui), matching the dashboard and web chat palette. `ink()` returns
 * undefined while colour is off, so `--no-color` and NO_COLOR reach Ink as plain text.
 */
export const palette = {
  brand: "#1f9d74",
  accent: "#e5484d",
  agent: "magenta",
  pending: "cyan",
  ok: "gray",
  warn: "yellow",
  error: "red",
  muted: "gray",
} as const;

export function ink(name: keyof typeof palette): string | undefined {
  return enabled ? palette[name] : undefined;
}

export const sym = {
  ok: "✔",
  warn: "!",
  fail: "✖",
  info: "ℹ",
  arrow: "→",
  transfer: "↪",
  tool: "⚙",
  bullet: "•",
  paw: "🐾",
} as const;

export type CheckStatus = "ok" | "warn" | "fail";

export function statusSymbol(status: CheckStatus): string {
  return status === "ok" ? c.green(sym.ok) : status === "warn" ? c.yellow(sym.warn) : c.red(sym.fail);
}

/** Colors a padded table cell by its (trimmed) status word, keeping the padding intact. */
export function statusCell(text: string): string {
  const word = text.trimEnd();
  return statusWord(word) + text.slice(word.length);
}

/** Colors a run/tool/check status word consistently. */
export function statusWord(status: string): string {
  if (["completed", "ok", "active", "connected", "success", "allowed"].includes(status)) return c.green(status);
  if (["limited", "handoff", "denied", "disabled", "revoked", "warn"].includes(status)) return c.yellow(status);
  if (["error", "failed", "aborted", "failure", "fail"].includes(status)) return c.red(status);
  return status;
}
