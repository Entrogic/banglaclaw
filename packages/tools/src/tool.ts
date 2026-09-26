import type { z } from "zod";

export type { ToolSpec } from "@entrogic-net/shared";

/**
 * Risk level drives the permission policy:
 * - safe: read-only / side-effect free
 * - sensitive: reads private data or calls external services
 * - destructive: mutates or deletes state; never auto-allowed in v0.1
 */
export type ToolRisk = "safe" | "sensitive" | "destructive";

export interface ToolContext {
  runId: string;
  sessionId: string;
  timezone: string;
  signal: AbortSignal;
}

export interface BanglaClawTool<I = unknown, O = unknown> {
  /** Short, snake_case, action-oriented. */
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  /**
   * JSON Schema advertised to the model. Defaults to one generated from `inputSchema`; set it
   * when the tool already has an authoritative JSON Schema (e.g. tools discovered over MCP).
   */
  parameters?: Record<string, unknown>;
  risk: ToolRisk;
  /** Per-call timeout; defaults to 10s. */
  timeoutMs?: number;
  execute(input: I, ctx: ToolContext): Promise<O>;
}

/** Type-erased tool as stored in the registry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- variance: registry must hold tools of any I/O
export type AnyTool = BanglaClawTool<any, any>;

export function defineTool<I, O>(tool: BanglaClawTool<I, O>): BanglaClawTool<I, O> {
  return tool;
}
