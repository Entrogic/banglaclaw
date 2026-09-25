import { z } from "zod";
import { createSessionBody, messageBody, runBody } from "./schemas.js";

type Schema = Record<string, unknown>;
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: Schema, description = "OK") => ({ description, content: { "application/json": { schema } } });
const errors = (...codes: number[]) =>
  Object.fromEntries(codes.map((c) => [String(c), { description: ERROR_TEXT[c] ?? "Error", content: { "application/json": { schema: ref("Error") } } }]));
const ERROR_TEXT: Record<number, string> = {
  400: "Invalid request",
  401: "Missing or invalid API key",
  403: "Missing scope or role",
  404: "Not found",
  409: "Conflict",
  413: "Payload too large",
  429: "Rate limited",
  502: "Model provider error",
  504: "Run timed out",
};
const body = (zodSchema: z.ZodType): Schema => {
  const { $schema: _s, ...schema } = z.toJSONSchema(zodSchema, { io: "input" }) as Schema;
  return { required: true, content: { "application/json": { schema } } };
};
const idParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string" } });
const limitParam = (max: number, dflt: number) => ({ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: max, default: dflt } });
const streamParam = { name: "stream", in: "query", description: "true = Server-Sent Events (or send Accept: text/event-stream)", schema: { type: "boolean" } };
const runResponses = {
  "200": {
    description: "Run result (JSON), or an SSE stream of RunEvent objects followed by a `done` event",
    content: { "application/json": { schema: ref("RunResponse") }, "text/event-stream": { schema: { type: "string" } } },
  },
  ...errors(400, 401, 403, 404, 413, 429, 502, 504),
};

