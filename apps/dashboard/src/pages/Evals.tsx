import { useState } from "react";
import { BanglaClawApiError, type EvalCase, type EvalRun } from "@entrogic-net/client";
import { errorMessage, useAsync, useAuth } from "../api";
import { ColumnChart } from "../charts/ColumnChart";
import { StatTile } from "../charts/StatTile";
import { fmtDateTime, fmtInt, fmtPct, fmtRelative } from "../format";
import { Link, navigate } from "../router";

const fmtScore = (n: number | undefined) => (n === undefined ? "—" : n.toFixed(2));

/** Passed / failed with an icon, so color never carries the meaning alone. */
function ResultBadge({ passed, total }: { passed: number; total: number }) {
  const tone = total > 0 && passed === total ? "good" : passed === 0 ? "critical" : "warning";
  const icon = tone === "good" ? "✓" : tone === "critical" ? "✕" : "!";
  return (
    <span className={`badge ${tone}`}>
      <span aria-hidden="true">{icon}</span> {total === 1 ? (passed === 1 ? "Passed" : "Failed") : `${fmtInt(passed)}/${fmtInt(total)} passed`}
    </span>
  );
}

/** Evaluation runs recorded by the DeepEval harness (docs/26): a list, or one run's cases. */
export function Evals({ id }: { id?: string }) {
  return id === undefined ? <EvalList /> : <EvalDetail key={id} id={id} />;
}

