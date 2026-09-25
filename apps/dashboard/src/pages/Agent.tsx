import { useState } from "react";
import { useAsync, useAuth } from "../api";

const RISK_TONE: Record<string, string> = { safe: "good", sensitive: "warning", destructive: "critical" };

/** What the agent can use: model, tools (with allowlist result) and skills. Read-only; change banglaclaw.yaml. */
export function Agent() {
  const { client } = useAuth();
  const { data, error } = useAsync(() => Promise.all([client.agents(), client.tools(), client.skills(), client.health()]), [client]);
  const [allowedOnly, setAllowedOnly] = useState(false);

  if (error !== undefined) return <p className="error" role="alert">{error}</p>;
  if (data === undefined) return <p className="muted">Loading…</p>;
  const [{ agents }, { tools }, { skills }, health] = data;
  const agent = agents[0];
  const sorted = [...tools].sort((a, b) => Number(b.allowed) - Number(a.allowed) || a.name.localeCompare(b.name));
  const shown = allowedOnly ? sorted.filter((t) => t.allowed) : sorted;
  const allowedCount = tools.filter((t) => t.allowed).length;

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="stat-label">Agent</div>
          <div className="stat-value small-value">{agent?.id ?? "—"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Model</div>
          <div className="stat-value small-value mono">{agent?.model ?? "—"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Tools allowed</div>
          <div className="stat-value">
            {allowedCount} <span className="muted small">of {tools.length}</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Gateway version</div>
          <div className="stat-value small-value">{health.version}</div>
        </div>
      </div>
      <p className="muted small">This page is read-only. Tools, skills and the model are set in banglaclaw.yaml (tools.allow, skills.dirs, models) and take effect after a restart.</p>

      <section className="card flush">
        <div className="card-head pad">
          <h3>Tools</h3>
          <label className="check">
            <input type="checkbox" checked={allowedOnly} onChange={(e) => setAllowedOnly(e.target.checked)} /> Allowed only
          </label>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Risk</th>
              <th>Allowed</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.name} className={t.allowed ? undefined : "revoked"}>
                <td className="mono">{t.name}</td>
                <td>
                  <span className={`badge ${RISK_TONE[t.risk] ?? "neutral"}`}>{t.risk}</span>
                </td>
                <td>{t.allowed ? "✓ Allowed" : "✕ Denied"}</td>
                <td className="description">{t.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Skills ({skills.length})</h3>
        {skills.length === 0 ? (
          <p className="muted">No skills loaded.</p>
        ) : (
          <div className="skill-grid">
            {skills.map((s) => (
              <article key={s.name} className="skill">
                <div className="skill-head">
                  <strong>{s.name}</strong>
                  <span className="muted small">v{s.version}</span>
                </div>
                <p>{s.description}</p>
                {s.tools.length > 0 && (
                  <p className="small">
                    <span className="muted">Tools: </span>
                    <span className="mono">{s.tools.join(", ")}</span>
                  </p>
                )}
                {s.triggers.length > 0 && (
                  <ul className="chips" aria-label="Triggers">
                    {s.triggers.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
