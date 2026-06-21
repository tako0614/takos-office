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
  add: "Add",
  align: "Align",
  alignCenter: "Center",
  alignLeft: "Left",
  alignRight: "Right",
  arrow: "Arrow",
  backToList: "Back to list",
  cancel: "Cancel",
  color: "Color",
  create: "Create",
  createPresentation: "Create Presentation",
  defaultTextElement: "Text",
  delete: "Delete",
  deletePresentation: "Delete",
  deletePresentationConfirm: "Delete this presentation?",
  done: "Done",
  editText: "Edit Text",
  ellipse: "Ellipse",
  enterImageUrl: "Enter image URL:",
  escToExit: "ESC to exit",
  fill: "Fill",
  fontSize: "Font Size",
  image: "Image",
  imageUrl: "URL",
  insert: "Insert:",
  language: "Language",
  loading: "Loading...",
  newPresentation: "New Presentation",
  newPresentationButton: "+ New Presentation",
  noPresentationsDescription: "Create your first presentation to get started",
  noPresentationsTitle: "No presentations yet",
  position: "Position",
  present: "Present",
  properties: "Properties",
  rect: "Rect",
  redo: "Redo",
  rotation: "Rotation",
  selectElementToEdit: "Select an element to edit its properties",
  shape: "Shape",
  size: "Size",
  slideBackground: "Slide Background",
  slideCount: "Slide {current} of {total}",
  slides: "Slides",
  stroke: "Stroke",
  strokeWidth: "Stroke W",
  text: "Text",
  titlePlaceholder: "Presentation title",
  triangle: "Triangle",
  undo: "Undo",
  untitledPresentation: "Untitled Presentation",
} as const;

type TranslationKey = keyof typeof en;

const ja: Record<TranslationKey, string> = {
  add: "追加",
  align: "配置",
  alignCenter: "中央",
  alignLeft: "左",
  alignRight: "右",
  arrow: "矢印",
  backToList: "一覧に戻る",
  cancel: "キャンセル",
  color: "色",
  create: "作成",
  createPresentation: "プレゼンテーションを作成",
  defaultTextElement: "テキスト",
  delete: "削除",
  deletePresentation: "削除",
  deletePresentationConfirm: "このプレゼンテーションを削除しますか？",
  done: "完了",
  editText: "テキストを編集",
  ellipse: "楕円",
  enterImageUrl: "画像 URL を入力:",
  escToExit: "ESC で終了",
  fill: "塗り",
  fontSize: "フォントサイズ",
  image: "画像",
  imageUrl: "URL",
  insert: "挿入:",
  language: "言語",
  loading: "読み込み中...",
  newPresentation: "新しいプレゼンテーション",
  newPresentationButton: "+ 新規プレゼンテーション",
  noPresentationsDescription: "最初のプレゼンテーションを作成して始めましょう",
  noPresentationsTitle: "まだプレゼンテーションはありません",
  position: "位置",
  present: "発表",
  properties: "プロパティ",
  rect: "四角形",
  redo: "やり直し",
  rotation: "回転",
  selectElementToEdit: "編集する要素を選択してください",
  shape: "図形",
  size: "サイズ",
  slideBackground: "スライド背景",
  slideCount: "スライド {current} / {total}",
  slides: "スライド",
  stroke: "線",
  strokeWidth: "線幅",
  text: "テキスト",
  titlePlaceholder: "プレゼンテーションのタイトル",
  triangle: "三角形",
  undo: "元に戻す",
  untitledPresentation: "無題のプレゼンテーション",
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
