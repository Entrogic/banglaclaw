import { useCallback, useEffect, useMemo, useState } from "react";
import type { BanglaClawClient, FetchLike, Me } from "@entrogic-net/client";
import { AuthContext, createClient, keyStore, useAuth, verifyAdmin, type Auth } from "./api";
import { useAsync } from "./api";
import { useInterval } from "./components";
import { Agent } from "./pages/Agent";
import { Audit } from "./pages/Audit";
import { Handoffs } from "./pages/Handoffs";
import { Keys } from "./pages/Keys";
import { Knowledge } from "./pages/Knowledge";
import { Login } from "./pages/Login";
import { Overview } from "./pages/Overview";
import { SessionDetail } from "./pages/SessionDetail";
import { Sessions } from "./pages/Sessions";
import { Link, usePath } from "./router";
import { ThemeToggle } from "./theme";

type State = { phase: "checking" } | { phase: "signed-out"; notice?: string } | { phase: "signed-in"; client: BanglaClawClient; me: Me };

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/sessions", label: "Sessions" },
  { to: "/handoffs", label: "Handoffs" },
  { to: "/agent", label: "Agent" },
  { to: "/knowledge", label: "Knowledge" },
  { to: "/keys", label: "API keys" },
  { to: "/audit", label: "Audit log" },
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
  // "/sessions/<id>" and "/handoffs/<id>" belong to their list's section.
  const match = /^(\/[^/]+)\/([^/]+)\/?$/.exec(path);
  const section = match?.[1] ?? (path.replace(/\/+$/, "") || "/");
  const itemId = match?.[2] === undefined ? undefined : decodeURIComponent(match[2]);
  const title = NAV.find((n) => n.to === section)?.label ?? "Not found";
  const sessionDetail = section === "/sessions" && itemId !== undefined;

  useEffect(() => {
    document.title = `${sessionDetail ? "Session" : title} · BanglaClaw Admin`;
  }, [title, sessionDetail]);

  let page;
  if (sessionDetail) page = <SessionDetail id={itemId} />;
  else if (section === "/handoffs") page = <Handoffs {...(itemId !== undefined && { id: itemId })} />;
  else if (itemId !== undefined) page = <NotFound />;
  else if (section === "/") page = <Overview />;
  else if (section === "/sessions") page = <Sessions />;
  else if (section === "/agent") page = <Agent />;
  else if (section === "/knowledge") page = <Knowledge />;
  else if (section === "/keys") page = <Keys />;
  else if (section === "/audit") page = <Audit />;
  else page = <NotFound />;

  return (
    <div className="shell">
      <Header current={section} />
      <main className="content">
        {!sessionDetail && <h2 className="page-title">{title}</h2>}
        {page}
      </main>
    </div>
  );
}

function NotFound() {
  return (
    <p className="muted">
      This page does not exist. <Link to="/">Go to the overview</Link>.
    </p>
  );
}

function Header({ current }: { current: string }) {
  const { client, me, signOut } = useAuth();
  // Waiting handoffs, shown as a count on the nav item.
  const waiting = useAsync(() => client.handoffs.list({ limit: 200 }).then((r) => r.handoffs.length), [client, current]);
  useInterval(waiting.reload, 30_000);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" /> BanglaClaw <span className="muted">Admin</span>
      </div>
      <nav aria-label="Main">
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} className={n.to === current ? "active" : undefined}>
            {n.label}
            {n.to === "/handoffs" && waiting.data !== undefined && waiting.data > 0 && (
              <span className="count" aria-label={`${waiting.data} waiting`}>
                {waiting.data}
              </span>
            )}
          </Link>
        ))}
      </nav>
      <span className="spacer" />
      <span className="muted small who" title={`Key ${me.key.name} (${me.key.id})`}>
        {me.user.name}
      </span>
      <ThemeToggle />
      <button className="button ghost" type="button" onClick={signOut}>
        Sign out
      </button>
    </header>
  );
}
