import { z } from "zod";
import type { ToolAuditEvent } from "@entrogic-net/shared";
import type { PermissionPolicy } from "./policy.js";
import type { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./tool.js";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface ToolCallRequest {
  id: string;
  name: string;
  args: unknown;
}

export interface ToolCallResult {
  /** Serialised observation handed back to the model. */
  content: string;
  audit: ToolAuditEvent;
}

export interface ExecuteToolOptions {
  registry: ToolRegistry;
  policy: PermissionPolicy;
  ctx: ToolContext;
  onAudit?: (event: ToolAuditEvent) => void;
}

/**
 * Tool lifecycle (docs/09): lookup → validate input → permission check → execute (with timeout)
 * → validate output → audit. Never throws for tool-level failures: the model receives a
 * structured error observation and the audit records what happened.
 */
export async function executeTool(call: ToolCallRequest, options: ExecuteToolOptions): Promise<ToolCallResult> {
  const { registry, policy, ctx, onAudit } = options;
  const started = performance.now();

  const finish = (
    status: ToolAuditEvent["status"],
    body: { output?: unknown; error?: string },
  ): ToolCallResult => {
    const audit: ToolAuditEvent = {
      runId: ctx.runId,
      toolCallId: call.id,
      tool: call.name,
      input: call.args,
      status,
      durationMs: Math.round(performance.now() - started),
      ...body,
    };
    onAudit?.(audit);
    const content = status === "ok" ? JSON.stringify(body.output) : JSON.stringify({ error: status, message: body.error });
    return { content, audit };
  };

  const tool = registry.get(call.name);
  if (tool === undefined) {
    return finish("unknown_tool", { error: `No tool named "${call.name}"` });
  }

  const parsedInput = tool.inputSchema.safeParse(call.args);
  if (!parsedInput.success) {
    return finish("invalid_input", { error: z.prettifyError(parsedInput.error) });
  }

  const decision = policy.check(tool);
  if (!decision.allowed) {
    return finish("denied", { error: decision.reason });
  }

  let output: unknown;
  try {
    output = await withTimeout(
      (signal) => tool.execute(parsedInput.data, { ...ctx, signal }),
      tool.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ctx.signal,
    );
  } catch (error) {
    return finish("error", { error: error instanceof Error ? error.message : String(error) });
  }

  const parsedOutput = tool.outputSchema.safeParse(output);
  if (!parsedOutput.success) {
    return finish("invalid_output", { error: `Tool returned invalid output: ${z.prettifyError(parsedOutput.error)}` });
  }
  return finish("ok", { output: parsedOutput.data });
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent: AbortSignal): Promise<T> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)]);
  signal.throwIfAborted();
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error("Tool call aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    run(signal).then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
