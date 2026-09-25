import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

/**
 * Loads `.env` from the working directory into process.env. Variables already set in the
 * shell take precedence, so `export FOO=…` always overrides the file. Returns the loaded path.
 */
export function loadDotEnv(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): string | undefined {
  const path = resolve(cwd, ".env");
  if (!existsSync(path)) return undefined;
  const parsed = parseEnv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined && value !== undefined) env[key] = value;
  }
  return path;
}
