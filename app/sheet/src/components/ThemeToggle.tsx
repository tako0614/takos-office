import { Show } from "solid-js";
import { Moon, Sun } from "lucide-solid";
import { theme, toggleTheme } from "../lib/theme";
import { useI18n } from "../i18n";

/**
 * Light/dark theme toggle. Shows a Sun in dark mode (click → switch to light)
 * and a Moon in light mode (click → switch to dark). The theme state and its
 * `takos-theme` localStorage key are shared across every takos-office editor so
 * the whole suite stays in sync on one origin.
 */
export default function ThemeToggle() {
  const { t } = useI18n();

  return (
    <button
      type="button"
      class="p-1.5 rounded-full text-gray-500 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-neutral-800 transition-colors"
      onClick={toggleTheme}
      title={t("toggleTheme")}
      aria-label={theme() === "dark" ? t("themeLight") : t("themeDark")}
    >
      <Show when={theme() === "dark"} fallback={<Moon size={18} />}>
        <Sun size={18} />
      </Show>
    </button>
  );
}
