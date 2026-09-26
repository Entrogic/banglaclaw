import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ConfigError } from "@entrogic-net/shared";

export const SkillFrontmatterSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, "use kebab-case (a-z, 0-9, -)"),
  description: z.string().min(1).max(500),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "use semver, e.g. 0.1.0").default("0.1.0"),
  /** Tools this skill relies on. Skills never grant permissions — the tool policy still decides. */
  tools: z.array(z.string().min(1)).default([]),
  /** Case-insensitive words/phrases (any language) that activate the skill. */
  triggers: z.array(z.string().min(1)).min(1),
});

export interface Skill {
  name: string;
  description: string;
  version: string;
  tools: string[];
  triggers: string[];
  /** Markdown body injected into the system prompt when the skill is active. */
  instructions: string;
  /** Source SKILL.md path, if loaded from disk. */
  path?: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Parses a SKILL.md document: YAML frontmatter followed by markdown instructions. */
export function parseSkill(markdown: string, path?: string): Skill {
  const where = path ?? "SKILL.md";
  const match = FRONTMATTER.exec(markdown.replace(/^﻿/, ""));
  if (match === null) throw new ConfigError(`${where}: missing YAML frontmatter (--- … ---)`);

  let raw: unknown;
  try {
    raw = parseYaml(match[1] ?? "");
  } catch (error) {
    throw new ConfigError(`${where}: invalid YAML frontmatter`, { cause: error });
  }
  const parsed = SkillFrontmatterSchema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`${where}: invalid skill frontmatter\n${z.prettifyError(parsed.error)}`);

  const instructions = (match[2] ?? "").trim();
  if (instructions.length === 0) throw new ConfigError(`${where}: skill has no instructions`);

  return { ...parsed.data, instructions, ...(path !== undefined && { path }) };
}
