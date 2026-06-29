import { createSignal } from "solid-js";

/**
 * Light/dark theme state shared across every takos-office editor.
 *
 * The `takos-theme` localStorage key is shared on one origin so docs / slide /
 * sheet stay in sync. The editors build separately, so each bundle gets its own
 * signal instance — they coordinate through the shared key, not shared memory.
 */
export type Theme = "light" | "dark";

const KEY = "takos-theme";

function resolve(): Theme {
  try {
    const s = localStorage.getItem(KEY);
    if (s === "light" || s === "dark") return s;
  } catch {
    /* ignore */
  }
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function apply(t: Theme) {
  const el = globalThis.document?.documentElement;
  if (el) el.dataset.theme = t;
}

const [theme, setThemeSignal] = createSignal<Theme>(resolve());
apply(theme());
export { theme };

export function setTheme(t: Theme) {
  setThemeSignal(t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
  apply(t);
}

export function toggleTheme() {
  setTheme(theme() === "dark" ? "light" : "dark");
}
