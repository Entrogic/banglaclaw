import { useState } from "react";
import { useAsync, useAuth } from "../api";
import { BarList } from "../charts/BarList";
import { ColumnChart } from "../charts/ColumnChart";
import { StatTile } from "../charts/StatTile";
import { fmtDay, fmtDuration, fmtInt, fmtNum, fmtPct, fmtUsd } from "../format";

const RANGES = [7, 30, 90] as const;

export function Overview() {
  const { client } = useAuth();
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const { data, error, loading, reload } = useAsync(() => client.admin.stats({ days }), [client, days]);

  return (
    <>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Time range">
          {RANGES.map((d) => (
            <button key={d} type="button" aria-pressed={d === days} onClick={() => setDays(d)}>
              Last {d} days
            </button>
          ))}
        </div>
        <span className="spacer" />
        {data !== undefined && <span className="muted small">Days in {data.timezone}</span>}
        <button className="button" type="button" onClick={reload} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {error !== undefined && <p className="error" role="alert">{error}</p>}
      {data === undefined ? (
        !error && <p className="muted">Loading…</p>
      ) : (
        <div className={loading ? "stale" : undefined}>
          <div className="stats">
            <StatTile label="Runs" value={fmtNum(data.totals.runs)} sub={`${fmtNum(data.totals.sessions)} sessions`} />
            <StatTile label="Error rate" value={fmtPct(data.totals.errors, data.totals.runs)} sub={`${fmtInt(data.totals.errors)} errors · ${fmtInt(data.totals.limited)} limited`} />
            <StatTile label="Handoffs" value={fmtNum(data.totals.handoffs)} sub={fmtPct(data.totals.handoffs, data.totals.runs) + " of runs"} />
            <StatTile label="Tokens" value={fmtNum(data.totals.inputTokens + data.totals.outputTokens)} sub={`${fmtNum(data.totals.inputTokens)} in · ${fmtNum(data.totals.outputTokens)} out`} />
            <StatTile label="Avg duration" value={data.totals.runs === 0 ? "—" : fmtDuration(data.totals.avgDurationMs)} />
            <StatTile
              label="Estimated cost"
              value={data.totalCostUsd === undefined ? "—" : fmtUsd(data.totalCostUsd)}
              {...(data.totalCostUsd === undefined && { sub: "Set pricing in banglaclaw.yaml" })}
            />
          </div>
          {data.totals.runs === 0 && <p className="muted empty">No agent runs in this period.</p>}
          <div className="grid-2">
            <section className="card">
              <ColumnChart
                title="Runs per day"
                series={[
                  { name: "Runs without error", color: "var(--series-1)" },
                  { name: "Errors", color: "var(--critical)" },
                ]}
                columns={data.daily.map((d) => ({
                  label: fmtDay(d.date),
                  values: [d.runs - d.errors, d.errors],
                  extra: [{ name: "Handoffs", value: fmtInt(d.handoffs) }],
                }))}
              />
            </section>
            <section className="card">
              <ColumnChart
                title="Tokens per day"
                format={fmtNum}
                series={[
                  { name: "Input", color: "var(--series-1)" },
                  { name: "Output", color: "var(--series-2)" },
                ]}
                columns={data.daily.map((d) => ({ label: fmtDay(d.date), values: [d.inputTokens, d.outputTokens] }))}
              />
            </section>
          </div>
          <div className="grid-3">
            <BarList title="Runs by channel" items={data.byChannel.map((c) => ({ label: c.channel, value: c.runs }))} />
            <BarList
              title="Runs by model"
              items={data.byProvider.map((p) => {
                // Provider ids are "<provider>:<model>"; lead with the model.
                const split = p.provider.indexOf(":");
                return {
                  id: p.provider,
                  label: split === -1 ? p.provider : p.provider.slice(split + 1),
                  value: p.runs,
                  detail: [split === -1 ? undefined : p.provider.slice(0, split), `${fmtNum(p.inputTokens + p.outputTokens)} tokens`, p.costUsd === undefined ? undefined : fmtUsd(p.costUsd)].filter(Boolean).join(" · "),
                };
              })}
            />
            <BarList title="Runs by agent" items={data.byAgent.map((a) => ({ label: a.agent, value: a.runs }))} />
          </div>
          <section className="card">
            <h3>Top tools</h3>
            {data.topTools.length === 0 ? (
              <p className="muted">No tool calls in this period.</p>
            ) : (
              <div className="scroll-x">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th className="num">Calls</th>
                      <th className="num">Failures</th>
                      <th className="num">Failure rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topTools.map((t) => (
                      <tr key={t.tool}>
                        <td className="mono">{t.tool}</td>
                        <td className="num">{fmtInt(t.calls)}</td>
                        <td className="num">{fmtInt(t.failures)}</td>
                        <td className="num">{fmtPct(t.failures, t.calls)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
