import { styleText } from "node:util";
import type { RunEvent } from "@banglaclaw/shared";

const color = process.stdout.isTTY === true;
export const dim = (s: string) => (color ? styleText("dim", s) : s);
export const bold = (s: string) => (color ? styleText("bold", s) : s);
export const red = (s: string) => (color ? styleText("red", s) : s);
export const green = (s: string) => (color ? styleText("green", s) : s);
export const yellow = (s: string) => (color ? styleText("yellow", s) : s);

function short(value: unknown, max = 160): string {
  const text = JSON.stringify(value) ?? "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Streams run events to the terminal: tokens as they arrive, tool activity dimmed. */
export function createRenderer(write: (s: string) => void = (s) => process.stdout.write(s)) {
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
        if (event.tool.startsWith("transfer_to_") || event.tool === "request_human") break;
        line(dim(`⚙ ${event.tool}(${short(event.input)})`));
        break;
      case "agent_transfer":
        line(dim(`↪ ${event.to}`));
        break;
      case "handoff":
        line(yellow(event.pending ? "⏳ waiting for a human operator — the bot will not reply" : `👤 handed to a human: ${event.reason}`));
        break;
      case "tool_end": {
        if (event.audit.tool.startsWith("transfer_to_") || event.audit.tool === "request_human") break;
        const { status, output, error, durationMs } = event.audit;
        const detail = status === "ok" ? short(output) : `${status}: ${error ?? ""}`;
        line(dim(`  → ${detail} ${durationMs}ms`));
        break;
      }
      case "final":
        if (!atLineStart) out("\n");
        break;
      case "error":
        line(red(`✖ ${event.message}`));
        break;
      case "run_start":
        break;
    }
  };
}
