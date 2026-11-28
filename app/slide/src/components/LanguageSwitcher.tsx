import { For } from "solid-js";
import { type Language, useI18n } from "../i18n";

const LANGUAGES: { label: string; value: Language }[] = [
  { label: "日本語", value: "ja" },
  { label: "English", value: "en" },
];

export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();

  return (
    <div
      class="inline-flex rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-900 p-0.5"
      aria-label={t("language")}
    >
      <For each={LANGUAGES}>
        {(lang) => (
          <button
            type="button"
            class="min-h-10 sm:min-h-7 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
            classList={{
              "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100":
                language() === lang.value,
              "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100":
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
