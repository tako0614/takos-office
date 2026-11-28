import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { useLocation } from "@solidjs/router";
import type { Editor } from "@tiptap/core";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Download,
  FileCode,
  FileText,
  FileType,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo,
  Strikethrough,
  Subscript,
  Superscript,
  Table as TableIcon,
  Type,
  Underline,
  Undo,
} from "lucide-solid";
import { useI18n } from "../i18n";
import { theme } from "../../../shared/lib/theme";
import {
  isImeComposing,
  isValidHttpUrl,
  restoreFocus,
} from "../../../shared/lib/dialog-a11y";
import {
  downloadDocument,
  type ExportFormat,
} from "../lib/export-download.ts";

const FONT_FAMILIES = [
  "Arial",
  "Times New Roman",
  "Georgia",
  "Verdana",
  "Courier New",
  "Comic Sans MS",
];

const FONT_SIZES = [
  "8",
  "10",
  "11",
  "12",
  "14",
  "16",
  "18",
  "20",
  "24",
  "28",
  "36",
  "48",
  "72",
];

const COLORS = [
  "#000000",
  "#434343",
  "#666666",
  "#999999",
  "#b7b7b7",
  "#cccccc",
  "#d9d9d9",
  "#ffffff",
  "#980000",
  "#ff0000",
  "#ff9900",
  "#ffff00",
  "#00ff00",
  "#00ffff",
  "#4a86e8",
  "#0000ff",
  "#9900ff",
  "#ff00ff",
  "#e6b8af",
  "#f4cccc",
  "#fce5cd",
  "#fff2cc",
  "#d9ead3",
  "#d0e0e3",
  "#c9daf8",
  "#cfe2f3",
  "#d9d2e9",
  "#ead1dc",
  "#dd7e6b",
  "#ea9999",
  "#f9cb9c",
  "#ffe599",
  "#b6d7a8",
  "#a2c4c9",
  "#a4c2f4",
  "#9fc5e8",
  "#b4a7d6",
  "#d5a6bd",
  "#cc4125",
  "#e06666",
];

interface ToolbarProps {
  editor: Editor | null;
  documentTitle?: string;
  documentContent?: string;
}