function EvalList() {
  const { client } = useAuth();
  const [name, setName] = useState("");
  const { data, error, loading, reload } = useAsync(
    () =>
      client.admin.evals({ limit: 200 }).catch((err: unknown) => {
        if (err instanceof BanglaClawApiError && err.code === "evals_disabled") return null;
        throw err;
      }),
    [client],
  );

  if (data === null) return <p className="muted">Eval results are not stored on this gateway.</p>;
  const all = data?.evals ?? [];
  const names = [...new Set(all.map((r) => r.name))].sort();
  const runs = name === "" ? all : all.filter((r) => r.name === name);
  const trend = [...runs].reverse().slice(-30);

  return (
    <>
      <div className="toolbar">
        <select value={name} onChange={(e) => setName(e.target.value)} aria-label="Eval name">
          <option value="">All evals</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="button" type="button" onClick={reload} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {error !== undefined && <p className="error" role="alert">{error}</p>}
      {trend.length > 1 && (
        <section className="card">
          <ColumnChart
            title={name === "" ? "Cases per eval run" : `Cases per run of ${name}`}
            labelHeader="Run"
            series={[
              { name: "Passed", color: "var(--series-1)" },
              { name: "Failed", color: "var(--critical)" },
            ]}
            columns={trend.map((r) => ({
              label: fmtDateTime(r.createdAt),
              values: [r.passedCount, r.caseCount - r.passedCount],
              extra: [
                { name: "Pass rate", value: fmtPct(r.passedCount, r.caseCount) },
                { name: "Eval", value: r.name },
              ],
            }))}
          />
        </section>
      )}
      <section className={`card flush${loading && data !== undefined ? " stale" : ""}`}>
        {data === undefined ? (
          !error && <p className="muted pad">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="muted pad">
            No eval runs yet. Run the DeepEval harness in <span className="mono">evals/deepeval</span> with an admin key to record one (docs/26).
          </p>
        ) : (
          <div className="scroll-x">
            <table className="table clickable">
              <thead>
                <tr>
                  <th>Recorded</th>
                  <th>Eval</th>
                  <th>Dataset</th>
                  <th className="num">Cases</th>
                  <th>Result</th>
                  <th>Metrics (mean score)</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} onClick={() => navigate(`/evals/${r.id}`)}>
                    <td title={r.createdAt}>
                      <Link to={`/evals/${r.id}`}>{fmtRelative(r.createdAt)}</Link>
                    </td>
                    <td>{r.name}</td>
                    <td className="mono truncate" title={r.dataset}>
                      {r.dataset ?? <span className="muted">—</span>}
                    </td>
                    <td className="num">{fmtInt(r.caseCount)}</td>
                    <td>
                      <ResultBadge passed={r.passedCount} total={r.caseCount} />
                    </td>
                    <td>
                      <MetricChips run={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function MetricChips({ run }: { run: EvalRun }) {
  return (
    <ul className="chips flat">
      {run.metrics.map((m) => (
        <li key={m.name} title={`${m.passed} of ${m.total} passed`}>
          {m.name} {fmtScore(m.avgScore)}
        </li>
      ))}
    </ul>
  );
}

function EvalDetail({ id }: { id: string }) {
  const { client } = useAuth();
  const { data, error } = useAsync(() => client.admin.eval(id), [client, id]);
  const [failedOnly, setFailedOnly] = useState(false);

  return (
    <>
      <p className="crumbs">
        <Link to="/evals">← Evals</Link>
      </p>
      {error !== undefined && <p className="error" role="alert">{error}</p>}
      {data === undefined ? (
        !error && <p className="muted">Loading…</p>
      ) : (
        <>
          <section className="card meta">
            <div className="card-head">
              <h2>{data.eval.name}</h2>
              <DeleteButton onDelete={() => client.admin.deleteEval(id).then(() => navigate("/evals"))} />
            </div>
            <dl>
              <dt>Recorded</dt>
              <dd>{fmtDateTime(data.eval.createdAt)}</dd>
              {data.eval.dataset !== undefined && (
                <>
                  <dt>Dataset</dt>
                  <dd className="mono">{data.eval.dataset}</dd>
                </>
              )}
              <dt>Framework</dt>
              <dd>
                {data.eval.framework}
                {data.eval.frameworkVersion !== undefined && ` ${data.eval.frameworkVersion}`}
              </dd>
              {data.eval.judgeModel !== undefined && (
                <>
                  <dt>Judge model</dt>
                  <dd className="mono">{data.eval.judgeModel}</dd>
                </>
              )}
              {data.eval.agentModel !== undefined && (
                <>
                  <dt>Agent model</dt>
                  <dd className="mono">{data.eval.agentModel}</dd>
                </>
              )}
              {data.eval.metadata !== undefined && Object.keys(data.eval.metadata).length > 0 && (
                <>
                  <dt>Labels</dt>
                  <dd className="mono small">
                    {Object.entries(data.eval.metadata)
                      .map(([k, v]) => `${k}=${String(v)}`)
                      .join(" ")}
                  </dd>
                </>
              )}
              <dt>Id</dt>
              <dd className="mono small">{data.eval.id}</dd>
            </dl>
          </section>
          <div className="stats">
            <StatTile label="Pass rate" value={fmtPct(data.eval.passedCount, data.eval.caseCount)} sub={`${fmtInt(data.eval.passedCount)} of ${fmtInt(data.eval.caseCount)} cases`} />
            {data.eval.metrics.map((m) => (
              <StatTile key={m.name} label={m.name} value={fmtScore(m.avgScore)} sub={`mean score · ${fmtInt(m.passed)}/${fmtInt(m.total)} passed`} />
            ))}
          </div>
          <section className="card eval-cases">
            <div className="card-head">
              <h3>Cases</h3>
              <label className="check">
                <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> Failed only
              </label>
            </div>
            {data.cases.map((c, i) => (failedOnly && c.success ? null : <CaseItem key={i} item={c} />))}
            {failedOnly && data.cases.every((c) => c.success) && <p className="muted">Every case passed.</p>}
          </section>
        </>
      )}
    </>
  );
}

function CaseItem({ item }: { item: EvalCase }) {
  const passed = item.metrics.filter((m) => m.success).length;
  return (
    <details className="run eval-case">
      <summary>
        <ResultBadge passed={item.success ? 1 : 0} total={1} />
        <span className="case-title">{item.name ?? item.input}</span>
        <span className="muted small">
          {fmtInt(passed)}/{fmtInt(item.metrics.length)} metrics
        </span>
      </summary>
      <dl>
        <dt>Input</dt>
        <dd className="prewrap">{item.input}</dd>
        {item.expectedOutput !== undefined && (
          <>
            <dt>Expected</dt>
            <dd className="prewrap">{item.expectedOutput}</dd>
          </>
        )}
        <dt>Answer</dt>
        <dd className="prewrap">{item.actualOutput ?? <span className="muted">—</span>}</dd>
        {item.language !== undefined && (
          <>
            <dt>Language</dt>
            <dd>{item.language}</dd>
          </>
        )}
        {(item.toolsCalled !== undefined || item.expectedTools !== undefined) && (
          <>
            <dt>Tools</dt>
            <dd className="mono small">
              {(item.toolsCalled ?? []).join(", ") || "none"}
              {item.expectedTools !== undefined && <span className="muted"> (expected {item.expectedTools.join(", ") || "none"})</span>}
            </dd>
          </>
        )}
        {item.sessionId !== undefined && (
          <>
            <dt>Session</dt>
            <dd>
              <Link to={`/sessions/${item.sessionId}`}>Open the conversation →</Link>
            </dd>
          </>
        )}
      </dl>
      <div className="scroll-x">
        <table className="table compact">
          <thead>
            <tr>
              <th>Metric</th>
              <th className="num">Score</th>
              <th className="num">Threshold</th>
              <th>Result</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {item.metrics.map((m) => (
              <tr key={m.name}>
                <td>{m.name}</td>
                <td className="num">{fmtScore(m.score)}</td>
                <td className="num">{fmtScore(m.threshold)}</td>
                <td>{m.success ? "passed" : <span className="error-text">failed</span>}</td>
                <td className="details">{m.error !== undefined ? <span className="error-text">{m.error}</span> : (m.reason ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function DeleteButton({ onDelete }: { onDelete: () => Promise<unknown> }) {
  const [state, setState] = useState<"idle" | "confirm" | "busy">("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  if (state === "idle") {
    return (
      <button className="button ghost danger" type="button" onClick={() => setState("confirm")}>
        Delete
      </button>
    );
  }
  return (
    <span className="confirm">
      {error !== undefined && <span className="error-text small">{error} </span>}
      <button
        className="button danger"
        type="button"
        disabled={state === "busy"}
        onClick={() => {
          setState("busy");
          onDelete().catch((err: unknown) => {
            setError(errorMessage(err));
            setState("confirm");
          });
        }}
      >
        {state === "busy" ? "Deleting…" : "Confirm delete"}
      </button>
      <button className="button ghost" type="button" onClick={() => setState("idle")}>
        Cancel
      </button>
    </span>
  );
}
