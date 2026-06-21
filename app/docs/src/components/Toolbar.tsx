import { createSignal, For, onCleanup, Show } from "solid-js";
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
  const [showLinkInput, setShowLinkInput] = createSignal(false);
  const [linkUrl, setLinkUrl] = createSignal("");
  const [showImageInput, setShowImageInput] = createSignal(false);
  const [imageUrl, setImageUrl] = createSignal("");
  const [showTextColor, setShowTextColor] = createSignal(false);
  const [showHighlight, setShowHighlight] = createSignal(false);
  const [showExport, setShowExport] = createSignal(false);

  // Prefer the live editor's JSON (freshest, before autosave debounce) and fall
  // back to the persisted document content when the editor isn't ready yet.
  const currentContent = (): string => {
    const editor = props.editor;
    if (editor && !editor.isDestroyed) return JSON.stringify(editor.getJSON());
    return props.documentContent ?? "";
  };

  const handleExport = (format: ExportFormat) => {
    downloadDocument(format, props.documentTitle ?? "", currentContent());
    setShowExport(false);
  };

  const [, setTick] = createSignal(0);

  const setupListener = () => {
    const editor = props.editor;
    if (!editor) return;
    const handler = () => setTick((t) => t + 1);
    editor.on("selectionUpdate", handler);
    editor.on("transaction", handler);
    onCleanup(() => {
      editor.off("selectionUpdate", handler);
      editor.off("transaction", handler);
    });
  };

  const checkEditor = setInterval(() => {
    if (props.editor) {
      setupListener();
      clearInterval(checkEditor);
    }
  }, 100);
  onCleanup(() => clearInterval(checkEditor));

  const isActive = (name: string, attrs?: Record<string, unknown>) =>
    props.editor?.isActive(name, attrs) ?? false;

  const isTextAlignActive = (align: "left" | "center" | "right") =>
    props.editor?.getAttributes("paragraph").textAlign === align ||
    props.editor?.getAttributes("heading").textAlign === align;

  const btn = (active: boolean) =>
    `p-1.5 rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
      active
        ? "bg-blue-100 text-blue-700 dark:bg-blue-500/25 dark:text-blue-300"
        : "text-gray-600 hover:bg-gray-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
    }`;

  const sep = () => "w-px h-5 bg-gray-300 dark:bg-neutral-700 mx-0.5 self-center";

  const closePopups = () => {
    setShowTextColor(false);
    setShowHighlight(false);
    setShowLinkInput(false);
    setShowImageInput(false);
    setShowExport(false);
  };

  const handleSetLink = () => {
    const url = linkUrl().trim();
    if (url) {
      props.editor?.chain().focus().setLink({ href: url }).run();
    } else {
      props.editor?.chain().focus().unsetLink().run();
    }
    setShowLinkInput(false);
    setLinkUrl("");
  };

  const handleInsertImage = () => {
    const url = imageUrl().trim();
    if (url) props.editor?.chain().focus().setImage({ src: url }).run();
    setShowImageInput(false);
    setImageUrl("");
  };

  return (
    <div class="flex flex-col border-b border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-800">
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
          class="toolbar-select"
          style="width:7.5rem"
          aria-label={t("font")}
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
          class="toolbar-select"
          style="width:3.5rem"
          aria-label={t("size")}
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
        >
          <Bold size={16} />
        </button>
        <button
          type="button"
          class={btn(isActive("italic"))}
          onClick={() => props.editor?.chain().focus().toggleItalic().run()}
          title={t("italic")}
          aria-label={t("italic")}
        >
          <Italic size={16} />
        </button>
        <button
          type="button"
          class={btn(isActive("underline"))}
          onClick={() => props.editor?.chain().focus().toggleUnderline().run()}
          title={t("underline")}
          aria-label={t("underline")}
        >
          <Underline size={16} />
        </button>
        <button
          type="button"
          class={btn(isActive("strike"))}
          onClick={() => props.editor?.chain().focus().toggleStrike().run()}
          title={t("strikethrough")}
          aria-label={t("strikethrough")}
        >
          <Strikethrough size={16} />
        </button>

        {/* Text color */}
        <div class="relative">
          <button
            type="button"
            class={btn(false)}
            onClick={() => {
              closePopups();
              setShowTextColor(!showTextColor());
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
                  background: props.editor?.getAttributes("textStyle")?.color ||
                    "#000",
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
        <div class="relative">
          <button
            type="button"
            class={btn(isActive("highlight"))}
            onClick={() => {
              closePopups();
              setShowHighlight(!showHighlight());
            }}
            title={t("highlight")}
            aria-label={t("highlight")}
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
        >
          <Superscript size={16} />
        </button>
        <button
          type="button"
          class={btn(isActive("subscript"))}
          onClick={() => props.editor?.chain().focus().toggleSubscript().run()}
          title={t("subscript")}
          aria-label={t("subscript")}
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
        >
          <ListOrdered size={16} />
        </button>
        <button
          type="button"
          class={btn(isActive("taskList"))}
          onClick={() => props.editor?.chain().focus().toggleTaskList().run()}
          title={t("checklist")}
          aria-label={t("checklist")}
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
        >
          <Quote size={16} />
        </button>
        <button
          type="button"
          class={btn(isActive("codeBlock"))}
          onClick={() => props.editor?.chain().focus().toggleCodeBlock().run()}
          title={t("codeBlock")}
          aria-label={t("codeBlock")}
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
          type="button"
          class={btn(isActive("link"))}
          onClick={() => {
            if (isActive("link")) {
              props.editor?.chain().focus().unsetLink().run();
            } else {
              closePopups();
              setShowLinkInput(!showLinkInput());
            }
          }}
          title={t("link")}
          aria-label={t("link")}
        >
          <LinkIcon size={16} />
        </button>

        {/* Image */}
        <button
          type="button"
          class={btn(false)}
          onClick={() => {
            closePopups();
            setShowImageInput(!showImageInput());
          }}
          title={t("insertImage")}
          aria-label={t("insertImage")}
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
        <div class="relative ml-auto">
          <button
            type="button"
            class="flex items-center gap-1 px-2 py-1.5 rounded text-gray-700 dark:text-neutral-300 text-sm hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
            onClick={() => {
              const next = !showExport();
              closePopups();
              setShowExport(next);
            }}
            title={t("export")}
            aria-haspopup="menu"
            aria-expanded={showExport()}
          >
            <Download size={16} />
            <span class="hidden sm:inline">{t("export")}</span>
          </button>
          <Show when={showExport()}>
            <div
              class="absolute top-full right-0 mt-1 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-gray-200 dark:border-neutral-700 z-50 py-1 min-w-44"
              role="menu"
            >
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

      {/* Link URL input */}
      <Show when={showLinkInput()}>
        <div class="flex items-center gap-2 px-3 py-1.5 border-t border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
          <input
            type="url"
            placeholder={t("linkPlaceholder")}
            value={linkUrl()}
            onInput={(e) => setLinkUrl(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSetLink();
              if (e.key === "Escape") setShowLinkInput(false);
            }}
            class="flex-1 bg-gray-50 dark:bg-neutral-800 text-gray-800 dark:text-neutral-100 text-sm px-3 py-1.5 rounded-md border border-gray-300 dark:border-neutral-600 outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
          <button
            type="button"
            onClick={handleSetLink}
            class="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
          >
            {t("apply")}
          </button>
          <button
            type="button"
            onClick={() => setShowLinkInput(false)}
            class="px-3 py-1.5 text-gray-500 dark:text-neutral-400 text-sm rounded-md hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
          >
            {t("cancel")}
          </button>
        </div>
      </Show>

      {/* Image URL input */}
      <Show when={showImageInput()}>
        <div class="flex items-center gap-2 px-3 py-1.5 border-t border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
          <input
            type="url"
            placeholder={t("imagePlaceholder")}
            value={imageUrl()}
            onInput={(e) => setImageUrl(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleInsertImage();
              if (e.key === "Escape") setShowImageInput(false);
            }}
            class="flex-1 bg-gray-50 dark:bg-neutral-800 text-gray-800 dark:text-neutral-100 text-sm px-3 py-1.5 rounded-md border border-gray-300 dark:border-neutral-600 outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
          <button
            type="button"
            onClick={handleInsertImage}
            class="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
          >
            {t("insert")}
          </button>
          <button
            type="button"
            onClick={() => setShowImageInput(false)}
            class="px-3 py-1.5 text-gray-500 dark:text-neutral-400 text-sm rounded-md hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
          >
            {t("cancel")}
          </button>
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
              title={c}
            />
          )}
        </For>
      </div>
    </div>
  );
}
