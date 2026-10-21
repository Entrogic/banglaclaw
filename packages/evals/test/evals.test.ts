import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "@entrogic-net/agent";
import { FakeProvider, type ModelProvider, type ScriptedTurn } from "@entrogic-net/providers";
import { InMemoryRunStore, InMemorySessionStore } from "@entrogic-net/session";
import { InMemoryEvalDatasetStore, InMemoryEvalStore, createLogger, parseGoldens, type Golden } from "@entrogic-net/shared";
import { AllowlistPolicy, ToolRegistry, builtinTools } from "@entrogic-net/tools";
import { EvalJobRunner, judgePrompt, languageMatch, parseVerdict, toolCorrectness, type EvalTranscript } from "../src/index.js";

const silent = createLogger({ write: () => {} });

/** A judge that scores by rule: the prompts it saw are kept for assertions. */
class RuleJudge implements ModelProvider {
  readonly id = "judge:rules";
  readonly prompts: { system: string; user: string }[] = [];
  constructor(private readonly verdict: (system: string, user: string) => string) {}
  async chat(messages: BaseMessage[]): Promise<AIMessage> {
    const [system, user] = messages.map((m) => String(m.content));
    this.prompts.push({ system: system ?? "", user: user ?? "" });
    return new AIMessage(this.verdict(system ?? "", user ?? ""));
  }
  async *stream(): AsyncIterable<never> {
    throw new Error("not used");
  }
}

/** `judge: null` = no judge provider is available. */
function setup(script: ScriptedTurn[], judge: ModelProvider | null = new RuleJudge(() => '{"score": 9, "reason": "ঠিক আছে"}')) {
  const sessions = new InMemorySessionStore();
  const runs = new InMemoryRunStore(sessions);
  const registry = new ToolRegistry();
  for (const tool of builtinTools) registry.register(tool);
  const agent = new FakeProvider(script);
  const runtime = new AgentRuntime({ provider: agent, registry, policy: new AllowlistPolicy(["calculator"]), sessions, runs, limits: { maxIterations: 4, maxToolCalls: 4 }, timeoutMs: 5_000, timezone: "Asia/Dhaka", logger: silent });
  const evals = new InMemoryEvalStore();
  const datasets = new InMemoryEvalDatasetStore();
  const runner = new EvalJobRunner({
    runtime, sessions, evals, datasets, agentName: "banglaclaw", agentModel: () => agent.id, parallel: 1, version: "9.9.9", logger: silent,
    judge: async (id) => (judge !== null && (id === undefined || id === "judge-profile") ? judge : undefined),
  });
  return { runner, evals, datasets, sessions, agent };
}

const goldens: Golden[] = parseGoldens(`
goldens:
  - name: multiply-bn
    input: "৬ গুণ ৭ কত?"
    expected_output: "৬ × ৭ = ৪২"
    expected_tools: [calculator]
  - name: follow-up-bn
    turns: ["আমার নাম রাহিম।"]
    input: "আমার নাম কী বলেছিলাম?"
    expected_output: "আপনার নাম রাহিম।"
`);

describe("datasets", () => {
  it("parses the harness format and reports the first problem", () => {
    expect(goldens.map((g) => g.name)).toEqual(["multiply-bn", "follow-up-bn"]);
    expect(parseGoldens([{ input: "hi" }, { input: "again" }]).map((g) => g.name)).toEqual(["case-1", "case-2"]);
    expect(() => parseGoldens("goldens: []")).toThrow(/non-empty/);
    expect(() => parseGoldens([{ name: "a", input: "x" }, { name: "a", input: "y" }])).toThrow(/used twice/);
    expect(() => parseGoldens([{ name: "a", input: "x", extra: 1 }])).toThrow(/goldens\[0\]/);
    expect(() => parseGoldens([{ name: "bad name", input: "x" }])).toThrow(/goldens\[0\]\.name/);
    expect(() => parseGoldens("goldens: [unclosed")).toThrow(/YAML/);
  });
});

