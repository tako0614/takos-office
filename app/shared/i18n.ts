import { createSignal } from "solid-js";

/**
 * Shared i18n scaffold for the office editors.
 *
 * The machinery (language signal, browser/localStorage detection, `{param}`
 * interpolation, `t` / `setLanguage` / `dateLocale` / `useI18n`) is identical
 * across docs / slide / sheet; only the message catalogs differ. Each editor
 * defines its own `en` / `ja` catalogs and calls `createI18n({ en, ja })`.
 */

export type Language = "ja" | "en";
export type TranslationParams = Record<string, string | number>;

const PRIMARY_STORAGE_KEY = "takos-language";
const LEGACY_STORAGE_KEY = "takos-lang";

function parseStoredLanguage(value: string | null | undefined): Language | null {
  return value === "ja" || value === "en" ? value : null;
}

export interface I18n<Key extends string> {
  language: () => Language;
  setLanguage: (lang: Language) => void;
  t: (key: Key, params?: TranslationParams) => string;
  dateLocale: () => string;
  useI18n: () => {
    language: () => Language;
    setLanguage: (lang: Language) => void;
    t: (key: Key, params?: TranslationParams) => string;
  };
}

export function createI18n<Catalog extends Record<string, string>>(catalogs: {
  en: Catalog;
  ja: Record<keyof Catalog, string>;
}): I18n<keyof Catalog & string> {
  type Key = keyof Catalog & string;
  const translations: Record<Language, Record<Key, string>> = {
    en: catalogs.en as Record<Key, string>,
    ja: catalogs.ja as Record<Key, string>,
  };

  function detectInitialLanguage(): Language {
    try {
      const stored =
        parseStoredLanguage(globalThis.localStorage?.getItem(PRIMARY_STORAGE_KEY)) ??
        parseStoredLanguage(globalThis.localStorage?.getItem(LEGACY_STORAGE_KEY));
      if (stored) return stored;
    } catch {
      // Ignore storage access failures and fall back to browser language.
    }

    const browserLang = globalThis.navigator?.language?.toLowerCase() ?? "";
    return browserLang.startsWith("ja") ? "ja" : "en";
  }

  const [language, setLanguageSignal] = createSignal<Language>(
    detectInitialLanguage(),
  );

  function interpolate(template: string, params?: TranslationParams): string {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
      const value = params[key];
      return value === undefined ? `{${key}}` : String(value);
    });
  }

  function applyDocumentLang(lang: Language): void {
    if (globalThis.document?.documentElement) {
      globalThis.document.documentElement.lang = lang;
    }
  }

  function setLanguage(lang: Language): void {
    setLanguageSignal(lang);
    try {
      globalThis.localStorage?.setItem(PRIMARY_STORAGE_KEY, lang);
      globalThis.localStorage?.setItem(LEGACY_STORAGE_KEY, lang);
    } catch {
      // Ignore storage access failures.
    }
    applyDocumentLang(lang);
  }

  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("storage", (event: StorageEvent) => {
      if (
        event.key !== PRIMARY_STORAGE_KEY &&
        event.key !== LEGACY_STORAGE_KEY
      ) {
        return;
      }
      const next = parseStoredLanguage(event.newValue);
      if (next && next !== language()) {
        setLanguageSignal(next);
        applyDocumentLang(next);
      }
    });
  }

  function t(key: Key, params?: TranslationParams): string {
    const lang = language();
    return interpolate(translations[lang][key] ?? translations.en[key], params);
  }

  function dateLocale(): string {
    return language() === "ja" ? "ja-JP" : "en-US";
  }

  function useI18n() {
    return { language, setLanguage, t };
  }

  setLanguage(language());

  return { language, setLanguage, t, dateLocale, useI18n };
}
