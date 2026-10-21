import { randomUUID } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { BanglaClawError } from "./errors.js";

/**
 * One test input, in the same shape as the DeepEval harness's datasets (evals/deepeval, docs/26).
 * `turns` are earlier user messages sent first, in the same session.
 */
export const GoldenSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/, "name must match [A-Za-z0-9._-]{1,80}"),
  input: z.string().trim().min(1).max(20_000),
  expected_output: z.string().max(20_000).optional(),
  /** [] = no tool should be called; absent = not checked. */
  expected_tools: z.array(z.string().min(1).max(200)).max(50).optional(),
  context: z.array(z.string().max(20_000)).max(50).optional(),
  turns: z.array(z.string().trim().min(1).max(20_000)).max(20).optional(),
  reply_language: z.enum(["bn", "bn-en", "en"]).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
});
export type Golden = z.infer<typeof GoldenSchema>;

export const MAX_GOLDENS = 500;

export class DatasetError extends BanglaClawError {
  constructor(message: string) {
    super("INVALID_DATASET", message);
  }
}

/**
 * Validates goldens as the harness does: `{ goldens: [...] }` or a bare list, unique names
 * (missing names become `case-<n>`). Accepts parsed data or YAML/JSON text.
 */
export function parseGoldens(data: unknown): Golden[] {
  let value = data;
  if (typeof value === "string") {
    try {
      value = parseYaml(value);
    } catch (error) {
      throw new DatasetError(`Not valid YAML or JSON: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
  }
  const items = typeof value === "object" && value !== null && !Array.isArray(value) && "goldens" in value ? value.goldens : value;
  if (!Array.isArray(items) || items.length === 0) throw new DatasetError("The dataset must contain a non-empty list of goldens");
  if (items.length > MAX_GOLDENS) throw new DatasetError(`At most ${MAX_GOLDENS} goldens per dataset`);
  const seen = new Set<string>();
  return items.map((item: unknown, index) => {
    const named = typeof item === "object" && item !== null && !Array.isArray(item) && !("name" in item) ? { name: `case-${index + 1}`, ...item } : item;
    const parsed = GoldenSchema.safeParse(named);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DatasetError(`goldens[${index}]${issue?.path.length ? `.${issue.path.join(".")}` : ""}: ${issue?.message ?? "invalid"}`);
    }
    if (seen.has(parsed.data.name)) throw new DatasetError(`goldens[${index}].name "${parsed.data.name}" is used twice`);
    seen.add(parsed.data.name);
    return parsed.data;
  });
}

/** A dataset stored on the gateway, so admins can run it from the dashboard (ADR-0020). */
export interface EvalDataset {
  id: string;
  name: string;
  description?: string;
  goldens: Golden[];
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type NewEvalDataset = Pick<EvalDataset, "name" | "goldens"> & { description?: string; createdBy?: string };

export class DuplicateDatasetNameError extends BanglaClawError {
  constructor(name: string) {
    super("DUPLICATE_DATASET_NAME", `A dataset named "${name}" already exists`);
  }
}

export interface EvalDatasetStore {
  /** Oldest first. */
  list(): Promise<EvalDataset[]>;
  get(id: string): Promise<EvalDataset | undefined>;
  /** Throws {@link DuplicateDatasetNameError} when the name is taken. */
  create(dataset: NewEvalDataset): Promise<EvalDataset>;
  update(id: string, patch: { name?: string; description?: string | null; goldens?: Golden[] }): Promise<EvalDataset | undefined>;
  delete(id: string): Promise<boolean>;
}

export class InMemoryEvalDatasetStore implements EvalDatasetStore {
  readonly #datasets = new Map<string, EvalDataset>();

  async list(): Promise<EvalDataset[]> {
    return [...this.#datasets.values()].map((d) => structuredClone(d));
  }

  async get(id: string): Promise<EvalDataset | undefined> {
    const d = this.#datasets.get(id);
    return d === undefined ? undefined : structuredClone(d);
  }

  async create(dataset: NewEvalDataset): Promise<EvalDataset> {
    this.#assertFree(dataset.name);
    const now = new Date();
    const created: EvalDataset = { id: randomUUID(), ...structuredClone(dataset), createdAt: now, updatedAt: now };
    this.#datasets.set(created.id, created);
    return structuredClone(created);
  }

  async update(id: string, patch: { name?: string; description?: string | null; goldens?: Golden[] }): Promise<EvalDataset | undefined> {
    const current = this.#datasets.get(id);
    if (current === undefined) return undefined;
    if (patch.name !== undefined && patch.name !== current.name) this.#assertFree(patch.name);
    const { description, ...rest } = current;
    const nextDescription = patch.description === null ? undefined : (patch.description ?? description);
    const next: EvalDataset = {
      ...rest,
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.goldens !== undefined && { goldens: structuredClone(patch.goldens) }),
      ...(nextDescription !== undefined && { description: nextDescription }),
      updatedAt: new Date(),
    };
    this.#datasets.set(id, next);
    return structuredClone(next);
  }

  async delete(id: string): Promise<boolean> {
    return this.#datasets.delete(id);
  }

  #assertFree(name: string): void {
    if ([...this.#datasets.values()].some((d) => d.name === name)) throw new DuplicateDatasetNameError(name);
  }
}

/** Metrics the built-in runner computes (docs/26). Judge metrics need a judge model. */
export const BUILTIN_EVAL_METRICS = ["correctness", "answer_relevancy", "fluency", "conversation", "tool_correctness", "language_match"] as const;
export type BuiltinEvalMetric = (typeof BUILTIN_EVAL_METRICS)[number];
export const DEFAULT_BUILTIN_METRICS: BuiltinEvalMetric[] = ["correctness", "answer_relevancy", "conversation", "tool_correctness", "language_match"];

export type EvalJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** An eval started from the dashboard, run inside the gateway process (ADR-0020). Kept in memory. */
export interface EvalJob {
  id: string;
  status: EvalJobStatus;
  name: string;
  datasetId: string;
  datasetName: string;
  metrics: BuiltinEvalMetric[];
  /** Provider id of the judge model, e.g. "anthropic:claude-sonnet-5". */
  judgeModel?: string;
  /** Language of the judge's instructions. */
  judgeLanguage: "bn" | "en";
  total: number;
  /** Goldens answered and scored so far. */
  done: number;
  passed: number;
  startedBy?: string;
  startedAt: string;
  finishedAt?: string;
  /** The recorded run, once completed. */
  evalId?: string;
  error?: string;
}

export interface StartEvalJob {
  datasetId: string;
  name?: string;
  metrics?: BuiltinEvalMetric[];
  /** A provider profile for the judge; absent = the provider the agent uses now. */
  judgeProviderId?: string;
  judgeLanguage?: "bn" | "en";
  thresholds?: Partial<Record<BuiltinEvalMetric, number>>;
  startedBy?: string;
}

/** Starts and tracks dashboard evals; implemented by `EvalJobRunner` (evals package). */
export interface EvalRunner {
  start(input: StartEvalJob): Promise<EvalJob>;
  /** Newest first. */
  list(): EvalJob[];
  get(id: string): EvalJob | undefined;
  cancel(id: string): boolean;
}
