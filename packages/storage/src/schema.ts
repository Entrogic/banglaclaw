import { sql } from "drizzle-orm";
import { bigint, boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { StoredMessage } from "@langchain/core/messages";
import type { EvalMetricResult, EvalMetricSummary, Golden, ProviderId } from "@entrogic-net/shared";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  name: text("name").notNull().unique(),
  role: text("role").notNull().default("user"),
  createdAt: createdAt(),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    /** Public key id embedded in the token; the secret is stored only as a SHA-256 hash. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    hash: text("hash").notNull(),
    scopes: text("scopes").array().notNull().default(sql`'{read,run}'::text[]`),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("api_keys_user_id_idx").on(t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    channel: text("channel").notNull(),
    externalId: text("external_id"),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    /** From the first user message (docs/06). */
    title: text("title"),
    status: text("status").notNull().default("active"),
    activeAgent: text("active_agent"),
    handoffReason: text("handoff_reason"),
    handoffAt: timestamp("handoff_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_channel_external_id_key").on(t.channel, t.externalId),
    index("sessions_updated_at_idx").on(t.updatedAt),
    index("sessions_user_id_idx").on(t.userId, t.updatedAt),
    index("sessions_status_idx").on(t.status, t.updatedAt),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    promptVersion: text("prompt_version").notNull(),
    language: text("language").notNull(),
    skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
    agent: text("agent").notNull().default("banglaclaw"),
    agentPath: text("agent_path").array().notNull().default(sql`'{}'::text[]`),
    handoffReason: text("handoff_reason"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    input: text("input").notNull(),
    output: text("output"),
    status: text("status").notNull(),
    stopReason: text("stop_reason"),
    error: text("error"),
    iterations: integer("iterations").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
  },
  (t) => [index("runs_session_started_idx").on(t.sessionId, t.startedAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    /** LangChain message type: human | ai | tool | system. */
    role: text("role").notNull(),
    /** Serialised LangChain message (content, tool calls, ids). */
    data: jsonb("data").$type<StoredMessage>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("messages_session_id_idx").on(t.sessionId, t.id)],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    toolCallId: text("tool_call_id").notNull(),
    tool: text("tool").notNull(),
    input: jsonb("input"),
    status: text("status").notNull(),
    output: jsonb("output"),
    error: text("error"),
    durationMs: integer("duration_ms").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.seq] }), index("tool_calls_tool_idx").on(t.tool)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    action: text("action").notNull(),
    outcome: text("outcome").notNull(),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    target: text("target"),
    ip: text("ip"),
    requestId: text("request_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (t) => [index("audit_logs_at_idx").on(t.at), index("audit_logs_action_idx").on(t.action, t.at), index("audit_logs_actor_idx").on(t.actorId, t.at)],
);

/** Evaluation runs submitted by an eval harness such as DeepEval (docs/26); the summary columns avoid re-aggregating cases. */
export const evalRuns = pgTable(
  "eval_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    dataset: text("dataset"),
    framework: text("framework").notNull(),
    frameworkVersion: text("framework_version"),
    judgeModel: text("judge_model"),
    agentModel: text("agent_model"),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>(),
    createdBy: text("created_by"),
    caseCount: integer("case_count").notNull(),
    passedCount: integer("passed_count").notNull(),
    metrics: jsonb("metrics").$type<EvalMetricSummary[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("eval_runs_created_at_idx").on(t.createdAt), index("eval_runs_name_idx").on(t.name, t.createdAt)],
);

export const evalCases = pgTable(
  "eval_cases",
  {
    evalId: uuid("eval_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    name: text("name"),
    input: text("input").notNull(),
    actualOutput: text("actual_output"),
    expectedOutput: text("expected_output"),
    language: text("language"),
    /** Not foreign keys: evaluated sessions may be deleted later. */
    sessionId: text("session_id"),
    runId: text("run_id"),
    toolsCalled: text("tools_called").array(),
    expectedTools: text("expected_tools").array(),
    success: boolean("success").notNull(),
    metrics: jsonb("metrics").$type<EvalMetricResult[]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.evalId, t.seq] })],
);

/**
 * Model providers added from the dashboard (ADR-0019). The API key is stored only encrypted
 * (AES-256-GCM, bound to the row id); the partial unique index allows one active profile.
 */
export const modelProviders = pgTable(
  "model_providers",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull().unique(),
    provider: text("provider").$type<ProviderId>().notNull(),
    model: text("model").notNull(),
    baseUrl: text("base_url"),
    temperature: doublePrecision("temperature"),
    apiKeyCiphertext: text("api_key_ciphertext"),
    apiKeyHint: text("api_key_hint"),
    active: boolean("active").notNull().default(false),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("model_providers_one_active_idx").on(t.active).where(sql`${t.active}`)],
);

/** Eval datasets stored on the gateway so admins can run them from the dashboard (ADR-0020). */
export const evalDatasets = pgTable("eval_datasets", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  goldens: jsonb("goldens").$type<Golden[]>().notNull(),
  createdBy: text("created_by"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
