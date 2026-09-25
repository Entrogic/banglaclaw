import { useSyncExternalStore, type MouseEvent, type ReactNode } from "react";

/** "/admin" in production (Vite `base`); paths below are relative to it. */
export const BASE = import.meta.env.BASE_URL.replace(/\/+$/, "");
const EVENT = "banglaclaw:navigate";

function currentPath(): string {
  const path = window.location.pathname.startsWith(BASE) ? window.location.pathname.slice(BASE.length) : window.location.pathname;
  return path === "" ? "/" : path;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, currentPath);
}

export function navigate(to: string): void {
  window.history.pushState(null, "", BASE + to);
  window.dispatchEvent(new Event(EVENT));
  window.scrollTo?.(0, 0);
}

export function Link({ to, className, children, title }: { to: string; className?: string; children: ReactNode; title?: string }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={BASE + to} className={className} onClick={onClick} title={title}>
      {children}
    </a>
  );
}
