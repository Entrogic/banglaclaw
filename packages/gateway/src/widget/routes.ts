import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { AgentRunError } from "@entrogic-net/agent";
import { isOperatorMessage, type RunRecord, type Session } from "@entrogic-net/session";
import { ConcurrencyLimiter, RateLimiter, type NewAuditEvent, type RunEvent } from "@entrogic-net/shared";
import type { GatewayContext, GatewayEnv, WidgetOptions } from "../context.js";
import { HttpError } from "../errors.js";
import type { SessionEvent } from "../session-events.js";
import { widgetFrameHtml, widgetLoaderJs, type WidgetPublicConfig } from "./assets.js";
import { VisitorTokens, type VisitorToken } from "./token.js";

export const WIDGET_CHANNEL = "widget";
const KEEPALIVE_MS = 25_000;
/** Visitors behind one NAT (offices, mobile carriers) share an IP, so the per-IP budget is wider. */
const IP_MESSAGE_FACTOR = 5;
const EVENT_STREAMS_PER_VISITOR = 2;

type Audit = (c: Context<GatewayEnv>, event: Omit<NewAuditEvent, "ip" | "requestId">, throttleKey?: string) => void;

const isControl = (tool: string) => tool.startsWith("transfer_to_") || tool === "request_human";

/**
 * The embeddable website widget (docs/11, ADR-0013). Anonymous visitors hold a signed token
 * instead of an API key; each visitor id keys one `widget` session. The frame is same-origin with
 * the gateway, so no CORS is needed, and CSP frame-ancestors limits which sites may embed it.
 * Visitors never see tool names, inputs or outputs.
 */
