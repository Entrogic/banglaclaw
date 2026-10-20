import { describe, expect, it } from "vitest";
import { InMemoryEvalStore, summarizeEval } from "../src/index.js";

const metric = (name: string, score: number | undefined, success: boolean) => ({ name, threshold: 0.7, success, ...(score !== undefined && { score }) });

describe("evals", () => {
  it("summarises pass counts and mean scores per metric", () => {
    const summary = summarizeEval([
      { metrics: [metric("Answer Relevancy", 0.9, true), metric("Faithfulness", 0.8, true)] },
      { metrics: [metric("Answer Relevancy", 0.4, false), metric("Faithfulness", undefined, false)] },
      { metrics: [] },
    ]);
    expect(summary).toEqual({
      caseCount: 3,
      passedCount: 1,
      metrics: [
        { name: "Answer Relevancy", avgScore: 0.65, passed: 1, total: 2 },
        { name: "Faithfulness", avgScore: 0.8, passed: 1, total: 2 },
      ],
    });
  });

  it("stores runs with cases, lists newest first and deletes", async () => {
    const store = new InMemoryEvalStore();
    const first = await store.save({ name: "nightly", framework: "deepeval", cases: [{ input: "ঢাকার জনসংখ্যা?", metrics: [metric("Answer Relevancy", 1, true)] }] });
    await store.save({ name: "smoke", framework: "deepeval", cases: [] });
    expect((await store.list()).map((r) => r.name)).toEqual(["smoke", "nightly"]);
    expect((await store.list({ name: "nightly" }))[0]).toMatchObject({ id: first.id, caseCount: 1, passedCount: 1 });
    expect((await store.get(first.id))?.cases[0]).toMatchObject({ input: "ঢাকার জনসংখ্যা?", success: true });
    expect(await store.delete(first.id)).toBe(true);
    expect(await store.get(first.id)).toBeUndefined();
  });
});
