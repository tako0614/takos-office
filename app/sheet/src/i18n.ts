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
  deleteColumn: "Delete column",
  deleteRow: "Delete row",
  deleteSheetConfirm: "Delete this sheet?",
  deleteSpreadsheet: "Delete spreadsheet",
  deleteSpreadsheetConfirm: "Delete this spreadsheet?",
  deleteSpreadsheetTitle: "Delete spreadsheet",
  editTitle: "Edit title",
  formulaInput: "Formula or value for {cell}",
  general: "General",
  importCsv: "Import CSV",
  insertColumn: "Insert column",
  insertRow: "Insert row",
  italic: "Italic",
  language: "Language",
  loading: "Loading...",
  loadingSpreadsheets: "Loading spreadsheets…",
  newSheetName: "Sheet{number}",
  newSpreadsheet: "New Spreadsheet",
  newSpreadsheetButton: "New Spreadsheet",
  noSpreadsheetsDescription: "Create your first spreadsheet to get started.",
  noSpreadsheetsTitle: "No spreadsheets yet",
  number: "Number",
  numberFormat: "Number format",
  officeDocs: "Documents",
  officeNavLabel: "Takos Office apps",
  officeSheets: "Sheets",
  officeSlides: "Slides",
  percent: "Percent",
  renameSheet: "Rename sheet",
  rename: "Rename",
  reset: "Reset",
  sheetCount: "{count} sheets",
  sortAscending: "Sort ascending",
  sortDescending: "Sort descending",
  filterColumn: "Filter by the selected column",
  filterPlaceholder: "Filter…",
  clearFilter: "Clear filter",
  sheetCountSingular: "{count} sheet",
  spreadsheetEditor: "Spreadsheet editor",
  spreadsheetTitlePlaceholder: "Spreadsheet title",
  textColor: "Text color",
  themeDark: "Dark mode",
  themeLight: "Light mode",
  toggleTheme: "Toggle theme",
  underline: "Underline",
  undo: "Undo (Ctrl+Z)",
  redo: "Redo (Ctrl+Y)",
  updated: "Updated {date}",
  untitledSpreadsheet: "Untitled Spreadsheet",
  fontSize: "Font size",
  // Keyboard shortcut help
  shortcuts: "Keyboard shortcuts",
  shortcutsHelp: "Keyboard shortcuts help",
  shortcutsOpen: "Show keyboard shortcuts",
  shortcutsClose: "Close",
  shortcutNavigate: "Move between cells",
  shortcutNavigateKeys: "Arrow keys",
  shortcutEdit: "Edit the selected cell",
  shortcutEditKeys: "Enter / Double-click",
  shortcutType: "Start typing to replace the cell",
  shortcutTypeKeys: "Any character",
  shortcutCommitDown: "Commit and move down",
  shortcutCommitDownKeys: "Enter",
  shortcutCommitUp: "Commit and move up",
  shortcutCommitUpKeys: "Shift + Enter",
  shortcutCommitNext: "Commit and move right",
  shortcutCommitNextKeys: "Tab",
  shortcutCommitPrev: "Commit and move left",
  shortcutCommitPrevKeys: "Shift + Tab",
  shortcutCancel: "Cancel editing",
  shortcutCancelKeys: "Escape",
  shortcutClear: "Clear the selected cell",
  shortcutClearKeys: "Delete / Backspace",
  shortcutExtendSelection: "Extend the selection",
  shortcutExtendSelectionKeys: "Shift + Arrow keys",
  shortcutUndo: "Undo",
  shortcutUndoKeys: "Ctrl / Cmd + Z",
  shortcutRedo: "Redo",
  shortcutRedoKeys: "Ctrl / Cmd + Y or Ctrl / Cmd + Shift + Z",
  shortcutHelp: "Open this help",
  shortcutHelpKeys: "?",
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
  deleteColumn: "列を削除",
  deleteRow: "行を削除",
  deleteSheetConfirm: "このシートを削除しますか？",
  deleteSpreadsheet: "スプレッドシートを削除",
  deleteSpreadsheetConfirm: "このスプレッドシートを削除しますか？",
  deleteSpreadsheetTitle: "スプレッドシートを削除",
  editTitle: "タイトルを編集",
  formulaInput: "{cell} の数式または値",
  general: "標準",
  importCsv: "CSV をインポート",
  insertColumn: "列を挿入",
  insertRow: "行を挿入",
  italic: "斜体",
  language: "言語",
  loading: "読み込み中...",
  loadingSpreadsheets: "スプレッドシートを読み込み中…",
  newSheetName: "シート{number}",
  newSpreadsheet: "新しいスプレッドシート",
  newSpreadsheetButton: "新規スプレッドシート",
  noSpreadsheetsDescription: "最初のスプレッドシートを作成して始めましょう。",
  noSpreadsheetsTitle: "まだスプレッドシートはありません",
  number: "数値",
  numberFormat: "表示形式",
  officeDocs: "ドキュメント",
  officeNavLabel: "Takos Office アプリ",
  officeSheets: "シート",
  officeSlides: "スライド",
  percent: "パーセント",
  renameSheet: "シート名を変更",
  rename: "名前を変更",
  reset: "リセット",
  sheetCount: "{count} シート",
  sortAscending: "昇順で並べ替え",
  sortDescending: "降順で並べ替え",
  filterColumn: "選択中の列でフィルタ",
  filterPlaceholder: "フィルタ…",
  clearFilter: "フィルタを解除",
  sheetCountSingular: "{count} シート",
  spreadsheetEditor: "スプレッドシートエディタ",
  spreadsheetTitlePlaceholder: "スプレッドシートのタイトル",
  textColor: "文字色",
  themeDark: "ダークモード",
  themeLight: "ライトモード",
  toggleTheme: "テーマを切り替え",
  underline: "下線",
  undo: "元に戻す (Ctrl+Z)",
  redo: "やり直し (Ctrl+Y)",
  updated: "更新: {date}",
  untitledSpreadsheet: "無題のスプレッドシート",
  fontSize: "フォントサイズ",
  // Keyboard shortcut help
  shortcuts: "キーボードショートカット",
  shortcutsHelp: "キーボードショートカットのヘルプ",
  shortcutsOpen: "キーボードショートカットを表示",
  shortcutsClose: "閉じる",
  shortcutNavigate: "セル間を移動",
  shortcutNavigateKeys: "矢印キー",
  shortcutEdit: "選択中のセルを編集",
  shortcutEditKeys: "Enter / ダブルクリック",
  shortcutType: "入力するとセルを置き換え",
  shortcutTypeKeys: "任意の文字",
  shortcutCommitDown: "確定して下へ移動",
  shortcutCommitDownKeys: "Enter",
  shortcutCommitUp: "確定して上へ移動",
  shortcutCommitUpKeys: "Shift + Enter",
  shortcutCommitNext: "確定して右へ移動",
  shortcutCommitNextKeys: "Tab",
  shortcutCommitPrev: "確定して左へ移動",
  shortcutCommitPrevKeys: "Shift + Tab",
  shortcutCancel: "編集をキャンセル",
  shortcutCancelKeys: "Escape",
  shortcutClear: "選択中のセルを消去",
  shortcutClearKeys: "Delete / Backspace",
  shortcutExtendSelection: "選択範囲を拡張",
  shortcutExtendSelectionKeys: "Shift + 矢印キー",
  shortcutUndo: "元に戻す",
  shortcutUndoKeys: "Ctrl / Cmd + Z",
  shortcutRedo: "やり直し",
  shortcutRedoKeys: "Ctrl / Cmd + Y または Ctrl / Cmd + Shift + Z",
  shortcutHelp: "このヘルプを開く",
  shortcutHelpKeys: "?",
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
