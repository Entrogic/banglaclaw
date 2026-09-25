import type { AnyTool } from "./tool.js";

export type PermissionDecision = { allowed: true } | { allowed: false; reason: string };

export interface PermissionPolicy {
  check(tool: AnyTool): PermissionDecision;
}

/**
 * Deny-by-default allowlist. Destructive tools are always denied in v0.1 because
 * there is no human-confirmation flow yet — the LLM must never be the gate.
 */
export class AllowlistPolicy implements PermissionPolicy {
  readonly #allow: ReadonlySet<string>;

  constructor(allow: Iterable<string>) {
    this.#allow = new Set(allow);
  }

  check(tool: AnyTool): PermissionDecision {
    if (tool.risk === "destructive") {
      return { allowed: false, reason: `Tool "${tool.name}" is destructive and requires human confirmation` };
    }
    if (!this.#allow.has(tool.name)) {
      return { allowed: false, reason: `Tool "${tool.name}" is not in the allowlist` };
    }
    return { allowed: true };
  }
}
