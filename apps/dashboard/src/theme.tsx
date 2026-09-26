import { useState, type ReactNode } from "react";

export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "banglaclaw.admin.theme";
const THEMES: readonly Theme[] = ["system", "light", "dark"];

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** The saved choice; "system" when nothing (or nothing readable) is stored. */
export function getTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isTheme(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

/** Sets `data-theme` on <html>; styles.css switches its light-dark() tokens on it. */
export function applyTheme(theme: Theme = getTheme()): void {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage blocked: the choice still applies to this page.
  }
  applyTheme(theme);
}

const ICONS: Record<Theme, ReactNode> = {
  system: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
};

const OPTIONS: { theme: Theme; label: string }[] = [
  { theme: "system", label: "System theme" },
  { theme: "light", label: "Light theme" },
  { theme: "dark", label: "Dark theme" },
];

export function ThemeToggle() {
  const [theme, setState] = useState<Theme>(getTheme);
  return (
    <div className="segmented theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button
          key={o.theme}
          type="button"
          aria-label={o.label}
          title={o.label}
          aria-pressed={theme === o.theme}
          onClick={() => {
            setTheme(o.theme);
            setState(o.theme);
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {ICONS[o.theme]}
          </svg>
        </button>
      ))}
    </div>
  );
}
