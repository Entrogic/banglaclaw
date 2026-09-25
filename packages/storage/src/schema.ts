import { sql } from "drizzle-orm";
import { bigint, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { StoredMessage } from "@langchain/core/messages";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    channel: text("channel").notNull(),
    externalId: text("external_id"),
    userId: text("user_id"),
    agentId: text("agent_id").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_channel_external_id_key").on(t.channel, t.externalId),
    index("sessions_updated_at_idx").on(t.updatedAt),
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