describe("metrics", () => {
  const t = (golden: Partial<Golden>, assistant: string, toolsCalled: string[] = []): EvalTranscript => ({
    golden: { name: "g", input: "৬ গুণ ৭ কত?", ...golden }, turns: [{ user: golden.input ?? "৬ গুণ ৭ কত?", assistant }], language: "bn", toolsCalled,
  });

  it("checks the reply language like the system prompt", () => {
    expect(languageMatch(t({}, "উত্তর হলো ৪২।"), 1).success).toBe(true);
    expect(languageMatch(t({}, "The answer is 42."), 1).success).toBe(false);
    // Banglish may be answered in Bengali script; reply_language overrides.
    expect(languageMatch(t({ input: "6 gun 7 koto?" }, "উত্তর ৪২।"), 1).success).toBe(true);
    expect(languageMatch(t({ input: "6 gun 7 koto? answer in English", reply_language: "en" }, "It is 42."), 1).success).toBe(true);
  });

  it("scores tool use against expected_tools", () => {
    expect(toolCorrectness(t({ expected_tools: ["calculator"] }, "", ["calculator"]), 1).score).toBe(1);
    expect(toolCorrectness(t({ expected_tools: ["calculator", "current_datetime"] }, "", ["calculator"]), 1).score).toBe(0.5);
    expect(toolCorrectness(t({ expected_tools: [] }, "", ["calculator"]), 1).success).toBe(false);
  });

  it("writes Bangla or English judge prompts with the Bangla-aware rules", () => {
    const bn = judgePrompt("correctness", t({ expected_output: "৪২" }, "42"), "bn");
    expect(bn.system).toContain("৪২ = 42");
    expect(bn.system).toContain("শুধু JSON");
    expect(bn.user).toContain("প্রত্যাশিত উত্তর:\n৪২");
    const en = judgePrompt("correctness", t({ expected_output: "৪২" }, "42"), "en");
    expect(en.system).toContain("Bengali and Latin digits are equivalent");
    expect(en.user).toContain("Expected output:\n৪২");
  });

  it("parses verdicts in fences or with text around them", () => {
    expect(parseVerdict('```json\n{"score": 7, "reason": "ok"}\n```')).toEqual({ score: 0.7, reason: "ok" });
    expect(parseVerdict("Verdict: {\"score\": 10}")).toEqual({ score: 1, reason: "" });
    expect(parseVerdict('{"score": 11}')).toBeUndefined();
    expect(parseVerdict("no json")).toBeUndefined();
  });
});

