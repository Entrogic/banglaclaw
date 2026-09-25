import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ConfigError } from "@banglaclaw/shared";

/** Reserved: the supervisor/default agent and the pseudo-agent used while a human owns a session. */
export const RESERVED_AGENT_NAMES = ["supervisor", "human"] as const;

export const AgentFrontmatterSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/, "use kebab-case (a-z, 0-9, -), max 31 chars"),
  /** Shown to the supervisor to decide when to transfer. */
  description: z.string().min(1).max(500),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default("0.1.0"),
  /** Tools this agent may use (narrows the global tools.allow; never widens it). Omit for none. */
  tools: z.array(z.string().min(1)).default([]),
  /** Skills this agent may activate. Omit for all skills. */
  skills: z.array(z.string().min(1)).optional(),
});

/** A specialist agent defined in agents/<name>/AGENT.md. */
export interface AgentProfile {
  name: string;
  description: string;
  version: string;
  tools: string[];
  skills?: string[];
  instructions: string;
  path?: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseAgentProfile(markdown: string, path?: string): AgentProfile {
  const where = path ?? "AGENT.md";
  const match = FRONTMATTER.exec(markdown.replace(/^﻿/, ""));
  if (match === null) throw new ConfigError(`${where}: missing YAML frontmatter (--- … ---)`);
  let raw: unknown;
  try {
    raw = parseYaml(match[1] ?? "");
  } catch (error) {
    throw new ConfigError(`${where}: invalid YAML frontmatter`, { cause: error });
  }
  const parsed = AgentFrontmatterSchema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`${where}: invalid agent frontmatter\n${z.prettifyError(parsed.error)}`);
  if ((RESERVED_AGENT_NAMES as readonly string[]).includes(parsed.data.name)) {
    throw new ConfigError(`${where}: "${parsed.data.name}" is a reserved agent name`);
  }
  const instructions = (match[2] ?? "").trim();
  if (instructions === "") throw new ConfigError(`${where}: agent has no instructions`);
  const { skills, ...rest } = parsed.data;
  return { ...rest, ...(skills !== undefined && { skills }), instructions, ...(path !== undefined && { path }) };
}

/** Discovers `<dir>/<agent>/AGENT.md`. Missing dirs are skipped; invalid or duplicate agents fail loudly. */
export function loadAgentProfiles(dirs: readonly string[], baseDir = process.cwd()): AgentProfile[] {
  const out: AgentProfile[] = [];
  const seen = new Map<string, string>();
  for (const dir of dirs) {
    const root = resolve(baseDir, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).sort()) {
      const file = join(root, entry, "AGENT.md");
      if (!statSync(join(root, entry)).isDirectory() || !existsSync(file)) continue;
      const profile = parseAgentProfile(readFileSync(file, "utf8"), file);
      const previous = seen.get(profile.name);
      if (previous !== undefined) throw new ConfigError(`Duplicate agent "${profile.name}" in ${file} and ${previous}`);
      seen.set(profile.name, file);
      out.push(profile);
    }
  }
  return out;
}

/** Tool name used by the supervisor to hand a conversation to an agent. */
export function transferToolName(agent: string): string {
  return `transfer_to_${agent.replace(/-/g, "_")}`;
}
