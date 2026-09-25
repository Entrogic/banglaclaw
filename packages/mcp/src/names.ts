import { createHash } from "node:crypto";

const MAX_TOOL_NAME = 64;

function sanitize(part: string): string {
  const s = part
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s.length > 0 ? s : "tool";
}

/**
 * BanglaClaw name for an MCP tool: `<server>__<tool>` in snake_case, at most 64 chars.
 * Over-long names are truncated with a short hash so they stay unique and stable.
 */
export function toolNameFor(server: string, mcpToolName: string): string {
  const name = `${server}__${sanitize(mcpToolName)}`;
  if (name.length <= MAX_TOOL_NAME) return name;
  const hash = createHash("sha256").update(mcpToolName).digest("hex").slice(0, 8);
  return `${name.slice(0, MAX_TOOL_NAME - 9)}_${hash}`;
}
