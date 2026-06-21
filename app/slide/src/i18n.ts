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
  addSlide: "Add slide",
  align: "Align",
  alignCenter: "Center",
  alignLeft: "Left",
  alignRight: "Right",
  arrow: "Arrow",
  backToList: "Back to list",
  bold: "Bold",
  bringForward: "Bring Forward",
  bringToFront: "Bring to Front",
  cancel: "Cancel",
  close: "Close",
  color: "Color",
  create: "Create",
  createPresentation: "Create Presentation",
  defaultTextElement: "Text",
  delete: "Delete",
  deletePresentation: "Delete",
  deletePresentationConfirm: "Delete this presentation?",
  deletePresentationLabel: "Delete presentation: {title}",
  deleteSlide: "Delete slide {number}",
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
  italic: "Italic",
  language: "Language",
  loading: "Loading...",
  loadingPresentations: "Loading presentations",
  newPresentation: "New Presentation",
  newPresentationButton: "+ New Presentation",
  officeDocs: "Documents",
  officeNavLabel: "Takos Office apps",
  officeSheets: "Sheets",
  officeSlides: "Slides",
  noPresentationsDescription: "Create your first presentation to get started",
  noPresentationsTitle: "No presentations yet",
  position: "Position",
  present: "Present",
  presentationTitleLabel: "Presentation title",
  properties: "Properties",
  rect: "Rect",
  redo: "Redo",
  rotation: "Rotation",
  selectElementToEdit: "Select an element to edit its properties",
  sendBackward: "Send Backward",
  sendToBack: "Send to Back",
  shape: "Shape",
  shortcutDeleteElement: "Delete selected element",
  shortcutDeselect: "Deselect / close dialog",
  shortcutExitPresent: "Exit presentation",
  shortcutFirstSlide: "Jump to first slide",
  shortcutLastSlide: "Jump to last slide",
  shortcutNextSlide: "Next slide",
  shortcutOpenHelp: "Open this help",
  shortcutPrevSlide: "Previous slide",
  shortcutRedo: "Redo",
  shortcutUndo: "Undo",
  shortcutsEditorGroup: "Editing",
  shortcutsHelpButton: "Keyboard shortcuts",
  shortcutsPresentGroup: "Presenting",
  shortcutsTitle: "Keyboard shortcuts",
  size: "Size",
  slideBackground: "Slide Background",
  slideCount: "Slide {current} of {total}",
  slides: "Slides",
  speakerNotes: "Speaker Notes",
  speakerNotesPlaceholder: "Notes for this slide (not shown to the audience)",
  stroke: "Stroke",
  strokeWidth: "Stroke W",
  text: "Text",
  themeDark: "Dark mode",
  themeLight: "Light mode",
  titlePlaceholder: "Presentation title",
  toggleTheme: "Toggle theme",
  triangle: "Triangle",
  undo: "Undo",
  untitledPresentation: "Untitled Presentation",
  zOrder: "Layer",
} as const;

type TranslationKey = keyof typeof en;

const ja: Record<TranslationKey, string> = {
  add: "追加",
  addSlide: "スライドを追加",
  align: "配置",
  alignCenter: "中央",
  alignLeft: "左",
  alignRight: "右",
  arrow: "矢印",
  backToList: "一覧に戻る",
  bold: "太字",
  bringForward: "前面へ",
  bringToFront: "最前面へ",
  cancel: "キャンセル",
  close: "閉じる",
  color: "色",
  create: "作成",
  createPresentation: "プレゼンテーションを作成",
  defaultTextElement: "テキスト",
  delete: "削除",
  deletePresentation: "削除",
  deletePresentationConfirm: "このプレゼンテーションを削除しますか？",
  deletePresentationLabel: "プレゼンテーションを削除: {title}",
  deleteSlide: "スライド {number} を削除",
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
  italic: "斜体",
  language: "言語",
  loading: "読み込み中...",
  loadingPresentations: "プレゼンテーションを読み込み中",
  newPresentation: "新しいプレゼンテーション",
  newPresentationButton: "+ 新規プレゼンテーション",
  officeDocs: "ドキュメント",
  officeNavLabel: "Takos Office アプリ",
  officeSheets: "シート",
  officeSlides: "スライド",
  noPresentationsDescription: "最初のプレゼンテーションを作成して始めましょう",
  noPresentationsTitle: "まだプレゼンテーションはありません",
  position: "位置",
  present: "発表",
  presentationTitleLabel: "プレゼンテーションのタイトル",
  properties: "プロパティ",
  rect: "四角形",
  redo: "やり直し",
  rotation: "回転",
  selectElementToEdit: "編集する要素を選択してください",
  sendBackward: "背面へ",
  sendToBack: "最背面へ",
  shape: "図形",
  shortcutDeleteElement: "選択した要素を削除",
  shortcutDeselect: "選択解除 / ダイアログを閉じる",
  shortcutExitPresent: "発表を終了",
  shortcutFirstSlide: "最初のスライドへ",
  shortcutLastSlide: "最後のスライドへ",
  shortcutNextSlide: "次のスライド",
  shortcutOpenHelp: "このヘルプを開く",
  shortcutPrevSlide: "前のスライド",
  shortcutRedo: "やり直し",
  shortcutUndo: "元に戻す",
  shortcutsEditorGroup: "編集",
  shortcutsHelpButton: "キーボードショートカット",
  shortcutsPresentGroup: "発表",
  shortcutsTitle: "キーボードショートカット",
  size: "サイズ",
  slideBackground: "スライド背景",
  slideCount: "スライド {current} / {total}",
  slides: "スライド",
  speakerNotes: "スピーカーノート",
  speakerNotesPlaceholder: "このスライドのノート（聴衆には表示されません）",
  stroke: "線",
  strokeWidth: "線幅",
  text: "テキスト",
  themeDark: "ダークモード",
  themeLight: "ライトモード",
  titlePlaceholder: "プレゼンテーションのタイトル",
  toggleTheme: "テーマを切り替え",
  triangle: "三角形",
  undo: "元に戻す",
  untitledPresentation: "無題のプレゼンテーション",
  zOrder: "レイヤー",
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
