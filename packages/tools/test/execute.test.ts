import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolAuditEvent } from "@banglaclaw/shared";
import {
  AllowlistPolicy,
  ToolRegistry,
  builtinTools,
  calculatorTool,
  createDatetimeTool,
  defineTool,
  executeTool,
  type ToolContext,
} from "../src/index.js";

const ctx: ToolContext = {
  runId: "run-1",
  sessionId: "s-1",
  timezone: "Asia/Dhaka",
  signal: new AbortController().signal,
};

const deleteEverything = defineTool({
  name: "delete_everything",
  description: "Deletes all data",
  risk: "destructive",
  inputSchema: z.strictObject({}),
  outputSchema: z.strictObject({ deleted: z.boolean() }),
  async execute() {
    throw new Error("must never run");
  },
});

const slow = defineTool({
  name: "slow",
  description: "Never resolves in time",
  risk: "safe",
  timeoutMs: 20,
  inputSchema: z.strictObject({}),
  outputSchema: z.strictObject({}),
  execute: () => new Promise(() => {}),
});

const liar = defineTool({
  name: "liar",
  description: "Returns output that violates its schema",
  risk: "safe",
  inputSchema: z.strictObject({}),
  outputSchema: z.strictObject({ n: z.number() }),
  execute: async () => ({ n: "not a number" }) as unknown as { n: number },
});

function setup(allow: string[]) {
  const registry = new ToolRegistry();
  for (const tool of [...builtinTools, deleteEverything, slow, liar]) registry.register(tool);
  const audits: ToolAuditEvent[] = [];
  const run = (name: string, args: unknown) =>
    executeTool({ id: "call-1", name, args }, { registry, policy: new AllowlistPolicy(allow), ctx, onAudit: (e) => audits.push(e) });
  return { run, audits, registry };
}

describe("executeTool", () => {
  it("runs an allowed tool and audits it", async () => {
    const { run, audits } = setup(["calculator"]);
    const result = await run("calculator", { expression: "2 + 2" });
    expect(result.audit.status).toBe("ok");
    expect(JSON.parse(result.content)).toEqual({ expression: "2 + 2", result: 4 });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ runId: "run-1", toolCallId: "call-1", tool: "calculator", status: "ok" });
  });

  it("rejects invalid input before the permission check", async () => {
    const { run } = setup([]);
    const result = await run("calculator", { expr: "2 + 2" });
    expect(result.audit.status).toBe("invalid_input");
    expect(JSON.parse(result.content)).toMatchObject({ error: "invalid_input" });
  });

  it("denies tools that are not allowlisted", async () => {
    const { run } = setup(["current_datetime"]);
    const result = await run("calculator", { expression: "1" });
    expect(result.audit.status).toBe("denied");
    expect(result.audit.error).toMatch(/not in the allowlist/);
  });

  it("denies destructive tools even when allowlisted", async () => {
    const { run } = setup(["delete_everything"]);
    const result = await run("delete_everything", {});
    expect(result.audit.status).toBe("denied");
    expect(result.audit.error).toMatch(/destructive/);
  });

  it("reports unknown tools", async () => {
    const { run } = setup([]);
    expect((await run("rm_rf", {})).audit.status).toBe("unknown_tool");
  });

  it("turns tool errors into observations", async () => {
    const { run } = setup(["calculator"]);
    const result = await run("calculator", { expression: "1 / 0" });
    expect(result.audit.status).toBe("error");
    expect(result.audit.error).toMatch(/Division by zero/);
  });

  it("times out slow tools", async () => {
    const { run } = setup(["slow"]);
    expect((await run("slow", {})).audit.status).toBe("error");
  });

  it("validates tool output", async () => {
    const { run } = setup(["liar"]);
    expect((await run("liar", {})).audit.status).toBe("invalid_output");
  });
});

describe("ToolRegistry", () => {
  it("produces JSON schema specs for model binding", () => {
    const { registry } = setup([]);
    const [spec] = registry.toSpecs(registry.list().filter((t) => t.name === "calculator"));
    expect(spec).toMatchObject({
      type: "function",
      function: {
        name: "calculator",
        parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
      },
    });
    expect(spec?.function.parameters).not.toHaveProperty("$schema");
  });

  it("rejects duplicate and non-snake_case names", () => {
    const registry = new ToolRegistry().register(calculatorTool);
    expect(() => registry.register(calculatorTool)).toThrow(/already registered/);
    expect(() => registry.register({ ...deleteEverything, name: "doStuff" })).toThrow(/snake_case/);
  });
});

describe("current_datetime", () => {
  it("formats the time in the context timezone", async () => {
    const tool = createDatetimeTool(() => new Date("2026-02-21T06:30:00Z"));
    const out = await tool.execute({}, ctx);
    expect(out.timezone).toBe("Asia/Dhaka");
    expect(out.iso).toBe("2026-02-21T06:30:00.000Z");
    expect(out.english).toMatch(/12:30/);
    expect(out.bangla).toMatch(/ফেব্রুয়ারী|ফেব্রুয়ারি/);
  });

  it("rejects unknown timezones", () => {
    expect(createDatetimeTool().inputSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
  });
});
