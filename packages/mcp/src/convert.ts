import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult, Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ToolExecutionError } from "@entrogic-net/shared";
import { defineTool, type AnyTool, type ToolRisk } from "@entrogic-net/tools";
import { toolNameFor } from "./names.js";

const MAX_DESCRIPTION = 1024;
export const DEFAULT_MAX_OUTPUT_CHARS = 20_000;

export const McpToolOutputSchema = z.strictObject({
  /** Omitted when it would only repeat `structured` (servers often send both). */
  content: z.string().optional(),
  structured: z.unknown().optional(),
  truncated: z.boolean(),
});
export type McpToolOutput = z.infer<typeof McpToolOutputSchema>;

/**
 * MCP servers are untrusted: annotations can only raise risk. Everything is at least
 * "sensitive" (external process/service); destructiveHint marks it destructive, which the
 * policy always denies.
 */
export function riskFor(tool: McpTool): ToolRisk {
  const a = tool.annotations;
  if (a?.destructiveHint === true && a.readOnlyHint !== true) return "destructive";
  return "sensitive";
}

/** Validator for the server-published JSON Schema; falls back to "any object" if it can't be converted. */
export function inputValidatorFor(tool: McpTool): z.ZodType<Record<string, unknown>> {
  try {
    return z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]) as z.ZodType<Record<string, unknown>>;
  } catch {
    return z.record(z.string(), z.unknown());
  }
}

/** Flattens MCP content blocks into text the model can read. */
export function flattenResult(result: CallToolResult, maxChars = DEFAULT_MAX_OUTPUT_CHARS): McpToolOutput {
  const parts = result.content.map((block) => {
    switch (block.type) {
      case "text":
        return block.text;
      case "image":
        return `[image ${block.mimeType}]`;
      case "audio":
        return `[audio ${block.mimeType}]`;
      case "resource":
        return "text" in block.resource ? block.resource.text : `[resource ${block.resource.uri}]`;
      case "resource_link":
        return `[resource ${block.uri}${block.name !== undefined ? ` "${block.name}"` : ""}]`;
      default:
        return "[unsupported content]";
    }
  });
  let content = parts.join("\n");
  const structured = result.structuredContent;
  if (structured !== undefined) {
    const serialized = JSON.stringify(structured);
    if (serialized.length > maxChars) {
      // Too large to pass as structured data; fall back to truncated text.
      return { content: `${serialized.slice(0, maxChars)}\n…[truncated]`, truncated: true };
    }
    if (content === serialized || content.trim() === "") return { structured, truncated: false };
  }
  const truncated = content.length > maxChars;
  if (truncated) content = `${content.slice(0, maxChars)}\n…[truncated]`;
  return { content, truncated, ...(structured !== undefined && { structured }) };
}

export interface ToolFromMcpOptions {
  server: string;
  client: Client;
  timeoutMs: number;
  maxOutputChars?: number;
}

/** Wraps a discovered MCP tool as a BanglaClawTool so it goes through the normal executeTool lifecycle. */
export function toolFromMcp(tool: McpTool, options: ToolFromMcpOptions): AnyTool {
  const { server, client, timeoutMs } = options;
  const description = (tool.description ?? tool.title ?? tool.name).slice(0, MAX_DESCRIPTION);
  const { $schema: _schema, ...parameters } = tool.inputSchema as Record<string, unknown>;

  return defineTool({
    name: toolNameFor(server, tool.name),
    description: `[MCP ${server}] ${description}`,
    risk: riskFor(tool),
    // executeTool enforces this too; the MCP request gets a slightly shorter timeout so its error surfaces first.
    timeoutMs: timeoutMs + 1_000,
    inputSchema: inputValidatorFor(tool),
    outputSchema: McpToolOutputSchema,
    parameters,
    async execute(input, ctx) {
      const result = (await client.callTool({ name: tool.name, arguments: input }, undefined, {
        signal: ctx.signal,
        timeout: timeoutMs,
      })) as CallToolResult;
      const output = flattenResult(result, options.maxOutputChars);
      if (result.isError === true) {
        const detail = output.content ?? JSON.stringify(output.structured) ?? "";
        throw new ToolExecutionError(`MCP tool ${server}/${tool.name} failed: ${detail.slice(0, 500)}`);
      }
      return output;
    },
  });
}
