import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError } from "@banglaclaw/shared";
import { SkillSet, loadSkillsFromDirs, parseSkill } from "../src/index.js";

const calc = `---
name: calculation
description: Careful arithmetic
tools: [calculator]
triggers: [calculate, percent, "how much", হিসাব, যোগ, koto hobe]
---
Always use the calculator tool.
`;

const time = `---
name: time-and-date
description: Time questions
tools: [current_datetime]
triggers: [time, date, সময়, baje, তারিখ]
---
Use current_datetime.
`;

describe("parseSkill", () => {
  it("parses frontmatter and instructions", () => {
    expect(parseSkill(calc)).toEqual({
      name: "calculation",
      description: "Careful arithmetic",
      version: "0.1.0",
      tools: ["calculator"],
      triggers: ["calculate", "percent", "how much", "হিসাব", "যোগ", "koto hobe"],
      instructions: "Always use the calculator tool.",
    });
  });

  it.each([
    ["no frontmatter", "just text"],
    ["bad name", calc.replace("name: calculation", "name: Calc Skill")],
    ["no triggers", calc.replace(/triggers:.*\n/, "")],
    ["unknown key", calc.replace("tools:", "grants: [shell]\ntools:")],
    ["empty body", calc.replace("Always use the calculator tool.\n", "")],
  ])("rejects %s", (_label, md) => {
    expect(() => parseSkill(md, "x/SKILL.md")).toThrow(ConfigError);
  });
});

describe("SkillSet.select", () => {
  const set = new SkillSet([parseSkill(calc), parseSkill(time)]);
  const names = (text: string, max = 2) => set.select(text, max).map((m) => m.skill.name);

  it.each([
    ["Calculate 15 percent of 2000", ["calculation"]],
    ["১৫০০ টাকার হিসাবটা করে দাও", ["calculation"]],
    ["eta koto hobe?", ["calculation"]],
    ["ekhon koyta baje?", ["time-and-date"]],
    ["আজকের তারিখ কত?", ["time-and-date"]],
    ["what time is it and how much is 2+2", ["calculation", "time-and-date"]],
    ["tell me a joke", []],
    ["sometimes", []],
  ])("%j → %j", (text, expected) => {
    expect(names(text)).toEqual(expected);
  });

  it("ranks by matched triggers and respects maxActive", () => {
    expect(names("calculate the percent, what time", 1)).toEqual(["calculation"]);
    expect(names("calculate", 0)).toEqual([]);
  });
});

describe("loadSkillsFromDirs", () => {
  function tree(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "banglaclaw-skills-"));
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), content);
    }
    return root;
  }

  it("discovers skills and skips missing dirs and non-skill folders", () => {
    const root = tree({ "skills/calculation/SKILL.md": calc, "skills/time/SKILL.md": time, "skills/notes/README.md": "x" });
    const skills = loadSkillsFromDirs(["skills", "missing"], root);
    expect(skills.map((s) => s.name)).toEqual(["calculation", "time-and-date"]);
    expect(skills[0]?.path).toBe(join(root, "skills/calculation/SKILL.md"));
  });

  it("fails on duplicate names", () => {
    const root = tree({ "a/one/SKILL.md": calc, "b/two/SKILL.md": calc });
    expect(() => loadSkillsFromDirs(["a", "b"], root)).toThrow(/Duplicate skill "calculation"/);
  });
});
