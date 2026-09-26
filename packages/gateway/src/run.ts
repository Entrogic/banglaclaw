import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { AgentRunError } from "@entrogic-net/agent";
import type { Principal } from "@entrogic-net/auth";
import type { RunRecord, Session } from "@entrogic-net/session";
import type { RunEvent } from "@entrogic-net/shared";
import type { GatewayContext } from "./context.js";
import { toHttpError } from "./errors.js";
import { runJson } from "./serialize.js";

export function wantsStream(c: Context): boolean {
  return c.req.query("stream") === "true" || (c.req.header("accept") ?? "").includes("text/event-stream");
}

/**
 * Runs the agent for an HTTP request. Streaming requests get Server-Sent Events
 * (`run_start`, `token`, `tool_start`, `tool_end`, `final`/`error`, then `done`); others get JSON.
 * A client disconnect aborts the run.
 */
export async function respondWithRun(c: Context, gw: GatewayContext, principal: Principal, session: Session, text: string, created: boolean) {
  const release = gw.acquireRun(principal);
  const { runtime } = gw.deps;
  c.header("X-Session-Id", session.id);

  if (!wantsStream(c)) {
    try {
      const record = await runtime.run(text, { sessionId: session.id, signal: c.req.raw.signal });
      return c.json({ sessionId: session.id, sessionCreated: created, reply: record.output ?? "", run: runJson(record) });
    } finally {
      release();
    }
  }

  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    stream.onAbort(() => controller.abort());
    // Serialise writes so events stay in order even though onEvent is synchronous.
    let pending = Promise.resolve();
    const send = (event: string, data: unknown) => {
      pending = pending.then(() => (stream.aborted ? undefined : stream.writeSSE({ event, data: JSON.stringify(data) })));
    };
    try {
      send("session", { sessionId: session.id, created });
      let record: RunRecord | undefined;
      try {
        record = await runtime.run(text, {
          sessionId: session.id,
          signal: controller.signal,
          onEvent: (e: RunEvent) => send(e.type, e),
        });
      } catch (error) {
        // The runtime already emitted an `error` event; report the persisted record if there is one.
        if (!(error instanceof AgentRunError)) {
          const http = toHttpError(error);
          send("error", { type: "error", code: http.code, message: http.message });
        } else {
          record = error.record;
        }
      }
      if (record !== undefined) send("done", { sessionId: session.id, run: runJson(record) });
      await pending;
    } finally {
      release();
    }
  });
}
