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
  apply: "Apply",
  backToDocuments: "Back to documents",
  blankDocument: "Blank document",
  blockQuote: "Block quote",
  bold: "Bold (Ctrl+B)",
  bulletList: "Bullet list",
  cancel: "Cancel",
  centerAlign: "Center",
  characterCount: "{count} characters",
  characterCountSingular: "{count} character",
  caseSensitive: "Match case",
  checklist: "Checklist",
  closeFind: "Close find",
  codeBlock: "Code block",
  collapse: "Collapse",
  daysAgo: "{count} days ago",
  doc: "Documents",
  deleteDocumentConfirm: "Delete this document?",
  deleteDocumentTitle: "Delete document",
  expand: "Expand",
  export: "Export",
  exportHtml: "HTML (.html)",
  exportMarkdown: "Markdown (.md)",
  exportPlainText: "Plain text (.txt)",
  find: "Find",
  findAndReplace: "Find and replace",
  findPlaceholder: "Find",
  font: "Font",
  heading1: "Heading 1",
  heading2: "Heading 2",
  heading3: "Heading 3",
  highlight: "Highlight",
  horizontalRule: "Horizontal rule",
  imagePlaceholder: "Paste image URL...",
  insert: "Insert",
  insertImage: "Insert image",
  insertTable: "Insert table",
  italic: "Italic (Ctrl+I)",
  language: "Language",
  leftAlign: "Left align",
  link: "Link",
  linkPlaceholder: "Paste or type a link...",
  matchCounter: "{current}/{total}",
  nextMatch: "Next",
  noDocumentsDescription: "Create your first document to get started.",
  noDocumentsTitle: "No documents yet",
  noHeadings: "No headings in document",
  noMatches: "No results",
  numberedList: "Numbered list",
  office: "Office",
  openOffice: "Open Office",
  opened: "Opened {date}",
  previousMatch: "Previous",
  outline: "Outline",
  recentDocuments: "Recent documents",
  redo: "Redo (Ctrl+Y)",
  replace: "Replace",
  replaceAll: "Replace all",
  replacePlaceholder: "Replace",
  reset: "Reset",
  rightAlign: "Right align",
  saved: "Saved",
  saveFailed: "Save failed",
  saving: "Saving...",
  searchDocuments: "Search documents",
  sheet: "Sheets",
  size: "Size",
  slide: "Slides",
  startNewDocument: "Start a new document",
  strikethrough: "Strikethrough",
  subscript: "Subscript",
  superscript: "Superscript",
  textColor: "Text color",
  themeDark: "Dark mode",
  themeLight: "Light mode",
  today: "Today",
  toggleTheme: "Toggle theme",
  typeSomething: "Type something...",
  underline: "Underline (Ctrl+U)",
  undo: "Undo (Ctrl+Z)",
  untitled: "Untitled",
  untitledDocument: "Untitled document",
  wordCount: "{count} words",
  wordCountSingular: "{count} word",
  yesterday: "Yesterday",
} as const;

type TranslationKey = keyof typeof en;

const ja: Record<TranslationKey, string> = {
  apply: "適用",
  backToDocuments: "ドキュメント一覧に戻る",
  blankDocument: "空白のドキュメント",
  blockQuote: "引用",
  bold: "太字 (Ctrl+B)",
  bulletList: "箇条書き",
  cancel: "キャンセル",
  centerAlign: "中央揃え",
  characterCount: "{count} 文字",
  characterCountSingular: "{count} 文字",
  caseSensitive: "大文字小文字を区別",
  checklist: "チェックリスト",
  closeFind: "検索を閉じる",
  codeBlock: "コードブロック",
  collapse: "折りたたむ",
  daysAgo: "{count} 日前",
  doc: "ドキュメント",
  deleteDocumentConfirm: "このドキュメントを削除しますか？",
  deleteDocumentTitle: "ドキュメントを削除",
  expand: "展開",
  export: "エクスポート",
  exportHtml: "HTML (.html)",
  exportMarkdown: "Markdown (.md)",
  exportPlainText: "テキスト (.txt)",
  find: "検索",
  findAndReplace: "検索と置換",
  findPlaceholder: "検索",
  font: "フォント",
  heading1: "見出し 1",
  heading2: "見出し 2",
  heading3: "見出し 3",
  highlight: "ハイライト",
  horizontalRule: "水平線",
  imagePlaceholder: "画像 URL を貼り付け...",
  insert: "挿入",
  insertImage: "画像を挿入",
  insertTable: "表を挿入",
  italic: "斜体 (Ctrl+I)",
  language: "言語",
  leftAlign: "左揃え",
  link: "リンク",
  linkPlaceholder: "リンクを貼り付けまたは入力...",
  matchCounter: "{current}/{total}",
  nextMatch: "次へ",
  noDocumentsDescription: "最初のドキュメントを作成して始めましょう。",
  noDocumentsTitle: "まだドキュメントはありません",
  noHeadings: "見出しはありません",
  noMatches: "結果なし",
  numberedList: "番号付きリスト",
  office: "オフィス",
  openOffice: "オフィスを開く",
  opened: "最終更新: {date}",
  previousMatch: "前へ",
  outline: "アウトライン",
  recentDocuments: "最近のドキュメント",
  redo: "やり直し (Ctrl+Y)",
  replace: "置換",
  replaceAll: "すべて置換",
  replacePlaceholder: "置換",
  reset: "リセット",
  rightAlign: "右揃え",
  saved: "保存済み",
  saveFailed: "保存に失敗しました",
  saving: "保存中...",
  searchDocuments: "ドキュメントを検索",
  sheet: "シート",
  size: "サイズ",
  slide: "スライド",
  startNewDocument: "新しいドキュメントを作成",
  strikethrough: "取り消し線",
  subscript: "下付き",
  superscript: "上付き",
  textColor: "文字色",
  themeDark: "ダークモード",
  themeLight: "ライトモード",
  today: "今日",
  toggleTheme: "テーマを切り替え",
  typeSomething: "入力してください...",
  underline: "下線 (Ctrl+U)",
  undo: "元に戻す (Ctrl+Z)",
  untitled: "無題",
  untitledDocument: "無題のドキュメント",
  wordCount: "{count} 語",
  wordCountSingular: "{count} 語",
  yesterday: "昨日",
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
