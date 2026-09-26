import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContextProvider } from "@entrogic-net/agent";
import type { AnyTool } from "@entrogic-net/tools";

export { defineTool, type AnyTool, type BanglaClawTool, type ToolContext, type ToolRisk } from "@entrogic-net/tools";
export type { ContextProvider, RunContext } from "@entrogic-net/agent";
/** Use this zod instance for tool schemas so they match the runtime's JSON Schema conversion. */
export { z } from "zod";

export const PLUGIN_API_VERSION = 1;

export interface BanglaClawPlugin {
  /** kebab-case, unique. */
  name: string;
  version: string;
  /** Plugin API the plugin was written for (currently 1). */
  apiVersion?: number;
  description?: string;
  /** Tools to register. They still have to be allowed in tools.allow. */
  tools?: AnyTool[];
  /** Absolute directories with <skill>/SKILL.md (use pluginDir(import.meta.url, "skills")). */
  skillsDirs?: string[];
  /** Absolute directories with <agent>/AGENT.md. */
  agentsDirs?: string[];
  contextProviders?: ContextProvider[];
}

/** Identity helper that type-checks a plugin definition. Default-export its result. */
export function definePlugin(plugin: BanglaClawPlugin): BanglaClawPlugin {
  return { apiVersion: PLUGIN_API_VERSION, ...plugin };
}

/** Resolves a path relative to the plugin module, e.g. pluginDir(import.meta.url, "skills"). */
export function pluginDir(moduleUrl: string, ...segments: string[]): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), ...segments);
}
