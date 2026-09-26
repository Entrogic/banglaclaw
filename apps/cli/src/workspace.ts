import { resolve } from "node:path";
import type { GatewayUploads, GatewayWorkspace } from "@entrogic-net/gateway";
import type { SessionStore } from "@entrogic-net/session";
import type { LoadedConfig, Logger, Transcriber } from "@entrogic-net/shared";
import type { AnyTool } from "@entrogic-net/tools";
import { Workspace, createWorkspaceTools } from "@entrogic-net/workspace";
import { createTranscriber } from "./channels.js";
import { createUploadSaver } from "./documents.js";

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

/**
 * What `serve` gives the gateway for the web chat's files panel, uploads and microphone: the
 * workspace (when the api channel may use it), the upload saver, and speech-to-text (voice.enabled).
 */
export function gatewayFileDeps(
  loaded: LoadedConfig,
  logger?: Logger,
): { workspace?: GatewayWorkspace; uploads?: GatewayUploads; transcriber?: Transcriber; transcriptionLanguage?: string } {
  const { config } = loaded;
  const workspace = config.workspace.channels.includes("api") ? openWorkspace(loaded) : undefined;
  let transcriber: Transcriber | undefined;
  try {
    transcriber = createTranscriber(loaded);
  } catch (error) {
    logger?.warn("transcription disabled for the web chat", { error });
  }
  return {
    ...(workspace !== undefined && { workspace }),
    ...(workspace !== undefined && config.workspace.uploads && { uploads: createUploadSaver(workspace, config.workspace.maxUploadBytes) }),
    ...(transcriber !== undefined && { transcriber, ...(config.voice.language !== "auto" && { transcriptionLanguage: config.voice.language }) }),
  };
}
