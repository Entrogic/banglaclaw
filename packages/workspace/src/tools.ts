import { z } from "zod";
import { sessionOwner, type SessionStore } from "@entrogic-net/session";
import { ToolExecutionError, type Logger } from "@entrogic-net/shared";
import { defineTool, type AnyTool, type ToolContext } from "@entrogic-net/tools";
import { WorkspaceError, type Workspace } from "./workspace.js";

export interface WorkspaceToolOptions {
  /** Session channels allowed to use the workspace (e.g. cli, api, telegram). */
  channels: readonly string[];
  logger?: Logger;
}

const path = z.string().min(1).max(200).describe('Path relative to the workspace, e.g. "notes/todo.md"');
const content = z.string().describe("Full file content (UTF-8 text)");

/**
 * The workspace tools. The owner (whose folder is used) always comes from the session, never
 * from the model, and channels outside `options.channels` are refused. Every tool is "sensitive":
 * writes are confined to the owner's folder and can be undone (history and trash, ADR-0014).
 */
export function createWorkspaceTools(workspace: Workspace, sessions: SessionStore, options: WorkspaceToolOptions): AnyTool[] {
  const allowed = new Set(options.channels);

  /** Resolves the caller's owner and turns unexpected fs errors into messages without server paths. */
  const run = async <T>(ctx: ToolContext, action: (owner: string) => Promise<T>): Promise<T> => {
    const session = await sessions.get(ctx.sessionId);
    if (session === undefined) throw new ToolExecutionError("Session not found");
    if (!allowed.has(session.channel)) throw new ToolExecutionError(`The workspace is not available in the ${session.channel} channel`);
    try {
      return await action(sessionOwner(session));
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      options.logger?.error("workspace operation failed", { error, sessionId: ctx.sessionId });
      throw new ToolExecutionError("The workspace operation failed");
    }
  };

  return [
    defineTool({
      name: "workspace_list",
      description: "List the files and folders in the user's workspace (or in one folder of it). Use it to find files before reading or changing them.",
      risk: "sensitive",
      inputSchema: z.strictObject({ path: path.optional().describe("Folder to list; omit for the whole workspace") }),
      outputSchema: z.strictObject({
        entries: z.array(z.strictObject({ path: z.string(), type: z.enum(["file", "dir"]), size: z.number(), modified: z.string() })),
        truncated: z.boolean(),
      }),
      execute: ({ path: dir }, ctx) => run(ctx, (owner) => workspace.list(owner, dir)),
    }),
    defineTool({
      name: "workspace_read",
      description: "Read a text file from the user's workspace. Optionally read a window of lines (offset is 1-based). Always read a file before editing it.",
      risk: "sensitive",
      inputSchema: z.strictObject({ path, offset: z.int().min(1).optional(), limit: z.int().min(1).max(5_000).optional() }),
      outputSchema: z.strictObject({ path: z.string(), content: z.string(), totalLines: z.number(), truncated: z.boolean() }),
      execute: ({ path: p, offset, limit }, ctx) =>
        run(ctx, (owner) => workspace.read(owner, p, { ...(offset !== undefined && { offset }), ...(limit !== undefined && { limit }) })),
    }),
    defineTool({
      name: "workspace_create",
      description: "Create a new text file in the user's workspace (folders are created as needed). Fails if the file already exists.",
      risk: "sensitive",
      inputSchema: z.strictObject({ path, content }),
      outputSchema: z.strictObject({ path: z.string(), bytes: z.number() }),
      execute: ({ path: p, content: c }, ctx) => run(ctx, (owner) => workspace.create(owner, p, c)),
    }),
    defineTool({
      name: "workspace_write",
      description: "Create or completely replace a text file in the user's workspace. The previous version is kept and can be restored. Prefer workspace_edit for small changes.",
      risk: "sensitive",
      inputSchema: z.strictObject({ path, content }),
      outputSchema: z.strictObject({ path: z.string(), bytes: z.number(), replaced: z.boolean() }),
      execute: ({ path: p, content: c }, ctx) => run(ctx, (owner) => workspace.write(owner, p, c)),
    }),
    defineTool({
      name: "workspace_edit",
      description:
        "Change part of a text file in the user's workspace by replacing old_text with new_text exactly. old_text must match the file (read it first) and occur once, unless replace_all is true. The previous version is kept.",
      risk: "sensitive",
      inputSchema: z.strictObject({
        path,
        old_text: z.string().min(1).describe("Exact text currently in the file"),
        new_text: z.string().describe("Replacement text"),
        replace_all: z.boolean().optional().describe("Replace every occurrence"),
      }),
      outputSchema: z.strictObject({ path: z.string(), replacements: z.number(), bytes: z.number() }),
      execute: ({ path: p, old_text, new_text, replace_all }, ctx) => run(ctx, (owner) => workspace.edit(owner, p, old_text, new_text, replace_all ?? false)),
    }),
    defineTool({
      name: "workspace_delete",
      description: "Delete a file from the user's workspace. It is moved to the trash and can be brought back with workspace_restore.",
      risk: "sensitive",
      inputSchema: z.strictObject({ path }),
      outputSchema: z.strictObject({ path: z.string(), trashed: z.string() }),
      execute: ({ path: p }, ctx) => run(ctx, (owner) => workspace.delete(owner, p)),
    }),
    defineTool({
      name: "workspace_restore",
      description: "Undo a change to a file in the user's workspace: bring back a deleted file, or the previous version (or a given version number) of an edited one.",
      risk: "sensitive",
      inputSchema: z.strictObject({ path, version: z.int().min(1).optional().describe("History version; 1 is the most recent previous version") }),
      outputSchema: z.strictObject({ path: z.string(), restoredFrom: z.enum(["history", "trash"]), bytes: z.number() }),
      execute: ({ path: p, version }, ctx) => run(ctx, (owner) => workspace.restore(owner, p, version)),
    }),
  ];
}
