import type { RunRecord, RunStats, StatsQuery } from "./run.js";

export const isControlTool = (tool: string) => tool.startsWith("transfer_to_") || tool === "request_human";

/** YYYY-MM-DD of `date` in `timezone`. */
export function dayKey(date: Date, timezone = "UTC"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Milliseconds `timezone` is ahead of UTC at `instant`. */
function zoneOffset(instant: number, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, Number(p.value)]),
  );
  return Date.UTC(parts.year ?? 0, (parts.month ?? 1) - 1, parts.day ?? 1, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0) - Math.floor(instant / 1000) * 1000;
}

/** Start (local midnight in `timezone`) of the window of `days` calendar days ending on `until`'s local day. */
export function windowStart(until: Date, days: number, timezone = "UTC"): Date {
  const [y, m, d] = dayKey(until, timezone).split("-").map(Number) as [number, number, number];
  const midnightUtc = Date.UTC(y, m - 1, d - (days - 1));
  let start = midnightUtc - zoneOffset(midnightUtc, timezone);
  start = midnightUtc - zoneOffset(start, timezone); // settle across a DST change
  return new Date(start);
}

/** Every day from `since` to `until` (inclusive) in `timezone`. */
export function dayRange(since: Date, until: Date, timezone = "UTC"): string[] {
  const days: string[] = [];
  const last = dayKey(until, timezone);
  for (let t = since.getTime(); days.length < 400; t += 86_400_000) {
    const key = dayKey(new Date(t), timezone);
    if (days.at(-1) !== key) days.push(key);
    if (key === last) break;
  }
  return days;
}

const sortDesc = <T extends Record<K, number>, K extends keyof T>(rows: T[], key: K) => rows.sort((a, b) => b[key] - a[key]);

/** Computes RunStats from records in memory (used by InMemoryRunStore and tests). */
export function computeStats(records: readonly RunRecord[], query: StatsQuery, channelOf: (sessionId: string) => string): RunStats {
  const until = query.until ?? new Date();
  const tz = query.timezone ?? "UTC";
  const runs = records.filter((r) => r.agent !== "human" && r.startedAt >= query.since && r.startedAt <= until);
  const daily = new Map(dayRange(query.since, until, tz).map((date) => [date, { date, runs: 0, errors: 0, handoffs: 0, inputTokens: 0, outputTokens: 0 }]));
  const channels = new Map<string, number>();
  const providers = new Map<string, { provider: string; runs: number; inputTokens: number; outputTokens: number }>();
  const agents = new Map<string, number>();
  const tools = new Map<string, { tool: string; calls: number; failures: number }>();
  const totals = { runs: 0, completed: 0, errors: 0, limited: 0, aborted: 0, handoffs: 0, inputTokens: 0, outputTokens: 0, avgDurationMs: 0, sessions: 0 };
  const sessions = new Set<string>();
  let duration = 0;

  for (const r of runs) {
    const input = r.usage?.inputTokens ?? 0;
    const output = r.usage?.outputTokens ?? 0;
    totals.runs++;
    if (r.status === "completed") totals.completed++;
    if (r.status === "error") totals.errors++;
    if (r.status === "limited") totals.limited++;
    if (r.status === "aborted") totals.aborted++;
    if (r.status === "handoff") totals.handoffs++;
    totals.inputTokens += input;
    totals.outputTokens += output;
    duration += r.durationMs;
    sessions.add(r.sessionId);
    const day = daily.get(dayKey(r.startedAt, tz));
    if (day !== undefined) {
      day.runs++;
      if (r.status === "error") day.errors++;
      if (r.status === "handoff") day.handoffs++;
      day.inputTokens += input;
      day.outputTokens += output;
    }
    const channel = channelOf(r.sessionId);
    channels.set(channel, (channels.get(channel) ?? 0) + 1);
    const p = providers.get(r.provider) ?? { provider: r.provider, runs: 0, inputTokens: 0, outputTokens: 0 };
    p.runs++;
    p.inputTokens += input;
    p.outputTokens += output;
    providers.set(r.provider, p);
    agents.set(r.agent, (agents.get(r.agent) ?? 0) + 1);
    for (const t of r.toolCalls) {
      if (isControlTool(t.tool)) continue;
      const entry = tools.get(t.tool) ?? { tool: t.tool, calls: 0, failures: 0 };
      entry.calls++;
      if (t.status !== "ok") entry.failures++;
      tools.set(t.tool, entry);
    }
  }
  totals.avgDurationMs = totals.runs > 0 ? Math.round(duration / totals.runs) : 0;
  totals.sessions = sessions.size;
  return {
    since: query.since.toISOString(),
    until: until.toISOString(),
    totals,
    daily: [...daily.values()],
    byChannel: sortDesc([...channels].map(([channel, n]) => ({ channel, runs: n })), "runs"),
    byProvider: sortDesc([...providers.values()], "runs"),
    byAgent: sortDesc([...agents].map(([agent, n]) => ({ agent, runs: n })), "runs"),
    topTools: sortDesc([...tools.values()], "calls").slice(0, 10),
  };
}
