import type { AnyTool } from "./tool.js";

export type PermissionDecision = { allowed: true } | { allowed: false; reason: string };

export interface PermissionPolicy {
  check(tool: AnyTool): PermissionDecision;
}

/**
 * Deny-by-default allowlist. Entries are exact tool names, or a prefix ending in `*`
 * (e.g. `bangladesh__*` for every tool of one MCP server). Destructive tools are always
 * denied because there is no human-confirmation flow yet — the LLM must never be the gate.
 */
export class AllowlistPolicy implements PermissionPolicy {
  readonly #exact: ReadonlySet<string>;
  readonly #prefixes: readonly string[];

  constructor(allow: Iterable<string>) {
    const entries = [...allow];
    this.#exact = new Set(entries.filter((e) => !e.endsWith("*")));
    // A bare "*" would allow everything; require a non-empty prefix.
    this.#prefixes = entries.filter((e) => e.endsWith("*") && e.length > 1).map((e) => e.slice(0, -1));
  }

  #isAllowed(name: string): boolean {
    return this.#exact.has(name) || this.#prefixes.some((p) => name.startsWith(p));
  }

  check(tool: AnyTool): PermissionDecision {
    if (tool.risk === "destructive") {
      return { allowed: false, reason: `Tool "${tool.name}" is destructive and requires human confirmation` };
    }
    if (!this.#isAllowed(tool.name)) {
      return { allowed: false, reason: `Tool "${tool.name}" is not in the allowlist` };
    }
    return { allowed: true };
  }
}
