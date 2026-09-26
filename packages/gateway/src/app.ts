import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { matchedRoutes } from "hono/route";
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { timingSafeEqual } from "node:crypto";
import type { UpgradeWebSocket } from "hono/ws";
import type { z } from "zod";
import { getConnInfo } from "@hono/node-server/conninfo";
import { hasRole, type Principal } from "@entrogic-net/auth";
import { ownerForUser } from "@entrogic-net/knowledge";
import { HandoffDesk, HandoffError, type Deliver } from "@entrogic-net/session";
import { RateLimiter, auditRecorder, createLogger, type AuditAction, type NewAuditEvent } from "@entrogic-net/shared";
import { GatewayContext, type GatewayDeps, type GatewayEnv } from "./context.js";
import { HttpError, toHttpError, type ErrorBody } from "./errors.js";
import { respondWithSessionEvents } from "./events.js";
import { respondWithRun } from "./run.js";
import { createSessionBody, limitQuery, messageBody, renameSessionBody, runBody } from "./schemas.js";
import { adminRoutes, dashboardRoutes } from "./admin.js";
import { openApiSpec } from "./openapi.js";
import { messageJson, runJson, sessionJson } from "./serialize.js";
import { WEB_CHAT_CSP, WEB_CHAT_HTML } from "./web-chat.js";
import { widgetRoutes } from "./widget/routes.js";
import { LARGE_BODY_PATHS, registerFileRoutes } from "./files.js";
import { websocketHandler } from "./ws.js";

type Env = GatewayEnv;

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;
const tracer = trace.getTracer("banglaclaw.gateway");

/** Matched route pattern (e.g. /v1/sessions/:id) for low-cardinality metric labels. */
function routeLabel(c: Context): string {
  return matchedRoutes(c).filter((r) => r.method !== "ALL").at(-1)?.path ?? "unmatched";
}

async function parseJson<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be JSON");
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, "invalid_request", result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return result.data;
}

/**
 * Builds the gateway HTTP app (docs/05, docs/18). Pass `upgradeWebSocket` to enable /v1/ws.
 * Channels/transport live here; agent reasoning stays in AgentRuntime (ADR-0005).
 */
