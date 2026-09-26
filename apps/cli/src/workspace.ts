import { resolve } from "node:path";
import type { SessionStore } from "@entrogic-net/session";
import type { LoadedConfig, Logger } from "@entrogic-net/shared";
import type { AnyTool } from "@entrogic-net/tools";
import { Workspace, createWorkspaceTools } from "@entrogic-net/workspace";

/** The configured workspace (resolved against the config file's folder), or undefined when off. */
export function openWorkspace(loaded: LoadedConfig): Workspace | undefined {
  const { enabled, dir, maxFileBytes, maxFiles, maxTotalBytes, historyVersions } = loaded.config.workspace;
  return enabled ? new Workspace(resolve(loaded.baseDir, dir), { maxFileBytes, maxFiles, maxTotalBytes, historyVersions }) : undefined;
}

/** workspace_* tools when the workspace is enabled (they still need tools.allow). */
export function workspaceTools(loaded: LoadedConfig, sessions: SessionStore, logger?: Logger): AnyTool[] {
  const workspace = openWorkspace(loaded);
  return workspace === undefined ? [] : createWorkspaceTools(workspace, sessions, { channels: loaded.config.workspace.channels, ...(logger !== undefined && { logger }) });
}
