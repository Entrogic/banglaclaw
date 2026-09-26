import type { Run } from "@entrogic-net/client";
import { useAsync, useAuth } from "../api";
import { fmtDateTime, fmtDuration, fmtInt } from "../format";
import { Link } from "../router";
import { StatusBadge, Transcript } from "../components";

export function SessionDetail({ id }: { id: string }) {
  const { client } = useAuth();
  const { data, error } = useAsync(() => client.admin.session(id, { limit: 200 }), [client, id]);

  return (
    <>
      <p className="crumbs">
        <Link to="/sessions">← Sessions</Link>
      </p>
      {error !== undefined && <p className="error" role="alert">{error}</p>}
      {data === undefined ? (
        !error && <p className="muted">Loading…</p>
      ) : (
        <>
          <section className="card meta">
            <h2 className="mono">{data.session.id}</h2>
            <dl>
              {data.session.title !== undefined && (
                <>
                  <dt>Conversation</dt>
                  <dd>{data.session.title}</dd>
                </>
              )}
              <dt>Status</dt>
              <dd>
                <StatusBadge status={data.session.status} />
                {data.session.handoffReason !== undefined && <span className="muted"> — {data.session.handoffReason}</span>}
                {data.session.status === "handoff" && (
                  <>
                    {" "}
                    <Link to={`/handoffs/${data.session.id}`}>Reply as operator →</Link>
                  </>
                )}
              </dd>
              <dt>Channel</dt>
              <dd>{data.session.channel}</dd>
              {data.session.externalId !== undefined && (
                <>
                  <dt>External id</dt>
                  <dd className="mono">{data.session.externalId}</dd>
                </>
              )}
              <dt>Agent</dt>
              <dd>{data.session.activeAgent ?? data.session.agentId}</dd>
              <dt>Created</dt>
              <dd>{fmtDateTime(data.session.createdAt)}</dd>
              <dt>Updated</dt>
              <dd>{fmtDateTime(data.session.updatedAt)}</dd>
            </dl>
          </section>
          <div className="grid-detail">
            <section className="card">
              <h3>Conversation</h3>
              {data.messages.length === 0 ? <p className="muted">No messages.</p> : <Transcript messages={data.messages} />}
            </section>
            <section className="card">
              <h3>Runs</h3>
              {data.runs.length === 0 ? <p className="muted">No runs.</p> : data.runs.map((r) => <RunItem key={r.id} run={r} />)}
            </section>
          </div>
        </>
      )}
    </>
  );
}

function RunItem({ run }: { run: Run }) {
  return (
    <details className="run">
      <summary>
        <StatusBadge status={run.status} kind="run" />
        <span className="muted small">
          {fmtDateTime(run.startedAt)} · {fmtDuration(run.durationMs)}
          {run.usage !== undefined && ` · ${fmtInt(run.usage.inputTokens + run.usage.outputTokens)} tokens`}
        </span>
      </summary>
      <dl>
        <dt>Agent</dt>
        <dd>{run.agentPath.length > 1 ? run.agentPath.join(" → ") : run.agent}</dd>
        <dt>Model</dt>
        <dd className="mono">{run.provider}</dd>
        <dt>Language</dt>
        <dd>{run.language}</dd>
        {run.skills.length > 0 && (
          <>
            <dt>Skills</dt>
            <dd>{run.skills.join(", ")}</dd>
          </>
        )}
        {run.stopReason !== undefined && (
          <>
            <dt>Stop reason</dt>
            <dd>{run.stopReason}</dd>
          </>
        )}
        {run.error !== undefined && (
          <>
            <dt>Error</dt>
            <dd className="error-text">{run.error}</dd>
          </>
        )}
      </dl>
      {run.toolCalls.length > 0 && (
        <table className="table compact">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Status</th>
              <th className="num">Duration</th>
            </tr>
          </thead>
          <tbody>
            {run.toolCalls.map((t) => (
              <tr key={t.id} title={t.error}>
                <td className="mono">{t.tool}</td>
                <td>{t.status === "ok" ? "ok" : <span className="error-text">{t.status}</span>}</td>
                <td className="num">{fmtDuration(t.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}
