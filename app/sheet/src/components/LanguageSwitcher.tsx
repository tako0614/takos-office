import { For } from "solid-js";
import { type Language, useI18n } from "../i18n";

const LANGUAGES: { label: string; value: Language }[] = [
  { label: "日本語", value: "ja" },
  { label: "English", value: "en" },
];

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();

  return (
    <div
      class="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-0.5 dark:border-neutral-700 dark:bg-neutral-950"
      aria-label={t("language")}
    >
      <For each={LANGUAGES}>
        {(lang) => (
          <button
            type="button"
            class="min-h-11 sm:min-h-7 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
            classList={{
              "bg-white text-gray-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100 dark:shadow-none":
                language() === lang.value,
              "text-gray-600 hover:text-gray-900 dark:text-neutral-400 dark:hover:text-neutral-100":
                language() !== lang.value,
            }}
            aria-pressed={language() === lang.value}
            onClick={() => setLanguage(lang.value)}
          >
            {lang.label}
          </button>
        )}
      </For>
    </div>
  );
}