export function widgetRoutes(gw: GatewayContext, options: WidgetOptions, audit: Audit): Hono<GatewayEnv> {
  const app = new Hono<GatewayEnv>();
  const { sessions, runtime } = gw.deps;
  const tokens = new VisitorTokens(options.secret, options.visitorTtlDays * 86_400);
  const visitorRate = new RateLimiter(options.messagesPerMinute);
  const ipRate = new RateLimiter(options.messagesPerMinute * IP_MESSAGE_FACTOR);
  const sessionRate = new RateLimiter(options.sessionsPerMinute);
  const runsPerVisitor = new ConcurrencyLimiter(1);
  const runsTotal = new ConcurrencyLimiter(options.maxConcurrentRuns);
  const eventStreams = new ConcurrencyLimiter(EVENT_STREAMS_PER_VISITOR);
  const messageBody = z.strictObject({ text: z.string().trim().min(1).max(options.maxInputChars) });
  const sessionBody = z.strictObject({ token: z.string().max(200).optional() });

  const publicConfig: WidgetPublicConfig = { title: options.title, greeting: options.greeting, color: options.color, position: options.position, maxInputChars: options.maxInputChars };
  const loader = widgetLoaderJs(publicConfig);
  const frame = widgetFrameHtml(publicConfig);
  const frameCsp = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors ${options.allowedOrigins.join(" ")}`;

  const limited = (c: Context<GatewayEnv>, decision: ReturnType<RateLimiter["take"]>, target: string): void => {
    if (decision.ok) return;
    audit(c, { action: "rate_limited", outcome: "denied", target }, target);
    throw new HttpError(429, "rate_limited", "Too many messages. Please wait a moment.", { "Retry-After": String(decision.retryAfterSeconds) });
  };
  const visitor = (c: Context<GatewayEnv>): VisitorToken => {
    const found = tokens.verify(c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]);
    if (found === undefined) throw new HttpError(401, "invalid_visitor_token", "Visitor token missing, invalid or expired");
    return found;
  };
  const findSession = (v: VisitorToken) => sessions.findByExternalId(WIDGET_CHANNEL, v.visitorId);
  const parse = async <T>(c: Context<GatewayEnv>, schema: z.ZodType<T>): Promise<T> => {
    let raw: unknown = {};
    const text = await c.req.text();
    if (text.trim() !== "") {
      try {
        raw = JSON.parse(text);
      } catch {
        throw new HttpError(400, "invalid_json", "Request body must be JSON");
      }
    }
    const result = schema.safeParse(raw);
    if (!result.success) throw new HttpError(400, "invalid_request", result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    return result.data;
  };

  app.get("/widget.js", (c) =>
    c.body(loader, 200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", "Cross-Origin-Resource-Policy": "cross-origin" }),
  );

  app.get("/widget/frame", (c) => {
    c.header("X-Frame-Options", undefined); // embedding is governed by frame-ancestors instead
    c.header("Content-Security-Policy", frameCsp);
    c.header("Cache-Control", "public, max-age=300");
    return c.html(frame);
  });

  app.use("/widget/api/*", bodyLimit({ maxSize: 16 * 1024, onError: () => { throw new HttpError(413, "payload_too_large", "Request body too large"); } }));
  app.use("/widget/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });

  /** Issues a visitor token, or renews a valid one so the visitor keeps their conversation. */
  app.post("/widget/api/session", async (c) => {
    const body = await parse(c, sessionBody);
    const current = tokens.verify(body.token);
    if (current === undefined) limited(c, sessionRate.take(c.get("ip") ?? "unknown"), `widget-ip:${c.get("ip") ?? "unknown"}`);
    const { token, visitor: v } = tokens.issue(current?.visitorId);
    return c.json({ token, expiresAt: new Date(v.exp * 1000).toISOString(), resumed: current !== undefined });
  });

  /** The visitor's conversation as plain text: tool calls and internal messages are left out. */
  app.get("/widget/api/history", async (c) => {
    const session = await findSession(visitor(c));
    if (session === undefined) return c.json({ messages: [], handoff: false });
    const messages = (await sessions.recentMessages(session.id, 100)).flatMap((m) => {
      const type = m.getType();
      const text = m.text.trim();
      if (text === "") return [];
      if (type === "human") return [{ role: "user", text }];
      if (type === "ai") return [{ role: isOperatorMessage(m) ? "operator" : "assistant", text }];
      return [];
    });
    return c.json({ messages, handoff: session.status === "handoff" });
  });

  /** Runs the agent for one visitor message and streams `token`, `activity`, `handoff`, then `done` (or `error`). */
  app.post("/widget/api/messages", async (c) => {
    const v = visitor(c);
    const { text } = await parse(c, messageBody);
    limited(c, visitorRate.take(v.visitorId), `widget:${v.visitorId}`);
    limited(c, ipRate.take(c.get("ip") ?? "unknown"), `widget-ip:${c.get("ip") ?? "unknown"}`);
    const releaseVisitor = runsPerVisitor.acquire(v.visitorId);
    if (releaseVisitor === undefined) throw new HttpError(429, "reply_in_progress", "Please wait for the current reply to finish.", { "Retry-After": "1" });
    const releaseTotal = runsTotal.acquire("all");
    if (releaseTotal === undefined) {
      releaseVisitor();
      throw new HttpError(503, "busy", "The assistant is busy. Please try again in a moment.", { "Retry-After": "2" });
    }
    let session: Session;
    try {
      session = (await findSession(v)) ?? (await sessions.create({ channel: WIDGET_CHANNEL, agentId: gw.deps.agent.name, externalId: v.visitorId }));
    } catch (error) {
      releaseVisitor();
      releaseTotal();
      throw error;
    }

    return streamSSE(c, async (stream) => {
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      let pending = Promise.resolve();
      const send = (event: string, data: unknown) => {
        pending = pending.then(() => (stream.aborted ? undefined : stream.writeSSE({ event, data: JSON.stringify(data) })));
      };
      const onEvent = (e: RunEvent) => {
        if (e.type === "token") send("token", { text: e.text });
        else if (e.type === "tool_start" && !isControl(e.tool)) send("activity", { kind: "tool" });
        else if (e.type === "handoff") send("handoff", { pending: e.pending });
      };
      try {
        let record: RunRecord | undefined;
        try {
          record = await runtime.run(text, { sessionId: session.id, signal: controller.signal, onEvent });
        } catch (error) {
          if (error instanceof AgentRunError) record = error.record;
          else c.get("log").error("widget run failed", { error });
        }
        if (record === undefined || record.status === "error") send("error", { message: "Something went wrong. Please try again." });
        else send("done", { status: record.status, reply: record.output ?? "" });
        await pending;
      } finally {
        releaseVisitor();
        releaseTotal();
      }
    });
  });

  /** Starts a fresh conversation: the old session stays for operators but no longer belongs to the visitor. */
  app.post("/widget/api/reset", async (c) => {
    const session = await findSession(visitor(c));
    if (session !== undefined) await sessions.detachExternalId(session.id);
    return c.body(null, 204);
  });

  /** Operator replies and releases for the visitor's session (SSE, `ready` first, `ping` every 25 s). */
  app.get("/widget/api/events", async (c) => {
    const v = visitor(c);
    const session = await findSession(v);
    if (session === undefined) throw new HttpError(404, "no_conversation", "No conversation yet");
    const release = eventStreams.acquire(v.visitorId);
    if (release === undefined) throw new HttpError(429, "too_many_event_streams", "Too many open event streams");
    return streamSSE(c, async (stream) => {
      let pending = Promise.resolve();
      const send = (event: string, data: unknown) => {
        pending = pending.then(() => (stream.aborted ? undefined : stream.writeSSE({ event, data: JSON.stringify(data) })));
      };
      const unsubscribe = gw.events.subscribe(session.id, (e: SessionEvent) => {
        if (e.type === "operator_message") send("operator", { text: e.text });
        else send("released", {});
      });
      const keepalive = setInterval(() => send("ping", {}), KEEPALIVE_MS);
      try {
        send("ready", { handoff: session.status === "handoff" });
        await new Promise<void>((resolve) => stream.onAbort(resolve));
      } finally {
        clearInterval(keepalive);
        unsubscribe();
        release();
      }
    });
  });

  return app;
}
