import { BanglaClawError, type ToolAuditEvent } from "@entrogic-net/shared";
import type { RunRecord } from "@entrogic-net/session";
import type { GlobalOptions } from "../bootstrap.js";
import { emit, empty, print } from "../ui/output.js";
import { table } from "../ui/table.js";
import { c, statusCell, statusWord, sym } from "../ui/theme.js";
import { limit, memoryNotice, messageView, withServices } from "./shared.js";

export async function sessionList(options: GlobalOptions & { limit: string }): Promise<void> {
  await withServices(options, async (services) => {
    memoryNotice(services);
    const sessions = await services.sessions.list({ limit: limit(options.limit) });
    const rows = await Promise.all(sessions.map(async (s) => ({ ...s, messages: await services.sessions.countMessages(s.id) })));
    emit(rows, (list) => {
      if (list.length === 0) return empty("No sessions.");
      print(
        table(list, [
          { header: "SESSION", value: (s) => s.id, color: (t) => c.bold(t) },
          { header: "CHANNEL", value: (s) => s.channel },
          { header: "STATUS", value: (s) => s.status, color: statusCell },
          { header: "AGENT", value: (s) => s.activeAgent ?? "-" },
          { header: "MSGS", value: (s) => String(s.messages), align: "right" },
          { header: "UPDATED", value: (s) => s.updatedAt.toISOString(), color: (t) => c.dim(t) },
        ]),
      );
    });
  });
}

export async function sessionShow(id: string, options: GlobalOptions & { limit: string }): Promise<void> {
  await withServices(options, async (services) => {
    const session = await services.sessions.get(id);
    if (session === undefined) throw new BanglaClawError("SESSION_NOT_FOUND", `Session not found: ${id}`);
    const messages = (await services.sessions.recentMessages(id, limit(options.limit))).map(messageView);
    const runs = await services.runs.listBySession(id, { limit: 10 });
    emit({ session, messages, runs }, () => {
      print(`${c.bold(session.id)} ${c.dim(`${session.channel} · ${session.status} · agent ${session.activeAgent ?? "supervisor"} · created ${session.createdAt.toISOString()}`)}`);
      print();
      for (const m of messages) printMessage(m);
      if (runs.length > 0) {
        print();
        print(c.dim("Recent runs"));
        print(runTable(runs));
      }
    });
  });
}

export function printMessage(m: ReturnType<typeof messageView>): void {
  const label = { user: c.green("user    "), assistant: c.bold("agent   "), operator: c.yellow("operator"), tool: c.dim("  tool  "), system: c.dim("system  ") }[m.role];
  if (m.role === "tool") return print(c.dim(`          ${sym.arrow} ${m.content.slice(0, 200)}`));
  if (m.content.length > 0) print(`${label} ${m.content}`);
  for (const call of m.toolCalls ?? []) print(c.dim(`          ${sym.tool} ${call.name}(${JSON.stringify(call.args)})`));
}

export function runTable(runs: readonly RunRecord[]): string {
  return table(runs, [
    { header: "RUN", value: (r) => r.id },
    { header: "STATUS", value: (r) => r.status, color: statusCell },
    { header: "AGENT", value: (r) => r.agentPath.join(`${sym.transfer}`) },
    { header: "LANG", value: (r) => r.language },
    { header: "TOOLS", value: (r) => String(r.toolCalls.length), align: "right" },
    { header: "TOKENS", value: (r) => (r.usage !== undefined ? `${r.usage.inputTokens}/${r.usage.outputTokens}` : "-"), align: "right" },
    { header: "TIME", value: (r) => `${(r.durationMs / 1000).toFixed(1)}s`, align: "right" },
    { header: "STARTED", value: (r) => r.startedAt.toISOString(), color: (t) => c.dim(t) },
  ]);
}

export async function runList(options: GlobalOptions & { session: string; limit: string }): Promise<void> {
  await withServices(options, async (services) => {
    memoryNotice(services);
    const runs = await services.runs.listBySession(options.session, { limit: limit(options.limit) });
    emit(runs, (list) => (list.length === 0 ? empty("No runs.") : print(runTable(list))));
  });
}

function toolLine(t: ToolAuditEvent): string {
  const detail = t.status === "ok" ? JSON.stringify(t.output) : `${t.status}: ${t.error ?? ""}`;
  return `${sym.tool} ${t.tool}(${JSON.stringify(t.input)}) ${sym.arrow} ${detail} ${c.dim(`${t.durationMs}ms`)}`;
}

export async function runShow(id: string, options: GlobalOptions): Promise<void> {
  await withServices(options, async (services) => {
    const r = await services.runs.get(id);
    if (r === undefined) throw new BanglaClawError("RUN_NOT_FOUND", `Run not found: ${id}`);
    const tuple = await services.checkpointer?.getTuple({ configurable: { thread_id: r.id } });
    emit({ ...r, checkpointId: tuple?.checkpoint.id ?? null }, () => {
      print(`${c.bold(r.id)}  ${statusWord(r.status)}${r.stopReason !== undefined && r.stopReason !== r.status ? c.dim(` (${r.stopReason})`) : ""}`);
      const meta = [
        `session ${r.sessionId}`,
        r.provider,
        `agents ${r.agentPath.join(sym.transfer)}`,
        `${r.iterations} model calls`,
        r.usage !== undefined ? `${r.usage.inputTokens}→${r.usage.outputTokens} tokens` : undefined,
        `${(r.durationMs / 1000).toFixed(2)}s`,
        `prompt ${r.promptVersion}`,
      ].filter(Boolean);
      print(c.dim(meta.join(" · ")));
      print();
      print(`${c.green("input ")} ${r.input}`);
      if (r.output !== undefined) print(`${c.bold("output")} ${r.output}`);
      if (r.error !== undefined) print(c.red(`error  ${r.error}`));
      if (r.handoffReason !== undefined) print(c.yellow(`handoff ${r.handoffReason}`));
      if (r.toolCalls.length > 0) print();
      for (const t of r.toolCalls) print(toolLine(t));
      if (tuple !== undefined) print(c.dim(`\ncheckpoint ${tuple.checkpoint.id}`));
    });
  });
}
