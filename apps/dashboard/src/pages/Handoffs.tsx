import { useState, type FormEvent, type KeyboardEvent } from "react";
import { errorMessage, useAsync, useAuth } from "../api";
import { Transcript, useInterval } from "../components";
import { fmtRelative, shortId } from "../format";
import { Link, navigate } from "../router";

/** Operator queue: sessions waiting for a human, with reply and release (docs/04). */
export function Handoffs({ id }: { id?: string }) {
  const { client } = useAuth();
  const queue = useAsync(() => client.handoffs.list({ limit: 200 }), [client]);
  useInterval(queue.reload, 15_000);
  const handoffs = queue.data?.handoffs ?? [];

  return (
    <div className="grid-handoffs">
      <section className="card flush queue">
        <div className="card-head pad">
          <h3>Waiting ({handoffs.length})</h3>
          <button className="button ghost" type="button" onClick={queue.reload} disabled={queue.loading}>
            Refresh
          </button>
        </div>
        {queue.error !== undefined && <p className="error pad">{queue.error}</p>}
        {queue.data !== undefined && handoffs.length === 0 && <p className="muted pad">Nobody is waiting. Sessions appear here when the agent calls request_human.</p>}
        <ul className="queue-list">
          {handoffs.map((h) => (
            <li key={h.id} className={h.id === id ? "active" : undefined}>
              <Link to={`/handoffs/${h.id}`}>
                <span className="queue-top">
                  <span className="mono">{shortId(h.id)}</span>
                  <span className="muted small">{h.channel}</span>
                  <span className="spacer" />
                  <span className="muted small" title={h.handoffAt}>
                    {h.handoffAt === undefined ? "" : fmtRelative(h.handoffAt)}
                  </span>
                </span>
                <span className="queue-reason">{h.handoffReason ?? "No reason given"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {id === undefined ? (
        <section className="card">
          <p className="muted">Choose a conversation to read it and reply as an operator. While a session is handed off, the bot does not answer; releasing it returns the conversation to the bot.</p>
        </section>
      ) : (
        <HandoffDetail key={id} id={id} onChanged={queue.reload} />
      )}
    </div>
  );
}

function HandoffDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { client } = useAuth();
  const detail = useAsync(() => client.handoffs.get(id, { limit: 200 }), [client, id]);
  useInterval(detail.reload, 10_000);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmRelease, setConfirmRelease] = useState(false);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const reply = text.trim();
    if (reply === "" || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await client.handoffs.reply(id, reply);
      setText("");
      setResult(res.delivered ? "Sent to the customer." : "Saved to the conversation. This channel has no push delivery, so the client sees it when it next reads the messages.");
      detail.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
  };
  const release = async () => {
    setBusy(true);
    try {
      await client.handoffs.release(id);
      onChanged();
      navigate("/handoffs");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (detail.data === undefined) {
    return <section className="card">{detail.error !== undefined ? <p className="error">{detail.error}</p> : <p className="muted">Loading…</p>}</section>;
  }
  const { session, messages } = detail.data;
  const open = session.status === "handoff";

  return (
    <section className="card handoff-detail">
      <div className="card-head">
        <div>
          <h3>
            <Link to={`/sessions/${session.id}`}>
              <span className="mono">{shortId(session.id)}</span>
            </Link>{" "}
            <span className="muted small">
              {session.channel}
              {session.externalId !== undefined && ` · ${session.externalId}`}
            </span>
          </h3>
          <p className="muted small">{session.handoffReason ?? "No reason given"}</p>
        </div>
        {open &&
          (confirmRelease ? (
            <span className="confirm">
              <button className="button primary" type="button" disabled={busy} onClick={() => void release()}>
                Return to bot
              </button>
              <button className="button ghost" type="button" onClick={() => setConfirmRelease(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button className="button" type="button" onClick={() => setConfirmRelease(true)}>
              Release…
            </button>
          ))}
      </div>
      <div className="handoff-transcript">{messages.length === 0 ? <p className="muted">No messages.</p> : <Transcript messages={messages} />}</div>
      {open ? (
        <form className="reply" onSubmit={send}>
          <label className="field">
            <span>Reply as operator</span>
            <textarea rows={3} value={text} maxLength={8000} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder="আপনার উত্তর লিখুন… (Ctrl+Enter to send)" />
          </label>
          <div className="reply-actions">
            {result !== undefined && (
              <span className="muted small" role="status">
                {result}
              </span>
            )}
            {error !== undefined && (
              <span className="error-text small" role="alert">
                {error}
              </span>
            )}
            <span className="spacer" />
            <button className="button primary" type="submit" disabled={busy || text.trim() === ""}>
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      ) : (
        <p className="muted">This session is back with the bot.</p>
      )}
    </section>
  );
}
