import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MAX = 500;

/** ~/.config/banglaclaw/history (override with BANGLACLAW_HISTORY_FILE; empty string disables). */
export function historyFile(): string | undefined {
  const override = process.env.BANGLACLAW_HISTORY_FILE;
  if (override !== undefined) return override === "" ? undefined : override;
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "banglaclaw", "history");
}

export function loadHistory(file = historyFile()): string[] {
  if (file === undefined || !existsSync(file)) return [];
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as string)
      .slice(-MAX);
  } catch {
    return [];
  }
}

export function appendHistory(entry: string, file = historyFile()): void {
  if (file === undefined) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    if (lines.length > MAX * 1.2) writeFileSync(file, `${lines.slice(-MAX).join("\n")}\n`, { mode: 0o600 });
  } catch {
    // History is a convenience; never break the chat over it.
  }
}
