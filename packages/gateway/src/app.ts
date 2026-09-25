import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { UpgradeWebSocket } from "hono/ws";
import type { z } from "zod";
import type { Principal } from "@banglaclaw/auth";
import { createLogger, type Logger } from "@banglaclaw/shared";
import { GatewayContext, type GatewayDeps } from "./context.js";
import { HttpError, toHttpError, type ErrorBody } from "./errors.js";
import { respondWithRun } from "./run.js";
import { createSessionBody, limitQuery, messageBody, runBody } from "./schemas.js";
import { messageJson, runJson, sessionJson } from "./serialize.js";
import { websocketHandler } from "./ws.js";

type Env = { Variables: { requestId: string; principal: Principal; log: Logger } };

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

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

  app.use("*", async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming !== undefined && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    const started = performance.now();
    c.set("requestId", requestId);
    c.set("log", logger.child({ requestId }));
    c.header("X-Request-Id", requestId);
    await next();
    c.get("log").info("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(performance.now() - started),
      userId: c.get("principal")?.user.id,
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

  if (upgradeWebSocket !== undefined) {
    // Authenticated inside the protocol (browsers cannot set headers on WebSocket upgrades).
    app.get("/v1/ws", websocketHandler(gw, upgradeWebSocket, logger));
  }

  const v1 = new Hono<Env>();
  v1.use("*", bodyLimit({ maxSize: 256 * 1024, onError: () => { throw new HttpError(413, "payload_too_large", "Request body too large"); } }));
  v1.use("*", async (c, next) => {
    const header = c.req.header("authorization");
    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    const principal = await deps.auth.authenticate(token);
    if (principal === undefined) {
      throw new HttpError(401, "unauthenticated", token === undefined ? "Missing Authorization: Bearer <api key>" : "Invalid API key", {
        "WWW-Authenticate": 'Bearer realm="banglaclaw"',
      });
    }
    c.set("principal", principal);
    const decision = gw.rate.take(principal.key.id);
    c.header("X-RateLimit-Limit", String(gw.rate.limitPerMinute));
    if (!decision.ok) {
      throw new HttpError(429, "rate_limited", "Rate limit exceeded", { "Retry-After": String(decision.retryAfterSeconds) });
    }
    c.header("X-RateLimit-Remaining", String(decision.remaining));
    await next();
  });

  v1.get("/me", (c) => {
    const { user, key } = c.get("principal");
    return c.json({ user: { id: user.id, name: user.name }, key: { id: key.id, name: key.name, createdAt: key.createdAt.toISOString() } });
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
    const sessions = await deps.sessions.list({ userId: c.get("principal").user.id, limit });
    return c.json({ sessions: sessions.map(sessionJson) });
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

  v1.get("/runs/:id", async (c) => {
    const run = await deps.runs.get(c.req.param("id"));
    if (run !== undefined) {
      const session = await deps.sessions.get(run.sessionId);
      if (session?.userId === c.get("principal").user.id) return c.json({ run: runJson(run) });
    }
    throw new HttpError(404, "run_not_found", "Run not found");
  });

  app.route("/v1", v1);
  return app;
}
