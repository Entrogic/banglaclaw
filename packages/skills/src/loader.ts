import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ConfigError } from "@entrogic-net/shared";
import { parseSkill, type Skill } from "./skill.js";

/**
 * Discovers `<dir>/<skill>/SKILL.md` in each directory. Missing directories are skipped;
 * invalid or duplicate skills fail loudly so broken skills are never silently ignored.
 */
export function loadSkillsFromDirs(dirs: readonly string[], baseDir = process.cwd()): Skill[] {
  const skills: Skill[] = [];
  const seen = new Map<string, string>();

  for (const dir of dirs) {
    const root = resolve(baseDir, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).sort()) {
      const skillDir = join(root, entry);
      const file = join(skillDir, "SKILL.md");
      if (!statSync(skillDir).isDirectory() || !existsSync(file)) continue;

      const skill = parseSkill(readFileSync(file, "utf8"), file);
      const previous = seen.get(skill.name);
      if (previous !== undefined) throw new ConfigError(`Duplicate skill "${skill.name}" in ${file} and ${previous}`);
      seen.set(skill.name, file);
      skills.push(skill);
    }
  }
  return skills;
}
