import { useEffect, useState } from "react";
import { useAsync, useAuth } from "../api";
import { StatusBadge } from "../components";
import { fmtInt, fmtRelative, shortId } from "../format";
import { Link, navigate } from "../router";

const PAGE = 50;
/** Built-in channels; others (plugins) appear once a listed session uses them. */
const KNOWN_CHANNELS = ["api", "telegram", "whatsapp", "cli"];

export function Sessions() {
  const { client } = useAuth();
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "active" | "handoff">("");
  const [channel, setChannel] = useState("");
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);
  useEffect(() => setLimit(PAGE), [q, status, channel]);

  const { data, error, loading } = useAsync(
    () =>
      client.admin.sessions({
        limit,
        ...(q !== "" && { q }),
        ...(status !== "" && { status }),
        ...(channel !== "" && { channel }),
      }),
    [client, q, status, channel, limit],
  );
  const sessions = data?.sessions ?? [];
  const channels = [...new Set([...KNOWN_CHANNELS, ...sessions.map((s) => s.channel), ...(channel === "" ? [] : [channel])])];

  return (
    <>
      <div className="toolbar">
        <input className="search" type="search" placeholder="Search by session id or external id" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Search sessions" />
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="handoff">Waiting for a human</option>
        </select>
        <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
          <option value="">All channels</option>
          {channels.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {error !== undefined && <p className="error" role="alert">{error}</p>}
      <section className={`card flush${loading && data !== undefined ? " stale" : ""}`}>
        {data === undefined ? (
          !error && <p className="muted pad">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="muted pad">No sessions match.</p>
        ) : (
          <table className="table clickable">
            <thead>
              <tr>
                <th>Session</th>
                <th>Channel</th>
                <th>External id</th>
                <th>User</th>
                <th>Status</th>
                <th className="num">Messages</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} onClick={() => navigate(`/sessions/${s.id}`)}>
                  <td className="mono">
                    <Link to={`/sessions/${s.id}`} title={s.id}>
                      {shortId(s.id)}
                    </Link>
                  </td>
                  <td>{s.channel}</td>
                  <td className="mono truncate" title={s.externalId}>
                    {s.externalId ?? <span className="muted">—</span>}
                  </td>
                  <td>{s.userName ?? <span className="muted">—</span>}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="num">{fmtInt(s.messageCount)}</td>
                  <td title={s.updatedAt}>{fmtRelative(s.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {sessions.length >= limit && (
        <div className="center">
          <button className="button" type="button" disabled={loading || limit >= 200} onClick={() => setLimit((l) => Math.min(200, l + PAGE))}>
            {limit >= 200 ? "Showing the first 200 — refine the search" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
