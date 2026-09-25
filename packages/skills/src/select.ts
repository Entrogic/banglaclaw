import type { Skill } from "./skill.js";

const BENGALI = /\p{Script=Bengali}/u;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a matcher for one trigger. Bengali script has no reliable word boundaries (suffixes
 * attach directly: হিসাব → হিসাবটা), so Bengali triggers match as substrings; Latin triggers
 * match whole words/phrases.
 */
function matcher(trigger: string): (text: string) => boolean {
  const t = trigger.normalize("NFC").toLowerCase().trim();
  if (BENGALI.test(t)) return (text) => text.includes(t);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(t).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "u");
  return (text) => re.test(text);
}

export interface SkillMatch {
  skill: Skill;
  score: number;
  matched: string[];
}

export class SkillSet {
  readonly #skills: Skill[];
  readonly #matchers: Map<string, { trigger: string; test: (text: string) => boolean }[]>;

  constructor(skills: readonly Skill[]) {
    this.#skills = [...skills];
    this.#matchers = new Map(skills.map((s) => [s.name, s.triggers.map((trigger) => ({ trigger, test: matcher(trigger) }))]));
  }

  list(): Skill[] {
    return [...this.#skills];
  }

  get(name: string): Skill | undefined {
    return this.#skills.find((s) => s.name === name);
  }

  /** Deterministic skill discovery (no model call): rank by number of matched triggers. */
  select(text: string, maxActive: number): SkillMatch[] {
    if (maxActive <= 0) return [];
    const normalized = text.normalize("NFC").toLowerCase();
    return this.#skills
      .map((skill) => {
        const matched = (this.#matchers.get(skill.name) ?? []).filter((m) => m.test(normalized)).map((m) => m.trigger);
        return { skill, score: matched.length, matched };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
      .slice(0, maxActive);
  }
}
