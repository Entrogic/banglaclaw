import type { UpgradeWebSocket, WSContext } from "hono/ws";
import { z } from "zod";
import { AgentRunError } from "@banglaclaw/agent";
import type { Principal } from "@banglaclaw/auth";
import type { Logger } from "@banglaclaw/shared";
import type { GatewayContext } from "./context.js";
import { HttpError, toHttpError } from "./errors.js";
import { runJson } from "./serialize.js";

const AUTH_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_BYTES = 256 * 1024;

function clientMessage(maxInputChars: number) {
  return z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("auth"), apiKey: z.string().min(1).max(200) }),
    z.strictObject({
      type: z.literal("run"),
      ref: z.string().min(1).max(100).optional(),
      text: z.string().trim().min(1).max(maxInputChars),
      sessionId: z.uuid().optional(),
      externalId: z.string().min(1).max(200).optional(),
    }),
    z.strictObject({ type: z.literal("cancel"), ref: z.string().min(1).max(100) }),
    z.strictObject({ type: z.literal("ping") }),
  ]);
}

/**
 * WebSocket protocol (GET /v1/ws):
 *   → {type:"auth", apiKey}                       unless an Authorization header was sent on upgrade
 *   → {type:"run", ref?, text, sessionId?, externalId?}
 *   → {type:"cancel", ref} | {type:"ping"}
 *   ← {type:"ready", user} | {type:"event", ref, event} | {type:"done", ref, sessionId, run}
 *   ← {type:"error", ref?, error:{code, message}} | {type:"pong"}
 * Close codes: 4401 unauthenticated, 1009 message too large.
 */
export function websocketHandler(gw: GatewayContext, upgradeWebSocket: UpgradeWebSocket, logger: Logger) {
  const schema = clientMessage(gw.deps.config.maxInputChars);

  return upgradeWebSocket((c) => {
    const headerToken = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    let principal: Principal | undefined;
    let authTimer: NodeJS.Timeout | undefined;
    const runs = new Map<string, AbortController>();
    let counter = 0;

    const send = (ws: WSContext, message: unknown) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(message));
    };
    const sendError = (ws: WSContext, error: HttpError, ref?: string) =>
      send(ws, { type: "error", ...(ref !== undefined && { ref }), error: { code: error.code, message: error.message } });

    const authenticate = async (ws: WSContext, token: string) => {
      principal = await gw.deps.auth.authenticate(token);
      if (principal === undefined) {
        ws.close(4401, "invalid API key");
        return;
      }
      clearTimeout(authTimer);
      send(ws, { type: "ready", user: { id: principal.user.id, name: principal.user.name } });
    };

    const startRun = async (ws: WSContext, who: Principal, msg: { ref?: string; text: string; sessionId?: string; externalId?: string }) => {
      const ref = msg.ref ?? `run-${++counter}`;
      if (runs.has(ref)) return sendError(ws, new HttpError(400, "duplicate_ref", `A run with ref "${ref}" is already active`), ref);
      if (!who.key.scopes.includes("run")) return sendError(ws, new HttpError(403, "insufficient_scope", 'This API key lacks the "run" scope'), ref);
      const rate = gw.rate.take(who.key.id);
      if (!rate.ok) return sendError(ws, new HttpError(429, "rate_limited", `Rate limit exceeded; retry in ${rate.retryAfterSeconds}s`), ref);

      let release: (() => void) | undefined;
      const controller = new AbortController();
      runs.set(ref, controller);
      try {
        release = gw.acquireRun(who);
        const { session } = await gw.resolveSession(who, {
          ...(msg.sessionId !== undefined && { sessionId: msg.sessionId }),
          ...(msg.externalId !== undefined && { externalId: msg.externalId }),
        });
        const record = await gw.deps.runtime
          .run(msg.text, { sessionId: session.id, signal: controller.signal, onEvent: (event) => send(ws, { type: "event", ref, event }) })
          .catch((error: unknown) => {
            if (error instanceof AgentRunError) return error.record;
            throw error;
          });
        send(ws, { type: "done", ref, sessionId: session.id, run: runJson(record) });
      } catch (error) {
        sendError(ws, toHttpError(error), ref);
      } finally {
        release?.();
        runs.delete(ref);
      }
    };

    return {
      onOpen(_evt, ws) {
        if (headerToken !== undefined) {
          void authenticate(ws, headerToken);
        } else {
          authTimer = setTimeout(() => {
            if (principal === undefined) ws.close(4401, "authentication timeout");
          }, AUTH_TIMEOUT_MS);
        }
      },
      onMessage(evt, ws) {
        const raw = typeof evt.data === "string" ? evt.data : "";
        if (raw.length > MAX_MESSAGE_BYTES) return ws.close(1009, "message too large");
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          return sendError(ws, new HttpError(400, "invalid_json", "Messages must be JSON"));
        }
        const parsed = schema.safeParse(json);
        if (!parsed.success) return sendError(ws, new HttpError(400, "invalid_message", z.prettifyError(parsed.error)));
        const msg = parsed.data;

        if (msg.type === "ping") return send(ws, { type: "pong" });
        if (msg.type === "auth") {
          if (principal !== undefined) return sendError(ws, new HttpError(400, "already_authenticated", "Already authenticated"));
          return void authenticate(ws, msg.apiKey);
        }
        if (principal === undefined) return sendError(ws, new HttpError(401, "unauthenticated", "Send {type:\"auth\", apiKey} first"));
        if (msg.type === "cancel") {
          runs.get(msg.ref)?.abort();
          return;
        }
        void startRun(ws, principal, msg).catch((error: unknown) => logger.error("websocket run failed", { error }));
      },
      onClose() {
        clearTimeout(authTimer);
        for (const controller of runs.values()) controller.abort();
        runs.clear();
      },
    };
  });
}
