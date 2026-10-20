import { z } from "zod";

export function runBody(maxInputChars: number) {
  return z.strictObject({
    text: z.string().trim().min(1, "text is required").max(maxInputChars, `text is limited to ${maxInputChars} characters`),
    sessionId: z.uuid().optional(),
    externalId: z.string().min(1).max(200).optional(),
  });
}

export function messageBody(maxInputChars: number) {
  return z.strictObject({
    text: z.string().trim().min(1, "text is required").max(maxInputChars, `text is limited to ${maxInputChars} characters`),
  });
}

export const createSessionBody = z.strictObject({ externalId: z.string().min(1).max(200).optional() });
export const renameSessionBody = z.strictObject({ title: z.string().trim().min(1).max(80).nullable() });

export const limitQuery = (max: number, fallback: number) =>
  z.coerce.number().int().min(1).max(max).catch(fallback);

/** Optional field that also accepts null (Python clients send None) and reads as undefined. */
const nullish = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? undefined);
const score = z.number().min(0).max(1);
const toolNames = z.array(z.string().min(1).max(200)).max(100);

export const evalMetric = z.strictObject({
  name: z.string().trim().min(1).max(100),
  score: nullish(score),
  threshold: score,
  success: z.boolean(),
  reason: nullish(z.string().max(4000)),
  error: nullish(z.string().max(4000)),
});

export const evalCase = z.strictObject({
  name: nullish(z.string().max(200)),
  input: z.string().min(1).max(20_000),
  actualOutput: nullish(z.string().max(50_000)),
  expectedOutput: nullish(z.string().max(20_000)),
  language: nullish(z.string().max(10)),
  sessionId: nullish(z.string().max(100)),
  runId: nullish(z.string().max(100)),
  toolsCalled: nullish(toolNames),
  expectedTools: nullish(toolNames),
  metrics: z.array(evalMetric).max(50),
});

/** POST /v1/admin/evals: one evaluation run with its cases, as the DeepEval harness sends it (docs/26). */
export const evalRunBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  dataset: nullish(z.string().max(200)),
  framework: z.string().trim().min(1).max(50).default("deepeval"),
  frameworkVersion: nullish(z.string().max(50)),
  judgeModel: nullish(z.string().max(200)),
  agentModel: nullish(z.string().max(200)),
  metadata: nullish(
    z
      .record(z.string().min(1).max(64), z.union([z.string().max(500), z.number(), z.boolean()]))
      .refine((m) => Object.keys(m).length <= 30, "at most 30 metadata keys"),
  ),
  cases: z.array(evalCase).min(1).max(1000),
});
