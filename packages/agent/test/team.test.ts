import { describe, expect, it } from "vitest";
import { parseAgentProfile } from "@banglaclaw/agents";
import { FakeProvider, type ScriptedTurn } from "@banglaclaw/providers";
import { InMemoryRunStore, InMemorySessionStore, type Session } from "@banglaclaw/session";
import { createLogger, type NewAuditEvent, type RunEvent } from "@banglaclaw/shared";
import { AllowlistPolicy, ToolRegistry, builtinTools } from "@banglaclaw/tools";
import { AgentRuntime, HANDOFF_MESSAGES } from "../src/index.js";

const silent = createLogger({ write: () => {} });
const sales = parseAgentProfile("---\nname: sales\ndescription: Prices and orders\ntools: [calculator]\n---\nSALES-INSTRUCTIONS: quote prices in taka.\n");
const support = parseAgentProfile("---\nname: support\ndescription: Delivery problems and complaints\n---\nSUPPORT-INSTRUCTIONS: be empathetic.\n");

function setup(script: ScriptedTurn[], team: { handoff?: boolean; maxTransfers?: number } = {}) {
  const provider = new FakeProvider(script);
  const sessions = new InMemorySessionStore();
  const runs = new InMemoryRunStore();
  const registry = new ToolRegistry();
  for (const tool of builtinTools) registry.register(tool);
  const handoffs: [string, string][] = [];
  const audits: NewAuditEvent[] = [];
  const runtime = new AgentRuntime({
    audit: (e) => audits.push(e),
    provider, registry, policy: new AllowlistPolicy(["calculator", "current_datetime"]), sessions, runs,
    limits: { maxIterations: 8, maxToolCalls: 8 }, timeoutMs: 5_000, timezone: "Asia/Dhaka", logger: silent,
    team: { profiles: [sales, support], handoff: team.handoff ?? false, maxTransfers: team.maxTransfers ?? 3 },
    onHandoff: (session: Session, reason: string) => {
      handoffs.push([session.id, reason]);
    },
  });
  const events: RunEvent[] = [];
  let session: Session | undefined;
  const run = async (text: string) => {
    session ??= await sessions.create({ channel: "telegram", externalId: "1", agentId: "banglaclaw" });
    return runtime.run(text, { sessionId: session.id, onEvent: (e) => events.push(e) });
  };
  const current = async () => sessions.get(session?.id ?? "");
  return { provider, sessions, run, events, current, handoffs, audits };
}

const system = (provider: FakeProvider, call: number) => String(provider.calls[call]?.messages[0]?.content);

