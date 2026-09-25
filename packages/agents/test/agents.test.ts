import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError } from "@banglaclaw/shared";
import { loadAgentProfiles, parseAgentProfile, transferToolName } from "../src/index.js";

const sales = `---
name: sales
description: Product questions, prices and orders
tools: [search_knowledge, calculator]
skills: [calculation]
---
You are the sales specialist.
`;

describe("AGENT.md", () => {
  it("parses profiles", () => {
    expect(parseAgentProfile(sales)).toEqual({
      name: "sales", description: "Product questions, prices and orders", version: "0.1.0",
      tools: ["search_knowledge", "calculator"], skills: ["calculation"], instructions: "You are the sales specialist.",
    });
    expect(parseAgentProfile(sales.replace("skills: [calculation]\n", "")).skills).toBeUndefined();
    expect(transferToolName("customer-support")).toBe("transfer_to_customer_support");
  });

  it.each([
    ["reserved name", sales.replace("name: sales", "name: supervisor")],
    ["bad name", sales.replace("name: sales", "name: Sales Team")],
    ["unknown key", sales.replace("tools:", "model: gpt-4o\ntools:")],
    ["no body", sales.replace("You are the sales specialist.\n", "")],
    ["no frontmatter", "hello"],
  ])("rejects %s", (_label, md) => {
    expect(() => parseAgentProfile(md, "x/AGENT.md")).toThrow(ConfigError);
  });

  it("loads directories and rejects duplicates", () => {
    const root = mkdtempSync(join(tmpdir(), "banglaclaw-agents-"));
    for (const [dir, md] of [["a/sales", sales], ["a/support", sales.replace("name: sales", "name: support")], ["b/other", sales]] as const) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "AGENT.md"), md);
    }
    expect(loadAgentProfiles(["a", "missing"], root).map((p) => p.name)).toEqual(["sales", "support"]);
    expect(() => loadAgentProfiles(["a", "b"], root)).toThrow(/Duplicate agent "sales"/);
  });
});