export default function Toolbar(props: ToolbarProps) {
  const { t } = useI18n();
  const location = useLocation();
  const [showLinkInput, setShowLinkInput] = createSignal(false);
  const [linkUrl, setLinkUrl] = createSignal("");
  const [linkError, setLinkError] = createSignal(false);
  const [showImageInput, setShowImageInput] = createSignal(false);
  const [imageUrl, setImageUrl] = createSignal("");
  const [imageError, setImageError] = createSignal(false);
  const [showTextColor, setShowTextColor] = createSignal(false);
  const [showHighlight, setShowHighlight] = createSignal(false);
  const [showExport, setShowExport] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);
  const [exportError, setExportError] = createSignal(false);
  const [exportWarning, setExportWarning] = createSignal(false);
  const [exportReady, setExportReady] = createSignal(false);
  const [lastExportFormat, setLastExportFormat] = createSignal<ExportFormat | null>(null);
  let textColorRef: HTMLDivElement | undefined;
  let textColorBtnRef: HTMLButtonElement | undefined;
  let highlightRef: HTMLDivElement | undefined;
  let highlightBtnRef: HTMLButtonElement | undefined;
  let exportRef: HTMLDivElement | undefined;
  let exportBtnRef: HTMLButtonElement | undefined;
  let exportMenuRef: HTMLDivElement | undefined;
  let linkBtnRef: HTMLButtonElement | undefined;
  let linkInputRef: HTMLInputElement | undefined;
  let imageBtnRef: HTMLButtonElement | undefined;
  let imageInputRef: HTMLInputElement | undefined;
  let exportController: AbortController | undefined;
  let exportReadyTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    exportController?.abort();
    if (exportReadyTimer) clearTimeout(exportReadyTimer);
  });
  createEffect(() => {
    void location.pathname;
    void location.search;
    exportController?.abort();
    exportController = undefined;
    if (exportReadyTimer) clearTimeout(exportReadyTimer);
    setExporting(false);
    setExportError(false);
    setExportWarning(false);
    setExportReady(false);
    setShowExport(false);
  });

  createEffect(() => {
    if (showLinkInput()) {
      queueMicrotask(() => {
        linkInputRef?.focus();
        linkInputRef?.select();
      });
    }
  });

  createEffect(() => {
    if (showImageInput()) {
      queueMicrotask(() => {
        imageInputRef?.focus();
        imageInputRef?.select();
      });
    }
  });

  createEffect(() => {
    const anyPopupOpen =
      showTextColor() || showHighlight() || showExport();
    if (!anyPopupOpen) return;
    const isExport = showExport();
    const activeWrapper = showTextColor()
      ? textColorRef
      : showHighlight()
      ? highlightRef
      : exportRef;
    const opener = showTextColor()
      ? textColorBtnRef
      : showHighlight()
      ? highlightBtnRef
      : exportBtnRef;
    if (isExport) {
      queueMicrotask(() => {
        exportMenuRef?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
      });
    }
    const onPointerDown = (e: PointerEvent) => {
      if (
        activeWrapper &&
        e.target instanceof Node &&
        !activeWrapper.contains(e.target)
      ) {
        closePopups();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closePopups();
        queueMicrotask(() => restoreFocus(opener));
        return;
      }
      if (
        isExport &&
        (e.key === "ArrowDown" ||
          e.key === "ArrowUp" ||
          e.key === "Home" ||
          e.key === "End")
      ) {
        const items = Array.from(
          exportMenuRef?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
            [],
        );
        if (items.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        const activeIdx = items.indexOf(document.activeElement as HTMLElement);
        let nextIdx = 0;
        if (e.key === "ArrowDown") {
          nextIdx = activeIdx >= 0 ? (activeIdx + 1) % items.length : 0;
        } else if (e.key === "ArrowUp") {
          nextIdx = activeIdx >= 0
            ? (activeIdx - 1 + items.length) % items.length
            : items.length - 1;
        } else if (e.key === "Home") {
          nextIdx = 0;
        } else {
          nextIdx = items.length - 1;
        }
        items[nextIdx]?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  // Prefer the live editor's JSON (freshest, before autosave debounce) and fall
  // back to the persisted document content when the editor isn't ready yet.
  const currentContent = (): string => {
    const editor = props.editor;
    if (editor && !editor.isDestroyed) return JSON.stringify(editor.getJSON());
    return props.documentContent ?? "";
  };

  const handleExport = async (format: ExportFormat) => {
    if (exporting()) return;
    const controller = new AbortController();
    exportController = controller;
    if (exportReadyTimer) clearTimeout(exportReadyTimer);
    setLastExportFormat(format);
    setExporting(true);
    setExportError(false);
    setExportWarning(false);
    setExportReady(false);
    setShowExport(false);
    try {
      const result = await downloadDocument(format, props.documentTitle ?? "", currentContent(), controller.signal);
      if (!controller.signal.aborted) {
        setExportWarning(result.hasUnsupportedContent);
        setExportReady(true);
        exportReadyTimer = setTimeout(() => setExportReady(false), 4000);
      }
    } catch {
      if (!controller.signal.aborted) setExportError(true);
    } finally {
      if (!controller.signal.aborted) setExporting(false);
      if (exportController === controller) exportController = undefined;
    }
  };

  const [tick, setTick] = createSignal(0);

  createEffect(() => {
    const editor = props.editor;
    if (!editor) return;
    const handler = () => setTick((t) => t + 1);
    editor.on("selectionUpdate", handler);
    editor.on("transaction", handler);
    setTick((t) => t + 1);
    onCleanup(() => {
      editor.off("selectionUpdate", handler);
      editor.off("transaction", handler);
    });
  });

  const isActive = (name: string, attrs?: Record<string, unknown>) => {
    tick();
    return props.editor?.isActive(name, attrs) ?? false;
  };

  const isTextAlignActive = (align: "left" | "center" | "right") => {
    tick();
    return (
      props.editor?.getAttributes("paragraph").textAlign === align ||
      props.editor?.getAttributes("heading").textAlign === align
    );
  };

  const currentFontFamily = () => {
    tick();
    const family = props.editor?.getAttributes("textStyle")?.fontFamily;
    return typeof family === "string" ? family : "";
  };

  const currentFontSize = () => {
    tick();
    const raw = props.editor?.getAttributes("textStyle")?.fontSize;
    if (typeof raw !== "string") return "";
    const match = raw.match(/^(\d+(?:\.\d+)?)/);
    return match ? match[1] : "";
  };

  const currentTextColor = () => {
    tick();
    const color = props.editor?.getAttributes("textStyle")?.color;
    return typeof color === "string" && color ? color : "";
  };

  const btn = (active: boolean) =>
    `inline-flex min-h-10 min-w-10 sm:min-h-7 sm:min-w-7 items-center justify-center p-1.5 rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
      active
        ? "bg-blue-100 text-blue-700 dark:bg-blue-500/25 dark:text-blue-300"
        : "text-gray-600 hover:bg-gray-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
    }`;

  const sep = () => "hidden sm:block w-px h-5 bg-gray-300 dark:bg-neutral-700 mx-0.5 self-center";

  const closePopups = () => {
    setShowTextColor(false);
    setShowHighlight(false);
    setShowLinkInput(false);
    setLinkError(false);
    setShowImageInput(false);
    setImageError(false);
    setShowExport(false);
  };

  const handleSetLink = () => {
    const url = linkUrl().trim();
    if (url) {
      if (!isValidHttpUrl(url)) {
        setLinkError(true);
        return;
      }
      props.editor?.chain().focus().setLink({ href: url }).run();
    } else {
      props.editor?.chain().focus().unsetLink().run();
    }
    setLinkError(false);
    setShowLinkInput(false);
    setLinkUrl("");
  };

  const handleInsertImage = () => {
    const url = imageUrl().trim();
    if (!url || !isValidHttpUrl(url)) {
      setImageError(true);
      return;
    }
    props.editor?.chain().focus().setImage({ src: url }).run();
    setImageError(false);
    setShowImageInput(false);
    setImageUrl("");
  };

  return (
    <div
      class="flex flex-col border-b border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-800"
    >
      <div class="flex items-center gap-0.5 px-2 py-1 flex-wrap">
        {/* Undo / Redo */}
        <button
          type="button"
          class={btn(false)}
          onClick={() => props.editor?.chain().focus().undo().run()}
          title={t("undo")}
          aria-label={t("undo")}
        >
          <Undo size={16} />
        </button>
        <button
          type="button"
          class={btn(false)}
          onClick={() => props.editor?.chain().focus().redo().run()}
          title={t("redo")}
          aria-label={t("redo")}
        >
          <Redo size={16} />
        </button>

        <div class={sep()} />

        {/* Font family */}
        <select
          class="toolbar-select min-h-10 sm:min-h-7"
          style="min-width:7.5rem"
          aria-label={t("font")}
          value={currentFontFamily()}
          onChange={(e) => {
            const val = e.currentTarget.value;
            if (val) props.editor?.chain().focus().setFontFamily(val).run();
            else props.editor?.chain().focus().unsetFontFamily().run();
          }}
        >
          <option value="">{t("font")}</option>
          <For each={FONT_FAMILIES}>
            {(f) => <option value={f} style={{ "font-family": f }}>{f}</option>}
          </For>
        </select>

        {/* Font size */}
        <select
          class="toolbar-select min-h-10 sm:min-h-7"
          style="min-width:5rem"
          aria-label={t("size")}
          value={currentFontSize()}
          onChange={(e) => {
            const val = e.currentTarget.value;
            if (val) {
              props.editor?.chain().focus().setMark("textStyle", {
                fontSize: val + "pt",
              }).run();
            }
          }}
        >
          <option value="">{t("size")}</option>
          <For each={FONT_SIZES}>
            {(s) => <option value={s}>{s}</option>}
          </For>
        </select>

        <div class={sep()} />

        {/* Text formatting */}
        <button
          type="button"
          class={btn(isActive("bold"))}
          onClick={() => props.editor?.chain().focus().toggleBold().run()}
          title={t("bold")}
          aria-label={t("bold")}
          aria-pressed={isActive("bold")}
        >
          <Bold size={16} />
        </button>
        <button
          type="button"
          class={btn(isActive("italic"))}
          onClick={() => props.editor?.chain().focus().toggleItalic().run()}
          title={t("italic")}
          aria-label={t("italic")}
          aria-pressed={isActive("italic")}
        >
          <Italic size={16} />
        </button>
        <button
          type="button"
          class={btn(isActive("underline"))}
          onClick={() => props.editor?.chain().focus().toggleUnderline().run()}
          title={t("underline")}
          aria-label={t("underline")}
          aria-pressed={isActive("underline")}
        >
          <Underline size={16} />
        </button>
        <button
          type="button"
          class={btn(isActive("strike"))}
          onClick={() => props.editor?.chain().focus().toggleStrike().run()}
          title={t("strikethrough")}
          aria-label={t("strikethrough")}
          aria-pressed={isActive("strike")}
        >
          <Strikethrough size={16} />
        </button>

        {/* Text color */}
        <div ref={textColorRef} class="relative">
          <button
            ref={textColorBtnRef}
            type="button"
            class={btn(false)}
            onClick={() => {
              const next = !showTextColor();
              closePopups();
              setShowTextColor(next);
            }}
            title={t("textColor")}
            aria-label={t("textColor")}
            aria-haspopup="true"
            aria-expanded={showTextColor()}
          >
            <div class="flex flex-col items-center">
              <Type size={14} />
              <div
                class="w-3.5 h-1 rounded-sm mt-0.5"
                style={{
                  background: currentTextColor() ||
                    (theme() === "dark" ? "#e5e5e5" : "#202124"),
                }}
              />
            </div>
          </button>
          <Show when={showTextColor()}>
            <div class="absolute top-full left-0 mt-1 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-gray-200 dark:border-neutral-700 z-50">
              <ColorPicker
                onSelect={(c) => {
                  props.editor?.chain().focus().setColor(c).run();
                  setShowTextColor(false);
                }}
                onClear={() => {
                  props.editor?.chain().focus().unsetColor().run();
                  setShowTextColor(false);
                }}
              />
            </div>
          </Show>
        </div>

        {/* Highlight */}
        <div ref={highlightRef} class="relative">
          <button
            ref={highlightBtnRef}
            type="button"
            class={btn(isActive("highlight"))}
            onClick={() => {
              const next = !showHighlight();
              closePopups();
              setShowHighlight(next);
            }}
            title={t("highlight")}
            aria-label={t("highlight")}
            aria-pressed={isActive("highlight")}
            aria-haspopup="true"
            aria-expanded={showHighlight()}
          >
            <Highlighter size={16} />
          </button>
          <Show when={showHighlight()}>
            <div class="absolute top-full left-0 mt-1 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-gray-200 dark:border-neutral-700 z-50">
              <ColorPicker
                onSelect={(c) => {
                  props.editor?.chain().focus().toggleHighlight({ color: c })
                    .run();
                  setShowHighlight(false);
                }}
                onClear={() => {
                  props.editor?.chain().focus().unsetHighlight().run();
                  setShowHighlight(false);
                }}
              />
            </div>
          </Show>
        </div>

        <div class={sep()} />

        {/* Superscript / Subscript */}
        <button
          type="button"
          class={btn(isActive("superscript"))}
          onClick={() =>
            props.editor?.chain().focus().toggleSuperscript().run()}
          title={t("superscript")}
          aria-label={t("superscript")}
          aria-pressed={isActive("superscript")}
        >
          <Superscript size={16} />
        </button>
        <button
          type="button"
          class={btn(isActive("subscript"))}
          onClick={() => props.editor?.chain().focus().toggleSubscript().run()}
          title={t("subscript")}
          aria-label={t("subscript")}
          aria-pressed={isActive("subscript")}
        >
          <Subscript size={16} />
        </button>

        <div class={sep()} />

        {/* Headings */}
        <button
          type="button"
          class={btn(isActive("heading", { level: 1 }))}
          onClick={() =>
            props.editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          title={t("heading1")}
          aria-label={t("heading1")}
          aria-pressed={isActive("heading", { level: 1 })}
        >
          <Heading1 size={16} />
        </button>
        <button
          type="button"
          class={btn(isActive("heading", { level: 2 }))}
          onClick={() =>
            props.editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          title={t("heading2")}
          aria-label={t("heading2")}
          aria-pressed={isActive("heading", { level: 2 })}
        >
          <Heading2 size={16} />
        </button>
        <button
          type="button"
          class={btn(isActive("heading", { level: 3 }))}
          onClick={() =>
            props.editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          title={t("heading3")}
          aria-label={t("heading3")}
          aria-pressed={isActive("heading", { level: 3 })}
        >
          <Heading3 size={16} />
        </button>

        <div class={sep()} />

        {/* Lists */}
        <button
          type="button"
          class={btn(isActive("bulletList"))}
          onClick={() => props.editor?.chain().focus().toggleBulletList().run()}
          title={t("bulletList")}
          aria-label={t("bulletList")}
          aria-pressed={isActive("bulletList")}
        >
          <List size={16} />
        </button>
        <button
          type="button"
          class={btn(isActive("orderedList"))}
          onClick={() =>
            props.editor?.chain().focus().toggleOrderedList().run()}
          title={t("numberedList")}
          aria-label={t("numberedList")}
          aria-pressed={isActive("orderedList")}
        >
          <ListOrdered size={16} />
        </button>
        <button
          type="button"
          class={btn(isActive("taskList"))}
          onClick={() => props.editor?.chain().focus().toggleTaskList().run()}
          title={t("checklist")}
          aria-label={t("checklist")}
          aria-pressed={isActive("taskList")}
        >
          <ListChecks size={16} />
        </button>

        <div class={sep()} />

        {/* Alignment */}
        <button
          type="button"
          class={btn(isTextAlignActive("left"))}
          onClick={() =>
            props.editor?.chain().focus().setTextAlign("left").run()}
          title={t("leftAlign")}
          aria-label={t("leftAlign")}
          aria-pressed={isTextAlignActive("left")}
        >
          <AlignLeft size={16} />
        </button>
        <button
          type="button"
          class={btn(isTextAlignActive("center"))}
          onClick={() =>
            props.editor?.chain().focus().setTextAlign("center").run()}
          title={t("centerAlign")}
          aria-label={t("centerAlign")}
          aria-pressed={isTextAlignActive("center")}
        >
          <AlignCenter size={16} />
        </button>
        <button
          type="button"
          class={btn(isTextAlignActive("right"))}
          onClick={() =>
            props.editor?.chain().focus().setTextAlign("right").run()}
          title={t("rightAlign")}
          aria-label={t("rightAlign")}
          aria-pressed={isTextAlignActive("right")}
        >
          <AlignRight size={16} />
        </button>

        <div class={sep()} />

        {/* Block elements */}
        <button
          type="button"
          class={btn(isActive("blockquote"))}
          onClick={() => props.editor?.chain().focus().toggleBlockquote().run()}
          title={t("blockQuote")}
          aria-label={t("blockQuote")}
          aria-pressed={isActive("blockquote")}
        >
          <Quote size={16} />
        </button>
        <button
          type="button"
          class={btn(isActive("codeBlock"))}
          onClick={() => props.editor?.chain().focus().toggleCodeBlock().run()}
          title={t("codeBlock")}
          aria-label={t("codeBlock")}
          aria-pressed={isActive("codeBlock")}
        >
          <Code size={16} />
        </button>
        <button
          type="button"
          class={btn(false)}
          onClick={() =>
            props.editor?.chain().focus().setHorizontalRule().run()}
          title={t("horizontalRule")}
          aria-label={t("horizontalRule")}
        >
          <Minus size={16} />
        </button>

        <div class={sep()} />

        {/* Link */}
        <button
          ref={linkBtnRef}
          type="button"
          class={btn(isActive("link"))}
          onClick={() => {
            if (isActive("link")) {
              props.editor?.chain().focus().unsetLink().run();
            } else {
              const next = !showLinkInput();
              closePopups();
              setShowLinkInput(next);
            }
          }}
          title={t("link")}
          aria-label={t("link")}
          aria-pressed={isActive("link")}
          aria-expanded={showLinkInput()}
        >
          <LinkIcon size={16} />
        </button>

        {/* Image */}
        <button
          ref={imageBtnRef}
          type="button"
          class={btn(false)}
          onClick={() => {
            const next = !showImageInput();
            closePopups();
            setShowImageInput(next);
          }}
          title={t("insertImage")}
          aria-label={t("insertImage")}
          aria-expanded={showImageInput()}
        >
          <ImageIcon size={16} />
        </button>

        {/* Table */}
        <button
          type="button"
          class={btn(false)}
          onClick={() => props.editor?.chain().focus().insertTable({
            rows: 3,
            cols: 3,
            withHeaderRow: true,
          }).run()}
          title={t("insertTable")}
          aria-label={t("insertTable")}
        >
          <TableIcon size={16} />
        </button>

        {/* Export menu — pushed to the right edge of the toolbar row */}
        <div ref={exportRef} class="relative ml-auto">
          <button
            ref={exportBtnRef}
            type="button"
            class="flex min-h-10 min-w-10 sm:min-h-7 sm:min-w-0 items-center justify-center gap-1 px-2 py-1.5 rounded text-gray-700 dark:text-neutral-300 text-sm hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
            onClick={() => {
              const next = !showExport();
              closePopups();
              setShowExport(next);
            }}
            title={t("export")}
            aria-label={t(exporting() ? "exporting" : "export")}
            disabled={exporting()}
            aria-busy={exporting()}
            aria-haspopup="menu"
            aria-expanded={showExport()}
          >
            <Download size={16} />
            <span class="hidden sm:inline">{t(exporting() ? "exporting" : "export")}</span>
          </button>
          <Show when={showExport()}>
            <div
              ref={exportMenuRef}
              class="absolute top-full right-0 mt-1 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-gray-200 dark:border-neutral-700 z-50 py-1 min-w-44"
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                class="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
                onClick={() => void handleExport("docx")}
              >
                <FileText size={16} class="text-gray-500 dark:text-neutral-400" />
                {t("exportDocx")}
              </button>
              <button
                type="button"
                role="menuitem"
                class="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
                onClick={() => handleExport("markdown")}
              >
                <FileText size={16} class="text-gray-500 dark:text-neutral-400" />
                {t("exportMarkdown")}
              </button>
              <button
                type="button"
                role="menuitem"
                class="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
                onClick={() => handleExport("text")}
              >
                <FileType size={16} class="text-gray-500 dark:text-neutral-400" />
                {t("exportPlainText")}
              </button>
              <button
                type="button"
                role="menuitem"
                class="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-neutral-200 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
                onClick={() => handleExport("html")}
              >
                <FileCode size={16} class="text-gray-500 dark:text-neutral-400" />
                {t("exportHtml")}
              </button>
            </div>
          </Show>
        </div>
      </div>

      <Show when={exportError()}>
        <div role="alert" class="flex flex-wrap items-center gap-3 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          <span>{t("exportFailed")}</span>
          <Show when={lastExportFormat()}>
            {(fmt) => (
              <button
                type="button"
                class="rounded border border-red-300 dark:border-red-700 px-2.5 py-1 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/40"
                onClick={() => void handleExport(fmt())}
              >
                {t("retry")}
              </button>
            )}
          </Show>
        </div>
      </Show>
      <Show when={exportWarning()}>
        <p role="status" class="px-3 py-2 text-sm text-amber-800 dark:text-amber-300">{t("fileFormattingWarning")}</p>
      </Show>
      <div role="status" aria-live="polite" class="sr-only">
        {exporting() ? t("exporting") : exportReady() ? t("exportReady") : ""}
      </div>

      {/* Link URL input */}
      <Show when={showLinkInput()}>
        <div class="flex flex-wrap items-center gap-2 px-3 py-1.5 border-t border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
          <input
            ref={linkInputRef}
            type="url"
            placeholder={t("linkPlaceholder")}
            aria-label={t("link")}
            aria-invalid={linkError() ? "true" : undefined}
            aria-describedby={linkError() ? "docs-link-error" : undefined}
            value={linkUrl()}
            onInput={(e) => {
              setLinkUrl(e.currentTarget.value);
              if (linkError()) setLinkError(false);
            }}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === "Enter") handleSetLink();
              if (e.key === "Escape") {
                e.stopPropagation();
                setShowLinkInput(false);
                setLinkError(false);
                queueMicrotask(() => restoreFocus(linkBtnRef));
              }
            }}
            class="min-w-[180px] flex-1 bg-gray-50 dark:bg-neutral-800 text-gray-800 dark:text-neutral-100 text-sm px-3 py-1.5 rounded-md border border-gray-300 dark:border-neutral-600 outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
          <button
            type="button"
            onClick={handleSetLink}
            class="min-h-10 sm:min-h-9 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
          >
            {t("apply")}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowLinkInput(false);
              setLinkError(false);
              queueMicrotask(() => restoreFocus(linkBtnRef));
            }}
            class="min-h-10 sm:min-h-9 px-3 py-1.5 text-gray-600 dark:text-neutral-300 text-sm rounded-md hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
          >
            {t("cancel")}
          </button>
          <Show when={linkError()}>
            <p id="docs-link-error" role="alert" class="basis-full text-xs text-red-700 dark:text-red-300">
              {t("invalidUrl")}
            </p>
          </Show>
        </div>
      </Show>

      {/* Image URL input */}
      <Show when={showImageInput()}>
        <div class="flex flex-wrap items-center gap-2 px-3 py-1.5 border-t border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
          <input
            ref={imageInputRef}
            type="url"
            placeholder={t("imagePlaceholder")}
            aria-label={t("insertImage")}
            aria-invalid={imageError() ? "true" : undefined}
            aria-describedby={imageError() ? "docs-image-error" : undefined}
            value={imageUrl()}
            onInput={(e) => {
              setImageUrl(e.currentTarget.value);
              if (imageError()) setImageError(false);
            }}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === "Enter") handleInsertImage();
              if (e.key === "Escape") {
                e.stopPropagation();
                setShowImageInput(false);
                setImageError(false);
                queueMicrotask(() => restoreFocus(imageBtnRef));
              }
            }}
            class="min-w-[180px] flex-1 bg-gray-50 dark:bg-neutral-800 text-gray-800 dark:text-neutral-100 text-sm px-3 py-1.5 rounded-md border border-gray-300 dark:border-neutral-600 outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
          <button
            type="button"
            onClick={handleInsertImage}
            class="min-h-10 sm:min-h-9 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
          >
            {t("insert")}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowImageInput(false);
              setImageError(false);
              queueMicrotask(() => restoreFocus(imageBtnRef));
            }}
            class="min-h-10 sm:min-h-9 px-3 py-1.5 text-gray-600 dark:text-neutral-300 text-sm rounded-md hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
          >
            {t("cancel")}
          </button>
          <Show when={imageError()}>
            <p id="docs-image-error" role="alert" class="basis-full text-xs text-red-700 dark:text-red-300">
              {t("invalidUrl")}
            </p>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Color picker sub-component
// ---------------------------------------------------------------------------

function ColorPicker(
  props: { onSelect: (color: string) => void; onClear: () => void },
) {
  const { t } = useI18n();

  return (
    <div style="width:194px">
      <button
        type="button"
        class="w-full text-left px-3 py-1.5 text-xs text-gray-500 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
        onClick={props.onClear}
      >
        {t("reset")}
      </button>
      <div class="color-grid">
        <For each={COLORS}>
          {(c) => (
            <button
              type="button"
              class="color-swatch"
              style={{ background: c }}
              onClick={() => props.onSelect(c)}
              aria-label={c}
              title={c}
            />
          )}
        </For>
      </div>
    </div>
  );
}