describe("EvalJobRunner", () => {
  it("runs every golden (turns first, in one session), scores it and records the run", async () => {
    const judge = new RuleJudge((system) => (system.includes("পুরো কথোপকথন") ? '{"score": 3, "reason": "নাম ভুলে গেছে"}' : '{"score": 9, "reason": "সঠিক"}'));
    const { runner, evals, datasets, sessions } = setup(
      [{ toolCalls: [{ name: "calculator", args: { expression: "6*7" } }] }, { content: "৬ × ৭ = ৪২" }, { content: "ঠিক আছে, রাহিম।" }, { content: "আপনার নাম রাহিম।" }],
      judge,
    );
    const dataset = await datasets.create({ name: "smoke", goldens });
    const started = await runner.start({ datasetId: dataset.id, startedBy: "admin-1" });
    expect(started).toMatchObject({ status: "running", total: 2, done: 0, judgeModel: "judge:rules", judgeLanguage: "bn" });
    await expect(runner.start({ datasetId: dataset.id })).rejects.toThrow(/already running/);

    const job = await runner.wait(started.id);
    expect(job).toMatchObject({ status: "completed", done: 2, passed: 1 });
    const recorded = await evals.get(job?.evalId ?? "");
    expect(recorded?.run).toMatchObject({ name: "smoke", dataset: "smoke", framework: "banglaclaw", frameworkVersion: "9.9.9", judgeModel: "judge:rules", agentModel: "fake:scripted", createdBy: "admin-1", caseCount: 2, passedCount: 1 });
    expect(recorded?.run.metadata).toMatchObject({ source: "dashboard", judgeLanguage: "bn" });

    const [multiply, followUp] = recorded?.cases ?? [];
    expect(multiply).toMatchObject({ name: "multiply-bn", actualOutput: "৬ × ৭ = ৪২", toolsCalled: ["calculator"], language: "bn", success: true });
    expect(multiply?.metrics.map((m) => m.name)).toEqual(["Correctness", "Answer Relevancy", "Tool Correctness", "Language Match"]);
    // The conversation metric applies only to goldens with turns, and sees the whole transcript.
    expect(followUp?.metrics.find((m) => m.name === "Conversation")).toMatchObject({ score: 0.3, success: false, reason: "নাম ভুলে গেছে" });
    const conversationPrompt = judge.prompts.find((p) => p.system.includes("পুরো কথোপকথন"));
    expect(conversationPrompt?.user).toContain("ব্যবহারকারী: আমার নাম রাহিম।\nসহকারী: ঠিক আছে, রাহিম।");

    const session = await sessions.get(followUp?.sessionId ?? "");
    expect(session).toMatchObject({ channel: "eval", userId: "admin-1" });
    expect(await sessions.countMessages(session?.id ?? "")).toBe(4);
  });

  it("records a failed agent run as a failed case and keeps going", async () => {
    const failing: ModelProvider = { id: "down", chat: () => Promise.reject(new Error("model down")), stream: async function* () { throw new Error("model down"); } };
    const sessions = new InMemorySessionStore();
    const runtime = new AgentRuntime({ provider: failing, registry: new ToolRegistry(), policy: new AllowlistPolicy([]), sessions, runs: new InMemoryRunStore(sessions), limits: { maxIterations: 2, maxToolCalls: 2 }, timeoutMs: 5_000, timezone: "Asia/Dhaka", logger: silent });
    const evals = new InMemoryEvalStore();
    const datasets = new InMemoryEvalDatasetStore();
    const runner = new EvalJobRunner({ runtime, sessions, evals, datasets, agentName: "banglaclaw", agentModel: () => "down", judge: async () => undefined, logger: silent });
    const dataset = await datasets.create({ name: "d", goldens: parseGoldens([{ input: "hi" }]) });
    const job = await runner.wait((await runner.start({ datasetId: dataset.id, metrics: ["language_match"] })).id);
    expect(job).toMatchObject({ status: "completed", passed: 0 });
    const cases = (await evals.get(job?.evalId ?? ""))?.cases;
    expect(cases?.[0]?.metrics[0]).toMatchObject({ name: "Agent Run", success: false });
    expect(cases?.[0]?.metrics[0]?.error).toMatch(/model down/);
  });

  it("needs a judge only for judge metrics, and reports bad requests", async () => {
    const { runner, datasets } = setup([{ content: "৪২" }], null);
    const dataset = await datasets.create({ name: "d", goldens: parseGoldens([{ input: "৬ গুণ ৭ কত?" }]) });
    await expect(runner.start({ datasetId: dataset.id })).rejects.toThrow(/Judge provider not found/);
    await expect(runner.start({ datasetId: "missing" })).rejects.toThrow(/Dataset not found/);
    const job = await runner.wait((await runner.start({ datasetId: dataset.id, metrics: ["language_match", "language_match"] })).id);
    expect(job).toMatchObject({ status: "completed", metrics: ["language_match"], passed: 1 });
    expect(job).not.toHaveProperty("judgeModel");
  });

  it("cancels a running job without recording it", async () => {
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const slowJudge = new RuleJudge(() => '{"score": 9}');
    const original = slowJudge.chat.bind(slowJudge);
    slowJudge.chat = async (messages) => {
      await blocked;
      return original(messages);
    };
    const { runner: slow, datasets: slowSets, evals: slowEvals } = setup([{ content: "a" }, { content: "b" }], slowJudge);
    const dataset = await slowSets.create({ name: "d", goldens: parseGoldens([{ input: "one" }, { input: "two" }]) });
    const job = await slow.start({ datasetId: dataset.id, metrics: ["answer_relevancy"] });
    expect(slow.cancel(job.id)).toBe(true);
    release();
    expect(await slow.wait(job.id)).toMatchObject({ status: "cancelled" });
    expect(await slowEvals.list()).toEqual([]);
    expect(slow.cancel(job.id)).toBe(false);
    expect(slow.list().map((j) => j.status)).toEqual(["cancelled"]);
  });
});