export function createGatewayApp(deps: GatewayDeps, upgradeWebSocket?: UpgradeWebSocket) {
  const gw = new GatewayContext(deps);
  const logger = deps.logger ?? createLogger({ level: "warn" });
  const { config } = deps;
  const app = new Hono<Env>();
  const recordAudit = auditRecorder(deps.audit, logger);
  // Failed-auth and rate-limit events can be triggered by anyone; cap how many get written per source.
  const auditThrottle = new RateLimiter(10);
  const audit = (c: Context<Env>, event: Omit<NewAuditEvent, "ip" | "requestId">, throttleKey?: string) => {
    if (throttleKey !== undefined && !auditThrottle.take(`${event.action}:${throttleKey}`).ok) return;
    const ip = c.get("ip");
    recordAudit({ ...event, requestId: c.get("requestId"), ...(ip !== undefined && { ip }) });
  };

  const clientIp = (c: Context<Env>): string | undefined => {
    if (config.trustProxy) {
      const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
      if (forwarded !== undefined && forwarded !== "") return forwarded;
    }
    try {
      return getConnInfo(c).remote.address;
    } catch {
      return undefined; // not running on the Node server (e.g. app.request in tests)
    }
  };

  app.use("*", async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming !== undefined && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    const started = performance.now();
    c.set("requestId", requestId);
    c.set("ip", clientIp(c));
    c.set("log", logger.child({ requestId }));
    c.header("X-Request-Id", requestId);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    const done = deps.metrics?.requestStarted();
    await tracer.startActiveSpan(`${c.req.method} ${c.req.path.startsWith("/v1/") ? "/v1" : c.req.path}`, { kind: SpanKind.SERVER }, async (span) => {
      try {
        await next();
      } finally {
        const route = routeLabel(c);
        const durationMs = performance.now() - started;
        span.updateName(`${c.req.method} ${route}`);
        span.setAttributes({ "http.request.method": c.req.method, "http.route": route, "http.response.status_code": c.res.status, "banglaclaw.request_id": requestId });
        if (c.res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        done?.();
        if (route !== "/metrics") deps.metrics?.observeHttp(c.req.method, route, c.res.status, durationMs);
        c.get("log").info("request", {
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          durationMs: Math.round(durationMs),
          userId: c.get("principal")?.user.id,
        });
      }
    });
  });

  if (config.corsOrigins.length > 0) {
    app.use("*", cors({ origin: config.corsOrigins, allowHeaders: ["Authorization", "Content-Type", "X-Request-Id"], exposeHeaders: ["X-Request-Id", "X-Session-Id"] }));
  }

  app.onError((error, c) => {
    const http = toHttpError(error);
    if (http.status >= 500) c.get("log")?.error("request failed", { error, path: c.req.path });
    const body: ErrorBody = { error: { code: http.code, message: http.message, requestId: c.get("requestId") ?? "" } };
    return c.json(body, http.status, http.headers);
  });
  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found", requestId: c.get("requestId") } } satisfies ErrorBody, 404));

  app.get("/health", (c) => c.json({ status: "ok", version: deps.version }));
  const spec = openApiSpec({ version: deps.version, maxInputChars: config.maxInputChars });
  app.get("/v1/openapi.json", (c) => c.json(spec));

  if (deps.metrics !== undefined) {
    const metrics = deps.metrics;
    app.get("/metrics", async (c) => {
      if (metrics.token !== undefined) {
        const given = Buffer.from(c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
        const expected = Buffer.from(metrics.token);
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(401, "unauthenticated", "Metrics token required");
      }
      return c.body(await metrics.render(), 200, { "Content-Type": metrics.contentType });
    });
  }

  if (deps.webChat === true) {
    app.get("/chat", (c) => {
      c.header("Content-Security-Policy", WEB_CHAT_CSP);
      c.header("X-Content-Type-Options", "nosniff");
      c.header("Referrer-Policy", "no-referrer");
      return c.html(WEB_CHAT_HTML);
    });
  }

  if (deps.widget !== undefined) app.route("/", widgetRoutes(gw, deps.widget, audit));

  for (const routes of deps.routes ?? []) app.route("/", routes);
  if (deps.dashboardDir !== undefined) app.route("/", dashboardRoutes(deps.dashboardDir));

  if (upgradeWebSocket !== undefined) {
    // Authenticated inside the protocol (browsers cannot set headers on WebSocket upgrades).
    app.get("/v1/ws", websocketHandler(gw, upgradeWebSocket, logger));
  }

  const v1 = new Hono<Env>();
  const defaultBodyLimit = bodyLimit({ maxSize: 256 * 1024, onError: () => { throw new HttpError(413, "payload_too_large", "Request body too large"); } });
  // Uploads and audio have their own, larger limits (files.ts).
  v1.use("*", (c, next) => (LARGE_BODY_PATHS.has(c.req.path) ? next() : defaultBodyLimit(c, next)));
  v1.use("*", async (c, next) => {
    const header = c.req.header("authorization");
    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    const principal = await deps.auth.authenticate(token);
    if (principal === undefined) {
      audit(c, { action: "auth.failed", outcome: "failure", target: `${c.req.method} ${c.req.path}`, metadata: { reason: token === undefined ? "missing" : "invalid" } }, c.get("ip") ?? "unknown");
      throw new HttpError(401, "unauthenticated", token === undefined ? "Missing Authorization: Bearer <api key>" : "Invalid API key", {
        "WWW-Authenticate": 'Bearer realm="banglaclaw"',
      });
    }
    c.set("principal", principal);
    const decision = gw.rate.take(principal.key.id);
    c.header("X-RateLimit-Limit", String(gw.rate.limitPerMinute));
    if (!decision.ok) {
      audit(c, { action: "rate_limited", outcome: "denied", actorId: principal.user.id, target: principal.key.id }, principal.key.id);
      throw new HttpError(429, "rate_limited", "Rate limit exceeded", { "Retry-After": String(decision.retryAfterSeconds) });
    }
    c.header("X-RateLimit-Remaining", String(decision.remaining));
    c.header("Cache-Control", "no-store");
    // Key scopes: GET needs "read"; everything else (runs, writes) needs "run".
    const scope = c.req.method === "GET" || c.req.method === "HEAD" ? "read" : "run";
    if (!principal.key.scopes.includes(scope)) {
      audit(c, { action: "auth.forbidden", outcome: "denied", actorId: principal.user.id, target: `${c.req.method} ${c.req.path}`, metadata: { missingScope: scope } }, principal.key.id);
      throw new HttpError(403, "insufficient_scope", `This API key lacks the "${scope}" scope`);
    }
    await next();
  });

  registerFileRoutes(v1, deps);

  v1.get("/me", (c) => {
    const { user, key } = c.get("principal");
    return c.json({ user: { id: user.id, name: user.name, role: user.role }, key: { id: key.id, name: key.name, scopes: key.scopes, createdAt: key.createdAt.toISOString() } });
  });

  v1.get("/agents", (c) =>
    c.json({
      agents: [
        {
          id: deps.agent.name,
          model: deps.agent.model,
          tools: deps.registry.list().filter((t) => deps.policy.check(t).allowed).map((t) => t.name),
          skills: deps.skills.list().map((s) => s.name),
        },
      ],
    }),
  );

  v1.get("/tools", (c) =>
    c.json({
      tools: deps.registry.list().map((t) => ({ name: t.name, description: t.description, risk: t.risk, allowed: deps.policy.check(t).allowed })),
    }),
  );

  v1.get("/skills", (c) =>
    c.json({ skills: deps.skills.list().map((s) => ({ name: s.name, description: s.description, version: s.version, tools: s.tools, triggers: s.triggers })) }),
  );

  v1.post("/agents/run", async (c) => {
    const body = await parseJson(c, runBody(config.maxInputChars));
    const principal = c.get("principal");
    const { session, created } = await gw.resolveSession(principal, body);
    return respondWithRun(c, gw, principal, session, body.text, created);
  });

  v1.post("/sessions", async (c) => {
    const body = await parseJson(c, createSessionBody);
    const principal = c.get("principal");
    const { session, created } = await gw.resolveSession(principal, body);
    return c.json({ session: sessionJson(session), created }, created ? 201 : 200);
  });

  v1.get("/sessions", async (c) => {
    const limit = limitQuery(100, 20).parse(c.req.query("limit"));
    const q = c.req.query("q")?.trim().slice(0, 100);
    const sessions = await deps.sessions.list({ userId: c.get("principal").user.id, limit, ...(q !== undefined && q !== "" && { query: q }) });
    return c.json({ sessions: sessions.map(sessionJson) });
  });

  /** Renames a conversation (title null clears it). */
  v1.patch("/sessions/:id", async (c) => {
    const session = await gw.ownedSession(c.get("principal"), c.req.param("id"));
    const body = await parseJson(c, renameSessionBody);
    const updated = await deps.sessions.update(session.id, { title: body.title === null ? null : body.title.replace(/\s+/g, " ") });
    if (updated === undefined) throw new HttpError(404, "session_not_found", "Session not found");
    return c.json({ session: sessionJson(updated) });
  });

  /** Deletes a conversation with its messages and runs. */
  v1.delete("/sessions/:id", async (c) => {
    const principal = c.get("principal");
    const session = await gw.ownedSession(principal, c.req.param("id"));
    await deps.runs.deleteBySession(session.id);
    await deps.sessions.delete(session.id);
    audit(c, { action: "session.deleted", outcome: "success", actorId: principal.user.id, target: session.id, metadata: { channel: session.channel } });
    return c.body(null, 204);
  });

  v1.get("/sessions/:id", async (c) => {
    const session = await gw.ownedSession(c.get("principal"), c.req.param("id"));
    return c.json({ session: sessionJson(session), messageCount: await deps.sessions.countMessages(session.id) });
  });

  v1.get("/sessions/:id/messages", async (c) => {
    const session = await gw.ownedSession(c.get("principal"), c.req.param("id"));
    const limit = limitQuery(500, 50).parse(c.req.query("limit"));
    const messages = await deps.sessions.recentMessages(session.id, limit);
    return c.json({ sessionId: session.id, messages: messages.map(messageJson) });
  });

  v1.post("/sessions/:id/messages", async (c) => {
    const principal = c.get("principal");
    const session = await gw.ownedSession(principal, c.req.param("id"));
    const body = await parseJson(c, messageBody(config.maxInputChars));
    return respondWithRun(c, gw, principal, session, body.text, false);
  });

  v1.get("/sessions/:id/runs", async (c) => {
    const session = await gw.ownedSession(c.get("principal"), c.req.param("id"));
    const limit = limitQuery(100, 20).parse(c.req.query("limit"));
    return c.json({ runs: (await deps.runs.listBySession(session.id, { limit })).map(runJson) });
  });

  v1.get("/sessions/:id/events", async (c) => {
    const principal = c.get("principal");
    const session = await gw.ownedSession(principal, c.req.param("id"));
    return respondWithSessionEvents(c, gw, principal, session);
  });

  v1.get("/runs/:id", async (c) => {
    const run = await deps.runs.get(c.req.param("id"));
    if (run !== undefined) {
      const session = await deps.sessions.get(run.sessionId);
      if (session?.userId === c.get("principal").user.id) return c.json({ run: runJson(run) });
    }
    throw new HttpError(404, "run_not_found", "Run not found");
  });

  v1.get("/knowledge/documents", async (c) => {
    if (deps.knowledge === undefined) throw new HttpError(404, "knowledge_disabled", "Knowledge base is not enabled");
    return c.json({ documents: await deps.knowledge.kb.listDocuments() });
  });

  v1.get("/knowledge/search", async (c) => {
    if (deps.knowledge === undefined) throw new HttpError(404, "knowledge_disabled", "Knowledge base is not enabled");
    const q = c.req.query("q")?.trim() ?? "";
    if (q === "" || q.length > 500) throw new HttpError(400, "invalid_request", "q is required (max 500 characters)");
    const limit = limitQuery(20, deps.knowledge.searchLimit).parse(c.req.query("limit"));
    return c.json({ results: await deps.knowledge.kb.search(q, { limit, minScore: deps.knowledge.minScore }) });
  });

  v1.get("/memories", async (c) => {
    if (deps.memory === undefined) throw new HttpError(404, "memory_disabled", "Long-term memory is not enabled");
    const memories = await deps.memory.list(ownerForUser(c.get("principal").user.id));
    return c.json({ memories: memories.map(({ id, text, createdAt }) => ({ id, text, createdAt })) });
  });

  v1.delete("/memories/:id", async (c) => {
    if (deps.memory === undefined) throw new HttpError(404, "memory_disabled", "Long-term memory is not enabled");
    const principal = c.get("principal");
    const forgotten = await deps.memory.forget(ownerForUser(principal.user.id), c.req.param("id"));
    if (!forgotten) throw new HttpError(404, "memory_not_found", "Memory not found");
    audit(c, { action: "memory.forgotten", outcome: "success", actorId: principal.user.id, target: c.req.param("id") });
    return c.body(null, 204);
  });

  // Human handoff queue — operators only (users.role = operator); they may read any user's handed-off session.
  // Operator replies go to subscribed API clients (WebSocket/SSE) and to the session's platform (Telegram, WhatsApp).
  const deliver: Deliver = async (session, text) => {
    const pushed = gw.events.publish({ type: "operator_message", sessionId: session.id, text, at: new Date().toISOString() }) > 0;
    const sent = deps.deliver !== undefined ? await deps.deliver(session, text) : false;
    return sent || pushed;
  };
  const desk = new HandoffDesk(deps.sessions, deps.runs, deliver, recordAudit);
  const requireRole = (c: Context<Env>, role: "operator" | "admin") => {
    const principal = c.get("principal");
    if (!hasRole(principal.user, role)) {
      audit(c, { action: "auth.forbidden", outcome: "denied", actorId: principal.user.id, target: `${c.req.method} ${c.req.path}`, metadata: { requiredRole: role } }, principal.key.id);
      throw new HttpError(403, "forbidden", `${role === "admin" ? "Admin" : "Operator"} role required`);
    }
  };
  const operatorOnly = (principal: Principal, c?: Context<Env>) => {
    if (c !== undefined) return requireRole(c, "operator");
    if (!hasRole(principal.user, "operator")) throw new HttpError(403, "forbidden", "Operator role required");
  };
  const handoffCall = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof HandoffError) {
        throw error.code === "session_not_found" ? new HttpError(404, "session_not_found", "Session not found") : new HttpError(409, "not_handed_off", error.message);
      }
      throw error;
    }
  };

  v1.get("/handoffs", async (c) => {
    operatorOnly(c.get("principal"), c);
    const queue = await desk.queue(limitQuery(200, 50).parse(c.req.query("limit")));
    return c.json({ handoffs: queue.map(sessionJson) });
  });

  v1.get("/handoffs/:id", async (c) => {
    operatorOnly(c.get("principal"), c);
    const { session, messages } = await handoffCall(() => desk.get(c.req.param("id"), limitQuery(500, 50).parse(c.req.query("limit"))));
    return c.json({ session: sessionJson(session), messages: messages.map(messageJson) });
  });

  v1.post("/handoffs/:id/reply", async (c) => {
    const principal = c.get("principal");
    operatorOnly(principal, c);
    const body = await parseJson(c, messageBody(config.maxInputChars));
    const result = await handoffCall(() => desk.reply(c.req.param("id"), principal.user.name, body.text));
    return c.json(result);
  });

  v1.post("/handoffs/:id/release", async (c) => {
    operatorOnly(c.get("principal"), c);
    const session = await handoffCall(() => desk.release(c.req.param("id"), c.get("principal").user.name));
    gw.events.publish({ type: "handoff_released", sessionId: session.id, at: new Date().toISOString() });
    return c.json({ session: sessionJson(session) });
  });

  v1.route("/admin", adminRoutes(deps, { requireRole, audit: (c, e) => audit(c as Context<Env>, e), parseJson }));

  v1.get("/audit", async (c) => {
    requireRole(c, "admin");
    if (deps.audit === undefined) throw new HttpError(404, "audit_disabled", "Audit log is not configured");
    const action = c.req.query("action") as AuditAction | undefined;
    const events = await deps.audit.list({ ...(action !== undefined && { action }), limit: limitQuery(1000, 100).parse(c.req.query("limit")) });
    return c.json({ events: events.map((e) => ({ ...e, at: e.at.toISOString() })) });
  });

  app.route("/v1", v1);
  return app;
}
