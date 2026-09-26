import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "@entrogic-net/shared";
import { loadSkills } from "../src/bootstrap.js";

function skill(root: string, name: string, description: string): void {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\nversion: 1.0.0\ntriggers: [${name}]\n---\n\nInstructions for ${name}.\n`);
}

function setup(yaml = "") {
  const dir = mkdtempSync(join(tmpdir(), "bc-skills-"));
  const builtin = join(dir, "builtin");
  skill(builtin, "calculation", "built-in calculation");
  skill(builtin, "time-and-date", "built-in time");
  skill(join(dir, "skills"), "calculation", "my own calculation");
  skill(join(dir, "skills"), "shop", "my shop");
  writeFileSync(join(dir, "banglaclaw.yaml"), yaml);
  return { loaded: loadConfig({ cwd: dir, env: {} }), builtin };
}

describe("built-in skills", () => {
  it("adds bundled skills that configured skills don't override", () => {
    const { loaded, builtin } = setup();
    const skills = loadSkills(loaded, [], builtin).list();
    expect(skills.map((s) => s.name).sort()).toEqual(["calculation", "shop", "time-and-date"]);
    expect(skills.find((s) => s.name === "calculation")?.description).toBe("my own calculation");
  });

  it("loads only configured skills when skills.builtin is false", () => {
    const { loaded, builtin } = setup("skills:\n  builtin: false\n");
    expect(loadSkills(loaded, [], builtin).list().map((s) => s.name).sort()).toEqual(["calculation", "shop"]);
  });
});
