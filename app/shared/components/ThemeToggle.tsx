import { Show } from "solid-js";
import { Moon, Sun } from "lucide-solid";
import { theme, toggleTheme } from "../lib/theme";

/** The i18n keys the toggle needs; each editor's `t` is a superset of these. */
type ThemeToggleI18n = (
  key: "toggleTheme" | "themeLight" | "themeDark",
) => string;

/**
 * Light/dark theme toggle shared across the takos-office editors. Shows a Sun
 * in dark mode (click → switch to light) and a Moon in light mode (click →
 * switch to dark). The theme state and its `takos-theme` localStorage key are
 * shared across every editor so the whole suite stays in sync on one origin.
 *
 * i18n is passed in via the `t` prop because each editor owns its own catalog.
 */
export default function ThemeToggle(props: { t: ThemeToggleI18n }) {
  return (
    <button
      type="button"
      class="p-1.5 rounded-full text-gray-500 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-neutral-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      onClick={toggleTheme}
      title={props.t("toggleTheme")}
      aria-label={theme() === "dark" ? props.t("themeLight") : props.t("themeDark")}
    >
      <Show when={theme() === "dark"} fallback={<Moon size={18} />}>
        <Sun size={18} />
      </Show>
    </button>
  );
}
