// CANONICAL SCAFFOLD (owner): takos-apps/takos-docs/src/i18n.ts
// The i18n scaffold (imports, types, signal, interpolate/setLanguage/t/
// dateLocale/useI18n, and the trailing bootstrap call) is byte-identical
// across takos-docs / takos-slide / takos-excel. Only the per-app message
// catalog — the `const en = { … }` block through the end of the `ja` table —
// is allowed to differ between apps. The copies are deliberately vendored
// rather than factored into a shared package because each takos-app ships as
// a standalone git repo / OpenTofu module installable from a Git URL.
//
// Edit scaffold changes in THIS canonical copy, then propagate with
// `bun run check:takos-apps-dedupe --fix` (ecosystem root): it replaces each
// copy's scaffold from canonical while preserving that app's catalog. Verify
// mode (`bun run check:takos-apps-dedupe`) is wired into `bun run check:all`.
import { createSignal } from "solid-js";

export type Language = "ja" | "en";
export type TranslationParams = Record<string, string | number>;

const STORAGE_KEY = "takos-lang";

const en = {
  addSheet: "Add sheet",
  alignCenter: "Align center",
  alignLeft: "Align left",
  alignRight: "Align right",
  backToList: "Back to list",
  backgroundColor: "Background color",
  bold: "Bold",
  cancel: "Cancel",
  cellCount: "{count} cells",
  cellCountSingular: "{count} cell",
  create: "Create",
  createSpreadsheet: "Create Spreadsheet",
  currency: "Currency",
  date: "Date",
  defaultSheetName: "Sheet1",
  delete: "Delete",
  deleteSheetConfirm: "Delete this sheet?",
  deleteSpreadsheetConfirm: "Delete this spreadsheet?",
  deleteSpreadsheetTitle: "Delete spreadsheet",
  general: "General",
  importCsv: "Import CSV",
  italic: "Italic",
  language: "Language",
  loading: "Loading...",
  newSheetName: "Sheet{number}",
  newSpreadsheet: "New Spreadsheet",
  newSpreadsheetButton: "New Spreadsheet",
  noSpreadsheetsDescription: "Create your first spreadsheet to get started.",
  noSpreadsheetsTitle: "No spreadsheets yet",
  number: "Number",
  numberFormat: "Number format",
  percent: "Percent",
  rename: "Rename",
  reset: "Reset",
  sheetCount: "{count} sheets",
  sheetCountSingular: "{count} sheet",
  spreadsheetEditor: "Spreadsheet editor",
  spreadsheetTitlePlaceholder: "Spreadsheet title",
  textColor: "Text color",
  underline: "Underline",
  undo: "Undo (Ctrl+Z)",
  redo: "Redo (Ctrl+Y)",
  updated: "Updated {date}",
  untitledSpreadsheet: "Untitled Spreadsheet",
  fontSize: "Font size",
} as const;

type TranslationKey = keyof typeof en;

const ja: Record<TranslationKey, string> = {
  addSheet: "シートを追加",
  alignCenter: "中央揃え",
  alignLeft: "左揃え",
  alignRight: "右揃え",
  backToList: "一覧に戻る",
  backgroundColor: "背景色",
  bold: "太字",
  cancel: "キャンセル",
  cellCount: "{count} セル",
  cellCountSingular: "{count} セル",
  create: "作成",
  createSpreadsheet: "スプレッドシートを作成",
  currency: "通貨",
  date: "日付",
  defaultSheetName: "シート1",
  delete: "削除",
  deleteSheetConfirm: "このシートを削除しますか？",
  deleteSpreadsheetConfirm: "このスプレッドシートを削除しますか？",
  deleteSpreadsheetTitle: "スプレッドシートを削除",
  general: "標準",
  importCsv: "CSV をインポート",
  italic: "斜体",
  language: "言語",
  loading: "読み込み中...",
  newSheetName: "シート{number}",
  newSpreadsheet: "新しいスプレッドシート",
  newSpreadsheetButton: "新規スプレッドシート",
  noSpreadsheetsDescription: "最初のスプレッドシートを作成して始めましょう。",
  noSpreadsheetsTitle: "まだスプレッドシートはありません",
  number: "数値",
  numberFormat: "表示形式",
  percent: "パーセント",
  rename: "名前を変更",
  reset: "リセット",
  sheetCount: "{count} シート",
  sheetCountSingular: "{count} シート",
  spreadsheetEditor: "スプレッドシートエディタ",
  spreadsheetTitlePlaceholder: "スプレッドシートのタイトル",
  textColor: "文字色",
  underline: "下線",
  undo: "元に戻す (Ctrl+Z)",
  redo: "やり直し (Ctrl+Y)",
  updated: "更新: {date}",
  untitledSpreadsheet: "無題のスプレッドシート",
  fontSize: "フォントサイズ",
};

const translations: Record<Language, Record<TranslationKey, string>> = {
  en,
  ja,
};

function detectInitialLanguage(): Language {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored === "ja" || stored === "en") return stored;
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

export function setLanguage(lang: Language): void {
  setLanguageSignal(lang);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, lang);
  } catch {
    // Ignore storage access failures.
  }
  if (globalThis.document?.documentElement) {
    globalThis.document.documentElement.lang = lang;
  }
}

export function t(
  key: TranslationKey,
  params?: TranslationParams,
): string {
  const lang = language();
  return interpolate(translations[lang][key] ?? translations.en[key], params);
}

export function dateLocale(): string {
  return language() === "ja" ? "ja-JP" : "en-US";
}

export function useI18n() {
  return {
    language,
    setLanguage,
    t,
  };
}

setLanguage(language());
