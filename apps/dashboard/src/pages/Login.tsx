import { useState, type FormEvent } from "react";
import type { BanglaClawClient, Me } from "@entrogic-net/client";
import { errorMessage, verifyAdmin } from "../api";
import { ThemeToggle } from "../theme";

export function Login({ makeClient, onSignedIn }: { makeClient: (key: string) => BanglaClawClient; onSignedIn: (key: string, client: BanglaClawClient, me: Me) => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const token = key.trim();
    if (token === "") return;
    setBusy(true);
    setError(undefined);
    try {
      const client = makeClient(token);
      onSignedIn(token, client, await verifyAdmin(client));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1>
          <span className="brand-mark" aria-hidden="true" /> BanglaClaw Admin
        </h1>
        <p className="muted">Sign in with an admin API key. Create one with</p>
        <pre className="code">banglaclaw key create --user ops --role admin</pre>
        <label className="field">
          <span>API key</span>
          <input type="password" autoComplete="off" spellCheck={false} placeholder="bck_…" value={key} onChange={(e) => setKey(e.target.value)} autoFocus />
        </label>
        {error !== undefined && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" type="submit" disabled={busy || key.trim() === ""}>
          {busy ? "Checking…" : "Sign in"}
        </button>
        <p className="muted small">The key is kept in this tab only and is cleared when you close it.</p>
      </form>
      <ThemeToggle />
    </main>
  );
}
