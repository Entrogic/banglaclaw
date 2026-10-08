import { setTimeout as sleep } from "node:timers/promises";
import type { Client } from "@a2a-js/sdk/client";
import type { Message, Task } from "@a2a-js/sdk";
import { z } from "zod";
import { ToolExecutionError } from "@entrogic-net/shared";
import { defineTool, type AnyTool } from "@entrogic-net/tools";
import { DEFAULT_MAX_OUTPUT_CHARS, WAITING_STATES, isTask, replyOf, toolNameFor, truncate, userMessage } from "./convert.js";
import { Conversations } from "./conversations.js";

export const A2aToolInputSchema = z.strictObject({
  message: z.string().trim().min(1).max(20_000).describe("The message for the remote agent, in any language"),
});

export const A2aToolOutputSchema = z.strictObject({
  agent: z.string(),
  reply: z.string(),
  /** The remote status message, when the reply came as an artifact. */
  note: z.string().optional(),
  truncated: z.boolean(),
});
export type A2aToolOutput = z.infer<typeof A2aToolOutputSchema>;

export interface A2aToolOptions {
  agent: string;
  description: string;
  client: Client;
  timeoutMs: number;
  conversations: Conversations;
  maxOutputChars?: number;
  /** Delay between GetTask polls when the agent answers before the task is done. */
  pollIntervalMs?: number;
}

/**
 * One configured remote agent as a BanglaClawTool (docs/25). Each BanglaClaw session gets its own
 * remote conversation (the `contextId` the agent returned), so follow-ups keep their context.
 */
export function a2aAgentTool(options: A2aToolOptions): AnyTool {
  const { agent, client, conversations } = options;
  const poll = options.pollIntervalMs ?? 1_000;

  return defineTool({
    name: toolNameFor(agent),
    description: options.description,
    // Messages leave this process for another service.
    risk: "sensitive",
    timeoutMs: options.timeoutMs,
    inputSchema: A2aToolInputSchema,
    outputSchema: A2aToolOutputSchema,
    async execute(input, ctx): Promise<A2aToolOutput> {
      const { signal } = ctx;
      let result: Message | Task = await client.sendMessage(
        { tenant: "", message: userMessage(input.message, conversations.get(ctx.sessionId)), configuration: undefined, metadata: undefined },
        { signal },
      );
      // Blocking sends normally end in a final or interrupted state; poll servers that answer earlier.
      while (isTask(result) && WAITING_STATES.has(result.status?.state ?? 0)) {
        try {
          await sleep(poll, undefined, { signal });
          result = await client.getTask({ tenant: "", id: result.id, historyLength: 0 }, { signal });
        } catch (error) {
          if (signal.aborted) await client.cancelTask({ tenant: "", id: result.id, metadata: undefined }).catch(() => {});
          throw error;
        }
      }

      if (result.contextId !== "") conversations.set(ctx.sessionId, result.contextId);
      const outcome = replyOf(result);
      if ("error" in outcome) throw new ToolExecutionError(`A2A agent ${agent}: ${outcome.error.slice(0, 500)}`);

      const { text, truncated } = truncate(outcome.reply, options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS);
      return { agent, reply: text, ...(outcome.note !== undefined && { note: outcome.note.slice(0, 2_000) }), truncated };
    },
  });
}
