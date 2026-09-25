import { useState, type FormEvent } from "react";
import type { AdminKey } from "@banglaclaw/client";
import { errorMessage, useAsync, useAuth } from "../api";
import { fmtDateTime, fmtRelative } from "../format";

type Role = AdminKey["role"];
type Scope = AdminKey["scopes"][number];

export function Keys() {
  const { client, me } = useAuth();
  const { data, error, reload } = useAsync(() => client.admin.keys(), [client]);
  const [issued, setIssued] = useState<{ token: string; user: string } | undefined>(undefined);
  const [showRevoked, setShowRevoked] = useState(false);
  const keys = (data?.keys ?? []).filter((k) => showRevoked || k.status === "active");
  const revokedCount = (data?.keys ?? []).filter((k) => k.status === "revoked").length;

  return (
    <>
      <CreateKey
        onCreated={(token, user) => {
          setIssued({ token, user });
          reload();
        }}
      />
      {issued !== undefined && <IssuedToken token={issued.token} user={issued.user} onDismiss={() => setIssued(undefined)} />}
      {error !== undefined && <p className="error" role="alert">{error}</p>}
      <section className="card flush">
        <div className="card-head pad">
          <h3>All keys</h3>
          {revokedCount > 0 && (
            <label className="check">
              <input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} /> Show {revokedCount} revoked
            </label>
          )}
        </div>
        {data === undefined ? (
          !error && <p className="muted pad">Loading…</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>User</th>
                <th>Role</th>
                <th>Scopes</th>
                <th>Created</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className={k.status === "revoked" ? "revoked" : undefined}>
                  <td>
                    {k.name} <span className="mono muted small">{k.id}</span>
                  </td>
                  <td>{k.user}</td>
                  <td>{k.role}</td>
                  <td>{k.scopes.join(", ")}</td>
                  <td title={k.createdAt}>{fmtDateTime(k.createdAt)}</td>
                  <td>{k.lastUsedAt === undefined ? <span className="muted">never</span> : fmtRelative(k.lastUsedAt)}</td>
                  <td className="actions">
                    {k.status === "revoked" ? (
                      <span className="muted">Revoked</span>
                    ) : k.id === me.key.id ? (
                      <span className="muted small">This key</span>
                    ) : (
                      <RevokeButton onRevoke={() => client.admin.revokeKey(k.id).then(reload)} />
                    )}
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

function CreateKey({ onCreated }: { onCreated: (token: string, user: string) => void }) {
  const { client } = useAuth();
  const [user, setUser] = useState("");
  const [name, setName] = useState("default");
  const [role, setRole] = useState<Role | "">("");
  const [scopes, setScopes] = useState<Scope[]>(["read", "run"]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const toggle = (scope: Scope) => setScopes((s) => (s.includes(scope) ? s.filter((x) => x !== scope) : [...s, scope]));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await client.admin.createKey({ user: user.trim(), name: name.trim() || "default", scopes, ...(role !== "" && { role }) });
      onCreated(res.token, res.key.user);
      setUser("");
      setName("default");
      setRole("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card create-key" onSubmit={submit}>
      <h3>Issue a key</h3>
      <div className="form-row">
        <label className="field">
          <span>User</span>
          <input required maxLength={100} placeholder="my-app" value={user} onChange={(e) => setUser(e.target.value)} />
        </label>
        <label className="field">
          <span>Key name</span>
          <input maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role | "")}>
            <option value="">unchanged (user if new)</option>
            <option value="user">user</option>
            <option value="operator">operator</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <fieldset className="field">
          <legend>Scopes</legend>
          <label className="check">
            <input type="checkbox" checked={scopes.includes("read")} onChange={() => toggle("read")} /> read
          </label>
          <label className="check">
            <input type="checkbox" checked={scopes.includes("run")} onChange={() => toggle("run")} /> run
          </label>
        </fieldset>
        <button className="button primary" type="submit" disabled={busy || user.trim() === "" || scopes.length === 0}>
          {busy ? "Issuing…" : "Issue key"}
        </button>
      </div>
      <p className="muted small">Choosing a role also changes it for an existing user and all of their keys.</p>
      {error !== undefined && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

function IssuedToken({ token, user, onDismiss }: { token: string; user: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(token).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <section className="card notice" role="status">
      <strong>New key for {user}.</strong> Copy it now: it is shown only once.
      <div className="token-row">
        <code className="token">{token}</code>
        <button className="button" type="button" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button className="button ghost" type="button" onClick={onDismiss}>
          Done
        </button>
      </div>
    </section>
  );
}

function RevokeButton({ onRevoke }: { onRevoke: () => Promise<unknown> }) {
  const [state, setState] = useState<"idle" | "confirm" | "busy">("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  if (state === "idle") {
    return (
      <button className="button ghost danger" type="button" onClick={() => setState("confirm")}>
        Revoke
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
          onRevoke().catch((err: unknown) => {
            setError(errorMessage(err));
            setState("confirm");
          });
        }}
      >
        {state === "busy" ? "Revoking…" : "Confirm revoke"}
      </button>
      <button className="button ghost" type="button" onClick={() => setState("idle")}>
        Cancel
      </button>
    </span>
  );
}
