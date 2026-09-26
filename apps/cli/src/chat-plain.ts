import { createInterface } from "node:readline/promises";
import { AgentRunError, type AgentRuntime } from "@entrogic-net/agent";
import type { Session } from "@entrogic-net/session";
import type { RunEvent } from "@entrogic-net/shared";
import type { RuntimeBundle } from "./bootstrap.js";
import { resolveSession } from "./commands/shared.js";
import { describe } from "./ui/errors.js";
import { c, sym } from "./ui/theme.js";

function short(value: unknown, max = 160): string {
  const text = JSON.stringify(value) ?? "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const isControl = (tool: string) => tool.startsWith("transfer_to_") || tool === "request_human";

/** Streams run events as plain lines: tokens inline, tools/transfers dimmed (pipes, SSH, `agent run`). */
export function createLineRenderer(write: (s: string) => void = (s) => process.stdout.write(s)) {
  let atLineStart = true;
  const out = (s: string) => {
    if (s.length === 0) return;
    write(s);
    atLineStart = s.endsWith("\n");
  };
  const line = (s: string) => out(`${atLineStart ? "" : "\n"}${s}\n`);

  return (event: RunEvent) => {
    switch (event.type) {
      case "token":
        out(event.text);
        break;
      case "tool_start":
        if (!isControl(event.tool)) line(c.dim(`${sym.tool} ${event.tool}(${short(event.input)})`));
        break;
      case "tool_end": {
        if (isControl(event.audit.tool)) break;
        const { status, output, error, durationMs } = event.audit;
        line(c.dim(`  ${sym.arrow} ${status === "ok" ? short(output) : `${status}: ${error ?? ""}`} ${durationMs}ms`));
        break;
      }
      case "agent_transfer":
        line(c.dim(`${sym.transfer} ${event.to}`));
        break;
      case "handoff":
        line(c.yellow(event.pending ? "⏳ waiting for a human operator — the bot will not reply" : `👤 handed to a human: ${event.reason}`));
        break;
      case "final":
        if (!atLineStart) out("\n");
        break;
      case "error":
        line(c.red(`${sym.fail} ${event.message}`));
        break;
      case "run_start":
        break;
    }
  };
}

/** Line-mode REPL: the fallback when stdin/stdout aren't a TTY, or with `chat --plain`. */
export async function plainChat(bundle: RuntimeBundle, initial: { session: Session; created: boolean }): Promise<Session> {
  const { runtime, services, mcp } = bundle;
  let session = initial.session;
  const render = createLineRenderer();
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
  let active: AbortController | undefined;
  rl.on("SIGINT", () => (active !== undefined ? active.abort() : rl.close()));
  const prompt = () => process.stdout.write(c.green("› "));

  const model = services.loaded.config.models.default;
  process.stdout.write(`${c.bold(`${sym.paw} BanglaClaw`)}${c.dim(` — ${model.provider}:${model.model} · ${services.persistent ? "postgres" : "memory"} storage`)}\n`);
  if (mcp.tools().length > 0) process.stdout.write(c.dim(`MCP: ${mcp.tools().length} tools\n`));
  if (!initial.created) process.stdout.write(c.dim(`Resumed session ${session.id} (${await runtime.sessions.countMessages(session.id)} messages)\n`));
  process.stdout.write(c.dim("Type in Bangla, Banglish or English. /help lists commands.\n\n"));

  // The async iterator buffers lines that arrive while a reply is running (pipes) and ends on EOF.
  prompt();
  try {
    for await (const line of rl) {
      const input = line.trim();
      if (input === "/exit" || input === "/quit") break;
      if (input === "") {
        prompt();
        continue;
      }
      if (!process.stdin.isTTY) process.stdout.write(`${input}\n`);
      if (input === "/help") {
        process.stdout.write(c.dim("/new       start a new session\n/history   show recent messages\n/session   show the session id\n/exit      quit (Ctrl+C cancels a running reply)\n"));
      } else if (input === "/session") {
        process.stdout.write(`${c.dim(session.id)}\n`);
      } else if (input === "/history") {
        for (const m of await runtime.sessions.recentMessages(session.id, 20)) {
          if (m.getType() === "human") process.stdout.write(`${c.green("you")}   ${m.text}\n`);
          else if (m.getType() === "ai" && m.text.length > 0) process.stdout.write(`${c.bold("agent")} ${m.text}\n`);
        }
      } else if (input === "/new" || input === "/reset") {
        ({ session } = await resolveSession(runtime as AgentRuntime, services));
        process.stdout.write(c.dim(`New session ${session.id}\n`));
      } else {
        active = new AbortController();
        try {
          await runtime.run(input, { sessionId: session.id, onEvent: render, signal: active.signal });
        } catch (error) {
          // The renderer already printed run errors; anything else is unexpected.
          if (!(error instanceof AgentRunError)) process.stderr.write(`${c.red(`${sym.fail} ${describe(error)}`)}\n`);
        } finally {
          active = undefined;
        }
        process.stdout.write("\n");
      }
      prompt();
    }
  } finally {
    rl.close();
  }
  return session;
}
