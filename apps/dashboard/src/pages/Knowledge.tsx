import { useState, type FormEvent } from "react";
import { BanglaClawApiError, type KnowledgeHit } from "@entrogic-net/client";
import { errorMessage, useAsync, useAuth } from "../api";
import { fmtDateTime, fmtInt } from "../format";

/** Ingested documents and a search tester for the knowledge base (docs/07). */
export function Knowledge() {
  const { client } = useAuth();
  const docs = useAsync(
    () =>
      client.knowledge.documents().catch((err: unknown) => {
        if (err instanceof BanglaClawApiError && err.code === "knowledge_disabled") return null;
        throw err;
      }),
    [client],
  );
  const [q, setQ] = useState("");
  const [results, setResults] = useState<KnowledgeHit[] | undefined>(undefined);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  if (docs.data === null) {
    return (
      <section className="card">
        <p>The knowledge base is not enabled on this gateway.</p>
        <p className="muted small">
          Set <span className="mono">knowledge.enabled: true</span> and <span className="mono">knowledge.sources</span> in banglaclaw.yaml, then ingest with{" "}
          <span className="mono">banglaclaw kb ingest</span> (docs/07).
        </p>
      </section>
    );
  }

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim() === "") return;
    setSearching(true);
    setError(undefined);
    try {
      setResults((await client.knowledge.search(q.trim(), { limit: 10 })).results);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSearching(false);
    }
  };
  const documents = docs.data?.documents ?? [];

  return (
    <>
      <section className="card">
        <h3>Search test</h3>
        <p className="muted small">Runs the same search the agent's search_knowledge tool uses, with the configured minimum score.</p>
        <form className="toolbar" onSubmit={search}>
          <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ফেরত নীতি কী? / return policy" aria-label="Search the knowledge base" />
          <button className="button primary" type="submit" disabled={searching || q.trim() === ""}>
            {searching ? "Searching…" : "Search"}
          </button>
        </form>
        {error !== undefined && <p className="error" role="alert">{error}</p>}
        {results !== undefined &&
          (results.length === 0 ? (
            <p className="muted">No results above the minimum score.</p>
          ) : (
            <ol className="hits">
              {results.map((r) => (
                <li key={`${r.source}#${r.chunkIndex}`}>
                  <div className="hit-head">
                    <strong>{r.title}</strong>
                    <span className="muted small mono">
                      {r.source} · chunk {r.chunkIndex}
                    </span>
                    <span className="spacer" />
                    <span className="badge neutral">score {r.score.toFixed(3)}</span>
                  </div>
                  <p className="hit-text">{r.text}</p>
                </li>
              ))}
            </ol>
          ))}
      </section>
      <section className="card flush">
        <div className="card-head pad">
          <h3>Documents ({documents.length})</h3>
        </div>
        {docs.error !== undefined && <p className="error pad">{docs.error}</p>}
        {docs.data === undefined ? (
          !docs.error && <p className="muted pad">Loading…</p>
        ) : documents.length === 0 ? (
          <p className="muted pad">Nothing ingested yet. Run banglaclaw kb ingest &lt;files&gt;.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Source</th>
                <th className="num">Chunks</th>
                <th>Ingested</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.documentId}>
                  <td>{d.title}</td>
                  <td className="mono truncate" title={d.source}>
                    {d.source}
                  </td>
                  <td className="num">{fmtInt(d.chunkCount)}</td>
                  <td>{fmtDateTime(d.ingestedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