/** OpenAPI 3.1 description of the stable /v1 API (docs/18). */
export function openApiSpec(options: { version: string; maxInputChars: number }) {
  const str = { type: "string" };
  const time = { type: "string", format: "date-time" };
  return {
    openapi: "3.1.0",
    info: {
      title: "BanglaClaw Gateway API",
      version: options.version,
      description:
        "Bangla-first AI agent runtime. All /v1 routes need `Authorization: Bearer <api key>`; GET needs the `read` scope, other methods `run`. The v1 surface only changes additively; see docs/18-api.md.",
      license: { name: "Apache-2.0", identifier: "Apache-2.0" },
    },
    servers: [{ url: "/" }],
    security: [{ bearerAuth: [] }],
    tags: [{ name: "agent" }, { name: "sessions" }, { name: "knowledge" }, { name: "operators" }, { name: "admin" }, { name: "system" }],
    paths: {
      "/health": { get: { tags: ["system"], security: [], summary: "Liveness check", responses: { "200": json({ type: "object", properties: { status: str, version: str } }) } } },
      "/metrics": { get: { tags: ["system"], security: [], summary: "Prometheus metrics (bearer METRICS_TOKEN when configured)", responses: { "200": { description: "Prometheus text format", content: { "text/plain": { schema: str } } } } } },
      "/v1/openapi.json": { get: { tags: ["system"], security: [], summary: "This document", responses: { "200": json({ type: "object" }) } } },
      "/v1/me": { get: { tags: ["system"], summary: "The authenticated user and key", responses: { "200": json(ref("Me")), ...errors(401) } } },
      "/v1/agents": { get: { tags: ["agent"], summary: "Default agent, model, tools, skills", responses: { "200": json({ type: "object", properties: { agents: { type: "array", items: ref("AgentInfo") } } }), ...errors(401) } } },
      "/v1/tools": { get: { tags: ["agent"], summary: "Registered tools", responses: { "200": json({ type: "object", properties: { tools: { type: "array", items: ref("ToolInfo") } } }), ...errors(401) } } },
      "/v1/skills": { get: { tags: ["agent"], summary: "Discovered skills", responses: { "200": json({ type: "object", properties: { skills: { type: "array", items: ref("SkillInfo") } } }), ...errors(401) } } },
      "/v1/agents/run": { post: { tags: ["agent"], summary: "Run the agent (resumes or creates a session)", parameters: [streamParam], requestBody: body(runBody(options.maxInputChars)), responses: runResponses } },
      "/v1/sessions": {
        get: { tags: ["sessions"], summary: "Your sessions, most recent first", parameters: [limitParam(100, 20)], responses: { "200": json({ type: "object", properties: { sessions: { type: "array", items: ref("Session") } } }), ...errors(401) } },
        post: { tags: ["sessions"], summary: "Create or resolve a session", requestBody: body(createSessionBody), responses: { "200": json(ref("SessionCreated"), "Existing session"), "201": json(ref("SessionCreated"), "Created"), ...errors(400, 401) } },
      },
      "/v1/sessions/{id}": { get: { tags: ["sessions"], summary: "Session and message count", parameters: [idParam("id")], responses: { "200": json({ type: "object", properties: { session: ref("Session"), messageCount: { type: "integer" } } }), ...errors(401, 404) } } },
      "/v1/sessions/{id}/messages": {
        get: { tags: ["sessions"], summary: "Recent messages", parameters: [idParam("id"), limitParam(500, 50)], responses: { "200": json({ type: "object", properties: { sessionId: str, messages: { type: "array", items: ref("Message") } } }), ...errors(401, 404) } },
        post: { tags: ["sessions"], summary: "Send a message (runs the agent)", parameters: [idParam("id"), streamParam], requestBody: body(messageBody(options.maxInputChars)), responses: runResponses },
      },
      "/v1/sessions/{id}/runs": { get: { tags: ["sessions"], summary: "Runs of a session", parameters: [idParam("id"), limitParam(100, 20)], responses: { "200": json({ type: "object", properties: { runs: { type: "array", items: ref("Run") } } }), ...errors(401, 404) } } },
      "/v1/runs/{id}": { get: { tags: ["sessions"], summary: "One run", parameters: [idParam("id")], responses: { "200": json({ type: "object", properties: { run: ref("Run") } }), ...errors(401, 404) } } },
      "/v1/knowledge/search": { get: { tags: ["knowledge"], summary: "Search the knowledge base", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string", maxLength: 500 } }, limitParam(20, 5)], responses: { "200": json({ type: "object", properties: { results: { type: "array", items: ref("KnowledgeHit") } } }), ...errors(400, 401, 404) } } },
      "/v1/knowledge/documents": { get: { tags: ["knowledge"], summary: "Ingested documents", responses: { "200": json({ type: "object", properties: { documents: { type: "array", items: ref("KnowledgeDocument") } } }), ...errors(401, 404) } } },
      "/v1/memories": { get: { tags: ["knowledge"], summary: "Your long-term memories", responses: { "200": json({ type: "object", properties: { memories: { type: "array", items: ref("Memory") } } }), ...errors(401, 404) } } },
      "/v1/memories/{id}": { delete: { tags: ["knowledge"], summary: "Forget a memory", parameters: [idParam("id")], responses: { "204": { description: "Deleted" }, ...errors(401, 403, 404) } } },
      "/v1/handoffs": { get: { tags: ["operators"], summary: "Sessions waiting for a human (operator role)", parameters: [limitParam(200, 50)], responses: { "200": json({ type: "object", properties: { handoffs: { type: "array", items: ref("Session") } } }), ...errors(401, 403) } } },
      "/v1/handoffs/{id}": { get: { tags: ["operators"], summary: "A handed-off session with messages", parameters: [idParam("id"), limitParam(500, 50)], responses: { "200": json({ type: "object", properties: { session: ref("Session"), messages: { type: "array", items: ref("Message") } } }), ...errors(401, 403, 404) } } },
      "/v1/handoffs/{id}/reply": { post: { tags: ["operators"], summary: "Reply as a human operator", parameters: [idParam("id")], requestBody: body(messageBody(options.maxInputChars)), responses: { "200": json({ type: "object", properties: { delivered: { type: "boolean" }, runId: str } }), ...errors(400, 401, 403, 404, 409) } } },
      "/v1/handoffs/{id}/release": { post: { tags: ["operators"], summary: "Return the session to the bot", parameters: [idParam("id")], responses: { "200": json({ type: "object", properties: { session: ref("Session") } }), ...errors(401, 403, 404, 409) } } },
      "/v1/audit": { get: { tags: ["operators"], summary: "Security audit log (admin role)", parameters: [{ name: "action", in: "query", schema: str }, limitParam(1000, 100)], responses: { "200": json({ type: "object", properties: { events: { type: "array", items: ref("AuditEvent") } } }), ...errors(401, 403, 404) } } },
      "/v1/admin/stats": {
        get: {
          tags: ["admin"], summary: "Analytics: totals, daily series, channels, providers (with estimated cost), agents, top tools (admin role)",
          parameters: [{ name: "days", in: "query", schema: { type: "integer", minimum: 1, maximum: 90, default: 7 } }],
          responses: { "200": json(ref("AdminStats")), ...errors(401, 403) },
        },
      },
      "/v1/admin/sessions": {
        get: {
          tags: ["admin"], summary: "All sessions across users and channels (admin role)",
          parameters: [limitParam(200, 50), { name: "status", in: "query", schema: { enum: ["active", "handoff"] } }, { name: "channel", in: "query", schema: str }, { name: "q", in: "query", description: "Session id prefix or external id", schema: str }],
          responses: { "200": json({ type: "object", properties: { sessions: { type: "array", items: ref("AdminSession") } } }), ...errors(400, 401, 403) },
        },
      },
      "/v1/admin/sessions/{id}": {
        get: { tags: ["admin"], summary: "Any session with messages and runs (admin role)", parameters: [idParam("id"), limitParam(500, 100)], responses: { "200": json({ type: "object", properties: { session: ref("Session"), messages: { type: "array", items: ref("Message") }, runs: { type: "array", items: ref("Run") } } }), ...errors(401, 403, 404) } },
      },
      "/v1/admin/keys": {
        get: { tags: ["admin"], summary: "API keys (admin role)", responses: { "200": json({ type: "object", properties: { keys: { type: "array", items: ref("AdminKey") } } }), ...errors(401, 403) } },
        post: {
          tags: ["admin"], summary: "Create an API key; the token is returned once (admin role)",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["user"], properties: { user: str, name: str, role: { enum: ["user", "operator", "admin"] }, scopes: { type: "array", items: { enum: ["read", "run"] } } } } } } },
          responses: { "201": json({ type: "object", properties: { key: { type: "object" }, token: str } }, "Created"), ...errors(400, 401, 403) },
        },
      },
      "/v1/admin/keys/{id}/revoke": {
        post: { tags: ["admin"], summary: "Revoke an API key (admin role)", parameters: [idParam("id")], responses: { "200": json({ type: "object", properties: { revoked: str } }), ...errors(401, 403, 404, 409) } },
      },
      "/admin/{path}": { get: { tags: ["system"], security: [], summary: "Admin dashboard (static web app, when built)", parameters: [idParam("path")], responses: { "200": { description: "HTML/JS/CSS" } } } },
      "/v1/ws": { get: { tags: ["agent"], security: [], summary: "WebSocket upgrade; authenticate with a first {type:\"auth\"} message (see docs/18)", responses: { "101": { description: "Switching protocols" } } } },
    },
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "bck_<id>_<secret> API key" } },
      schemas: {
        Error: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message", "requestId"], properties: { code: str, message: str, requestId: str } } } },
        Me: { type: "object", properties: { user: { type: "object", properties: { id: str, name: str, role: { enum: ["user", "operator", "admin"] } } }, key: { type: "object", properties: { id: str, name: str, scopes: { type: "array", items: { enum: ["read", "run"] } }, createdAt: time } } } },
        Session: {
          type: "object",
          required: ["id", "channel", "agentId", "status", "createdAt", "updatedAt"],
          properties: { id: str, channel: str, agentId: str, status: { enum: ["active", "handoff"] }, activeAgent: str, handoffReason: str, handoffAt: time, externalId: str, createdAt: time, updatedAt: time },
        },
        SessionCreated: { type: "object", properties: { session: ref("Session"), created: { type: "boolean" } } },
        Message: { type: "object", required: ["role", "content"], properties: { role: { enum: ["user", "assistant", "operator", "tool", "system"] }, content: str, toolCalls: { type: "array", items: { type: "object", properties: { id: str, name: str, args: {} } } }, toolCallId: str } },
        ToolCall: { type: "object", properties: { id: str, tool: str, input: {}, status: { enum: ["ok", "denied", "invalid_input", "invalid_output", "error", "unknown_tool"] }, output: {}, error: str, durationMs: { type: "integer" } } },
        Run: {
          type: "object",
          required: ["id", "sessionId", "status", "language", "agent", "input", "startedAt"],
          properties: {
            id: str, sessionId: str, status: { enum: ["completed", "limited", "error", "aborted", "handoff"] },
            stopReason: { enum: ["completed", "tool_limit", "iteration_limit", "handoff"] }, language: { enum: ["bn", "bn-en", "en"] },
            skills: { type: "array", items: str }, agent: str, agentPath: { type: "array", items: str }, handoffReason: str,
            usage: { type: "object", properties: { inputTokens: { type: "integer" }, outputTokens: { type: "integer" } } },
            input: str, output: str, error: str, provider: str, promptVersion: str, iterations: { type: "integer" },
            toolCalls: { type: "array", items: ref("ToolCall") }, startedAt: time, finishedAt: time, durationMs: { type: "integer" },
          },
        },
        RunResponse: { type: "object", required: ["sessionId", "reply", "run"], properties: { sessionId: str, sessionCreated: { type: "boolean" }, reply: str, run: ref("Run") } },
        AgentInfo: { type: "object", properties: { id: str, model: str, tools: { type: "array", items: str }, skills: { type: "array", items: str } } },
        ToolInfo: { type: "object", properties: { name: str, description: str, risk: { enum: ["safe", "sensitive", "destructive"] }, allowed: { type: "boolean" } } },
        SkillInfo: { type: "object", properties: { name: str, description: str, version: str, tools: { type: "array", items: str }, triggers: { type: "array", items: str } } },
        KnowledgeHit: { type: "object", properties: { source: str, title: str, chunkIndex: { type: "integer" }, score: { type: "number" }, text: str } },
        KnowledgeDocument: { type: "object", properties: { documentId: str, source: str, title: str, chunkCount: { type: "integer" }, ingestedAt: time } },
        Memory: { type: "object", properties: { id: str, text: str, createdAt: time } },
        AdminSession: { allOf: [ref("Session"), { type: "object", properties: { userId: str, userName: str, messageCount: { type: "integer" } } }] },
        AdminKey: { type: "object", properties: { id: str, name: str, scopes: { type: "array", items: str }, user: str, role: str, status: { enum: ["active", "revoked"] }, createdAt: time, lastUsedAt: time, revokedAt: time } },
        AdminStats: {
          type: "object",
          properties: {
            days: { type: "integer" }, timezone: str, since: time, until: time, totalCostUsd: { type: "number" },
            totals: { type: "object", properties: Object.fromEntries(["runs", "completed", "errors", "limited", "aborted", "handoffs", "inputTokens", "outputTokens", "avgDurationMs", "sessions"].map((k) => [k, { type: "integer" }])) },
            daily: { type: "array", items: { type: "object", properties: { date: str, runs: { type: "integer" }, errors: { type: "integer" }, handoffs: { type: "integer" }, inputTokens: { type: "integer" }, outputTokens: { type: "integer" } } } },
            byChannel: { type: "array", items: { type: "object", properties: { channel: str, runs: { type: "integer" } } } },
            byProvider: { type: "array", items: { type: "object", properties: { provider: str, runs: { type: "integer" }, inputTokens: { type: "integer" }, outputTokens: { type: "integer" }, costUsd: { type: "number" } } } },
            byAgent: { type: "array", items: { type: "object", properties: { agent: str, runs: { type: "integer" } } } },
            topTools: { type: "array", items: { type: "object", properties: { tool: str, calls: { type: "integer" }, failures: { type: "integer" } } } },
          },
        },
        AuditEvent: { type: "object", properties: { id: str, at: time, action: str, outcome: { enum: ["success", "failure", "denied"] }, actorId: str, actorName: str, target: str, ip: str, requestId: str, metadata: { type: "object" } } },
      },
    },
  };
}