describe("multi-agent team", () => {
  it("supervisor transfers to a specialist that answers with its own tools and instructions", async () => {
    const { provider, run, events, current } = setup([
      { toolCalls: [{ name: "transfer_to_sales", args: { reason: "price question" } }] },
      { content: "এর দাম ৫০০ টাকা।" },
      { content: "Follow-up from sales" },
    ]);
    const record = await run("এই শার্টের দাম কত?");
    expect(record).toMatchObject({ status: "completed", output: "এর দাম ৫০০ টাকা।", agent: "sales", agentPath: ["supervisor", "sales"] });
    // calculator is claimed by sales, so only unclaimed tools stay with the supervisor.
    expect(provider.calls[0]?.toolNames).toEqual(["current_datetime", "transfer_to_sales", "transfer_to_support"]);
    expect(system(provider, 0)).toContain("- sales: Prices and orders");
    expect(provider.calls[1]?.toolNames).toEqual(["calculator", "transfer_to_supervisor"]);
    expect(system(provider, 1)).toContain("SALES-INSTRUCTIONS");
    expect(system(provider, 1)).toContain("already been routed to you");
    expect(events).toContainEqual(expect.objectContaining({ type: "agent_transfer", from: "supervisor", to: "sales" }));
    expect((await current())?.activeAgent).toBe("sales");

    // The next message goes straight to the active specialist.
    const next = await run("আর নীল রঙের?");
    expect(next.agentPath).toEqual(["sales"]);
    expect(system(provider, 2)).toContain("SALES-INSTRUCTIONS");
    expect(events.filter((e) => e.type === "run_start").map((e) => (e.type === "run_start" ? e.agent : ""))).toEqual(["supervisor", "sales"]);
  });

  it("keeps specialists inside their tool subset and lets them hand back", async () => {
    const { provider, run, current, audits } = setup([
      { toolCalls: [{ name: "transfer_to_support", args: {} }] },
      { toolCalls: [{ name: "current_datetime", args: {} }] },
      { toolCalls: [{ name: "transfer_to_supervisor", args: { reason: "not a delivery issue" } }] },
      { content: "Supervisor answering" },
    ]);
    const record = await run("my parcel is late, also what time is it");
    expect(provider.calls[1]?.toolNames).toEqual(["transfer_to_supervisor"]);
    expect(record.toolCalls.find((c) => c.tool === "current_datetime")).toMatchObject({ status: "denied", error: expect.stringMatching(/not available to agent support/) });
    expect(record).toMatchObject({ agent: "supervisor", agentPath: ["supervisor", "support", "supervisor"], output: "Supervisor answering" });
    expect((await current())?.activeAgent).toBeUndefined();
    expect(audits).toContainEqual(expect.objectContaining({ action: "tool.denied", outcome: "denied", target: "current_datetime" }));
  });

  it("stops agent ping-pong at maxTransfers", async () => {
    const { run } = setup(
      [
        { toolCalls: [{ name: "transfer_to_sales", args: {} }] },
        { toolCalls: [{ name: "transfer_to_supervisor", args: {} }] },
        { toolCalls: [{ name: "transfer_to_sales", args: {} }] },
        { content: "ok I'll answer" },
      ],
      { maxTransfers: 2 },
    );
    const record = await run("hi");
    expect(record.agentPath).toEqual(["supervisor", "sales", "supervisor"]);
    expect(record.toolCalls.at(-1)).toMatchObject({ tool: "transfer_to_sales", status: "error", error: expect.stringMatching(/Transfer limit/) });
    expect(record.output).toBe("ok I'll answer");
  });

  it("hands the session to a human and stays silent until released", async () => {
    const { provider, run, current, handoffs, sessions, audits } = setup(
      [{ toolCalls: [{ name: "request_human", args: { reason: "refund over limit" } }] }, { content: "bot is back" }],
      { handoff: true },
    );
    const record = await run("ami refund chai, 5000 taka");
    expect(provider.calls[0]?.toolNames).toContain("request_human");
    expect(record).toMatchObject({ status: "handoff", stopReason: "handoff", handoffReason: "refund over limit", output: HANDOFF_MESSAGES["bn-en"] });
    const s = await current();
    expect(s).toMatchObject({ status: "handoff", handoffReason: "refund over limit" });
    expect(handoffs).toEqual([[s?.id, "refund over limit"]]);
    expect(audits).toContainEqual(expect.objectContaining({ action: "handoff.requested", target: s?.id }));

    const whileHanded = await run("hello? keu achen?");
    expect(whileHanded).toMatchObject({ status: "handoff", agent: "human", provider: "human" });
    expect(whileHanded).not.toHaveProperty("output");
    expect(provider.calls).toHaveLength(1);
    expect((await sessions.recentMessages(s?.id ?? "", 1))[0]?.content).toBe("hello? keu achen?");

    await sessions.update(s?.id ?? "", { status: "active" });
    expect((await run("thanks")).output).toBe("bot is back");
  });

  it("does not offer request_human unless handoff is enabled", async () => {
    const { provider, run } = setup([{ content: "hi" }]);
    await run("hi");
    expect(provider.calls[0]?.toolNames).not.toContain("request_human");
  });
});
