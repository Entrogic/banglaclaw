import { createContext, useContext, useEffect, useState } from "react";
import { BanglaClawApiError, BanglaClawClient, type FetchLike, type Me } from "@entrogic-net/client";

const STORAGE_KEY = "banglaclaw.adminKey";

/** The admin key lives in sessionStorage: it survives reloads but not closing the tab. */
export const keyStore = {
  get(): string | undefined {
    try {
      return sessionStorage.getItem(STORAGE_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set(key: string | undefined): void {
    try {
      if (key === undefined) sessionStorage.removeItem(STORAGE_KEY);
      else sessionStorage.setItem(STORAGE_KEY, key);
    } catch {
      // Storage blocked: the key only lasts for this page view.
    }
  },
};

/** Client for the page's own origin; `onUnauthorized` fires on any 401 (revoked or expired key). */
export function createClient(apiKey: string, onUnauthorized: () => void, fetchImpl: FetchLike = (input, init) => fetch(input, init)): BanglaClawClient {
  return new BanglaClawClient({
    baseUrl: window.location.origin,
    apiKey,
    fetch: async (input, init) => {
      const res = await fetchImpl(input, init);
      if (res.status === 401) onUnauthorized();
      return res;
    },
  });
}

/** Signs in: the key must belong to an admin. Throws a readable Error otherwise. */
export async function verifyAdmin(client: BanglaClawClient): Promise<Me> {
  let me: Me;
  try {
    me = await client.me();
  } catch (error) {
    if (error instanceof BanglaClawApiError && error.status === 401) throw new Error("This API key is not valid or has been revoked.");
    throw error;
  }
  if (me.user.role !== "admin") throw new Error(`This key belongs to “${me.user.name}” (role ${me.user.role}). The dashboard needs an admin key.`);
  return me;
}

export interface Auth {
  client: BanglaClawClient;
  me: Me;
  signOut: () => void;
}

export const AuthContext = createContext<Auth | undefined>(undefined);

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (auth === undefined) throw new Error("useAuth outside AuthContext");
  return auth;
}

export function errorMessage(error: unknown): string {
  if (error instanceof BanglaClawApiError) return `${error.message} (${error.code})`;
  return error instanceof Error ? error.message : String(error);
}

export interface AsyncState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
}

/** Runs `load` whenever `deps` change. Previous data stays visible while a reload is in flight. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data: T | undefined; error: string | undefined; loading: boolean }>({ data: undefined, error: undefined, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => alive && setState({ data, error: undefined, loading: false }),
      (error: unknown) => alive && setState((s) => ({ ...s, error: errorMessage(error), loading: false })),
    );
    return () => {
      alive = false;
    };
    // `load` is recreated every render; `deps` says when to rerun it.
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
