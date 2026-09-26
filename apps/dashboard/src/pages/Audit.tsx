import { useState } from "react";
import { BanglaClawApiError, type AuditEvent } from "@entrogic-net/client";
import { useAsync, useAuth } from "../api";
import { StatusBadge } from "../components";
import { fmtDateTime } from "../format";

const ACTIONS = [
  "auth.failed",
  "auth.forbidden",
  "rate_limited",
  "key.created",
  "key.revoked",
  "tool.denied",
  "handoff.requested",
  "handoff.replied",
  "handoff.released",
  "memory.forgotten",
] as const;

/** Security audit log (docs/14); `null` when the gateway has no audit store. */
export function Audit() {
  const { client } = useAuth();
  const [action, setAction] = useState("");
  const [limit, setLimit] = useState(100);
  const { data, error, loading, reload } = useAsync(
    () =>
      client.audit.list({ limit, ...(action !== "" && { action }) }).catch((err: unknown) => {
        if (err instanceof BanglaClawApiError && err.code === "audit_disabled") return null;
        throw err;
      }),
    [client, action, limit],
  );

  if (data === null) return <p className="muted">The audit log is not configured on this gateway.</p>;
  const events = data?.events ?? [];

  return (
    <>
      <div className="toolbar">
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Number of events">
          {[100, 500, 1000].map((n) => (
            <option key={n} value={n}>
              Latest {n}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="button" type="button" onClick={reload} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {error !== undefined && <p className="error" role="alert">{error}</p>}
      <section className={`card flush${loading && data !== undefined ? " stale" : ""}`}>
        {data === undefined ? (
          !error && <p className="muted pad">Loading…</p>
        ) : events.length === 0 ? (
          <p className="muted pad">No events.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Outcome</th>
                <th>Actor</th>
                <th>Target</th>
                <th>IP</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={e.id ?? i}>
                  <td title={e.at}>{fmtDateTime(e.at)}</td>
                  <td className="mono">{e.action}</td>
                  <td>
                    <StatusBadge status={e.outcome} />
                  </td>
                  <td>{e.actorName ?? e.actorId ?? <span className="muted">—</span>}</td>
                  <td className="mono truncate" title={e.target}>
                    {e.target ?? <span className="muted">—</span>}
                  </td>
                  <td className="mono">{e.ip ?? <span className="muted">—</span>}</td>
                  <td className="mono small details" title={e.requestId === undefined ? undefined : `Request ${e.requestId}`}>
                    {details(e)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function details(e: AuditEvent): string {
  if (e.metadata === undefined) return "";
  return Object.entries(e.metadata)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
}
