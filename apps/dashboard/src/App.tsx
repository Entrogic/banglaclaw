import { useCallback, useEffect, useMemo, useState } from "react";
import type { BanglaClawClient, FetchLike, Me } from "@banglaclaw/client";
import { AuthContext, createClient, keyStore, useAuth, verifyAdmin, type Auth } from "./api";
import { Keys } from "./pages/Keys";
import { Login } from "./pages/Login";
import { Overview } from "./pages/Overview";
import { SessionDetail } from "./pages/SessionDetail";
import { Sessions } from "./pages/Sessions";
import { Link, usePath } from "./router";

type State = { phase: "checking" } | { phase: "signed-out"; notice?: string } | { phase: "signed-in"; client: BanglaClawClient; me: Me };

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/sessions", label: "Sessions" },
  { to: "/keys", label: "API keys" },
] as const;

export function App({ fetch: fetchImpl }: { fetch?: FetchLike } = {}) {
  const [state, setState] = useState<State>(() => (keyStore.get() === undefined ? { phase: "signed-out" } : { phase: "checking" }));

  const signOut = useCallback((notice?: string) => {
    keyStore.set(undefined);
    setState({ phase: "signed-out", ...(notice !== undefined && { notice }) });
  }, []);
  const makeClient = useCallback((key: string) => createClient(key, () => signOut("Your key was rejected (revoked or invalid). Sign in again."), fetchImpl), [signOut, fetchImpl]);

  // Restore a key saved earlier in this tab.
  useEffect(() => {
    const saved = keyStore.get();
    if (saved === undefined) return;
    const client = makeClient(saved);
    verifyAdmin(client).then(
      (me) => setState({ phase: "signed-in", client, me }),
      (error: unknown) => signOut(error instanceof Error ? error.message : undefined),
    );
  }, [makeClient, signOut]);

  const auth = useMemo<Auth | undefined>(() => (state.phase === "signed-in" ? { client: state.client, me: state.me, signOut: () => signOut() } : undefined), [state, signOut]);

  if (state.phase === "checking") return <p className="muted pad">Checking your key…</p>;
  if (auth === undefined) {
    return (
      <>
        {state.phase === "signed-out" && state.notice !== undefined && (
          <p className="banner" role="status">
            {state.notice}
          </p>
        )}
        <Login
          makeClient={makeClient}
          onSignedIn={(key, client, me) => {
            keyStore.set(key);
            setState({ phase: "signed-in", client, me });
          }}
        />
      </>
    );
  }
  return (
    <AuthContext.Provider value={auth}>
      <Shell />
    </AuthContext.Provider>
  );
}

function Shell() {
  const path = usePath();
  const sessionMatch = /^\/sessions\/([^/]+)\/?$/.exec(path);
  const section = sessionMatch !== null ? "/sessions" : path.replace(/\/+$/, "") || "/";
  const title = NAV.find((n) => n.to === section)?.label ?? "Not found";

  useEffect(() => {
    document.title = `${sessionMatch !== null ? "Session" : title} · BanglaClaw Admin`;
  }, [title, sessionMatch]);

  let page;
  if (sessionMatch?.[1] !== undefined) page = <SessionDetail id={decodeURIComponent(sessionMatch[1])} />;
  else if (section === "/") page = <Overview />;
  else if (section === "/sessions") page = <Sessions />;
  else if (section === "/keys") page = <Keys />;
  else page = <p className="muted">This page does not exist. <Link to="/">Go to the overview</Link>.</p>;

  return (
    <div className="shell">
      <Header current={section} />
      <main className="content">
        {sessionMatch === null && <h2 className="page-title">{title}</h2>}
        {page}
      </main>
    </div>
  );
}

function Header({ current }: { current: string }) {
  const { me, signOut } = useAuth();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" /> BanglaClaw <span className="muted">Admin</span>
      </div>
      <nav aria-label="Main">
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} className={n.to === current ? "active" : undefined}>
            {n.label}
          </Link>
        ))}
      </nav>
      <span className="spacer" />
      <span className="muted small who" title={`Key ${me.key.name} (${me.key.id})`}>
        {me.user.name}
      </span>
      <button className="button ghost" type="button" onClick={signOut}>
        Sign out
      </button>
    </header>
  );
}
