import { Component, createSignal, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { CellFormat } from "../types";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useI18n } from "../i18n";

interface ToolbarProps {
  format: CellFormat | undefined;
  onFormatChange: (format: Partial<CellFormat>) => void;
  title: string;
  onTitleChange: (title: string) => void;
  onNavigateHome: () => void;
  onImportCsv?: (content: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export const Toolbar: Component<ToolbarProps> = (props) => {
  const { t } = useI18n();
  const [showTextColor, setShowTextColor] = createSignal(false);
  const [showBgColor, setShowBgColor] = createSignal(false);
  const [editingTitle, setEditingTitle] = createSignal(false);
  const [titleValue, setTitleValue] = createSignal(props.title);

  const fmt = () => props.format ?? {};

  const colors = [
    "#ef4444",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
    "#ffffff",
    "#a3a3a3",
    "#525252",
    "#000000",
    "#fca5a5",
    "#fdba74",
    "#fde047",
    "#86efac",
    "#93c5fd",
    "#c4b5fd",
    "#f9a8d4",
  ];

  const fontSizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32];

  const numberFormats = () => [
    { label: t("general"), value: "" },
    { label: t("number"), value: "#,##0.00" },
    { label: t("percent"), value: "0%" },
    { label: t("date"), value: "yyyy-mm-dd" },
    { label: t("currency"), value: "$#,##0.00" },
  ];

  const ToolBtn = (btnProps: {
    active?: boolean;
    onClick: () => void;
    children: JSX.Element;
    title?: string;
  }) => (
    <button
      type="button"
      class={`flex h-7 min-w-[28px] items-center justify-center rounded px-1.5 text-xs transition-colors ${
        btnProps.active
          ? "bg-neutral-600 text-white"
          : "text-neutral-300 hover:bg-neutral-700"
      }`}
      onClick={btnProps.onClick}
      title={btnProps.title}
    >
      {btnProps.children}
    </button>
  );

  const Separator = () => <div class="mx-1 h-5 w-px bg-neutral-600" />;

  return (
    <div class="flex items-center gap-1 border-b border-neutral-700 bg-neutral-800 px-3 py-1.5">
      {/* Home button */}
      <button
        type="button"
        class="mr-2 flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
        onClick={props.onNavigateHome}
        title={t("backToList")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {/* Title */}
      <Show
        when={editingTitle()}
        fallback={
          <button
            type="button"
            class="mr-4 max-w-[200px] truncate text-sm font-medium text-neutral-100 hover:text-white"
            onClick={() => {
              setTitleValue(props.title);
              setEditingTitle(true);
            }}
          >
            {props.title}
          </button>
        }
      >
        <input
          class="mr-4 w-48 rounded bg-neutral-700 px-2 py-0.5 text-sm text-neutral-100 outline-none ring-1 ring-blue-500"
          value={titleValue()}
          onInput={(e) => setTitleValue(e.currentTarget.value)}
          onBlur={() => {
            if (titleValue().trim()) props.onTitleChange(titleValue().trim());
            setEditingTitle(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (titleValue().trim()) {
                props.onTitleChange(titleValue().trim());
              }
              setEditingTitle(false);
            }
            if (e.key === "Escape") setEditingTitle(false);
          }}
          ref={(el) => setTimeout(() => el.focus(), 0)}
        />
      </Show>

      <Separator />

      {/* Undo */}
      <ToolBtn
        onClick={() => props.onUndo?.()}
        title={t("undo")}
        active={false}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          style={{ opacity: props.canUndo ? 1 : 0.35 }}
        >
          <path d="M3 7v6h6" />
          <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
        </svg>
      </ToolBtn>

      {/* Redo */}
      <ToolBtn
        onClick={() => props.onRedo?.()}
        title={t("redo")}
        active={false}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          style={{ opacity: props.canRedo ? 1 : 0.35 }}
        >
          <path d="M21 7v6h-6" />
          <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
        </svg>
      </ToolBtn>

      <Separator />

      {/* Import CSV */}
      <ToolBtn
        onClick={() => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".csv,text/csv";
          input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === "string") {
                props.onImportCsv?.(reader.result);
              }
            };
            reader.readAsText(file);
          };
          input.click();
        }}
        title={t("importCsv")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </ToolBtn>

      <Separator />

      {/* Bold */}
      <ToolBtn
        active={fmt().bold}
        onClick={() => props.onFormatChange({ bold: !fmt().bold })}
        title={t("bold")}
      >
        <span class="font-bold">B</span>
      </ToolBtn>

      {/* Italic */}
      <ToolBtn
        active={fmt().italic}
        onClick={() => props.onFormatChange({ italic: !fmt().italic })}
        title={t("italic")}
      >
        <span class="italic">I</span>
      </ToolBtn>

      {/* Underline */}
      <ToolBtn
        active={fmt().underline}
        onClick={() => props.onFormatChange({ underline: !fmt().underline })}
        title={t("underline")}
      >
        <span class="underline">U</span>
      </ToolBtn>

      <Separator />

      {/* Font size */}
      <select
        class="h-7 rounded bg-neutral-700 px-1 text-xs text-neutral-200 outline-none"
        value={fmt().fontSize ?? 13}
        onChange={(e) =>
          props.onFormatChange({ fontSize: Number(e.currentTarget.value) })}
        title={t("fontSize")}
      >
        {fontSizes.map((size) => (
          <option value={size}>
            {size}
          </option>
        ))}
      </select>

      <Separator />

      {/* Text color */}
      <div class="relative">
        <ToolBtn
          onClick={() => {
            setShowTextColor(!showTextColor());
            setShowBgColor(false);
          }}
          title={t("textColor")}
        >
          <span
            class="text-sm font-bold"
            style={{ color: fmt().textColor ?? "#e5e5e5" }}
          >
            A
          </span>
        </ToolBtn>
        <Show when={showTextColor()}>
          <div class="absolute top-8 left-0 z-50 grid grid-cols-6 gap-1 rounded-lg border border-neutral-600 bg-neutral-800 p-2 shadow-xl">
            {colors.map((color) => (
              <button
                type="button"
                class="h-5 w-5 rounded border border-neutral-600 transition-transform hover:scale-110"
                style={{ background: color }}
                onClick={() => {
                  props.onFormatChange({ textColor: color });
                  setShowTextColor(false);
                }}
              />
            ))}
            <button
              type="button"
              class="col-span-6 mt-1 rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-600"
              onClick={() => {
                props.onFormatChange({ textColor: undefined });
                setShowTextColor(false);
              }}
            >
              {t("reset")}
            </button>
          </div>
        </Show>
      </div>

      {/* Background color */}
      <div class="relative">
        <ToolBtn
          onClick={() => {
            setShowBgColor(!showBgColor());
            setShowTextColor(false);
          }}
          title={t("backgroundColor")}
        >
          <div
            class="h-4 w-4 rounded"
            style={{
              background: fmt().bgColor ?? "#404040",
              border: "1px solid #525252",
            }}
          />
        </ToolBtn>
        <Show when={showBgColor()}>
          <div class="absolute top-8 left-0 z-50 grid grid-cols-6 gap-1 rounded-lg border border-neutral-600 bg-neutral-800 p-2 shadow-xl">
            {colors.map((color) => (
              <button
                type="button"
                class="h-5 w-5 rounded border border-neutral-600 transition-transform hover:scale-110"
                style={{ background: color }}
                onClick={() => {
                  props.onFormatChange({ bgColor: color });
                  setShowBgColor(false);
                }}
              />
            ))}
            <button
              type="button"
              class="col-span-6 mt-1 rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-600"
              onClick={() => {
                props.onFormatChange({ bgColor: undefined });
                setShowBgColor(false);
              }}
            >
              {t("reset")}
            </button>
          </div>
        </Show>
      </div>

      <Separator />

      {/* Alignment */}
      <ToolBtn
        active={fmt().textAlign === "left" || !fmt().textAlign}
        onClick={() => props.onFormatChange({ textAlign: "left" })}
        title={t("alignLeft")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="17" y1="10" x2="3" y2="10" />
          <line x1="21" y1="6" x2="3" y2="6" />
          <line x1="21" y1="14" x2="3" y2="14" />
          <line x1="17" y1="18" x2="3" y2="18" />
        </svg>
      </ToolBtn>
      <ToolBtn
        active={fmt().textAlign === "center"}
        onClick={() => props.onFormatChange({ textAlign: "center" })}
        title={t("alignCenter")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="18" y1="10" x2="6" y2="10" />
          <line x1="21" y1="6" x2="3" y2="6" />
          <line x1="21" y1="14" x2="3" y2="14" />
          <line x1="18" y1="18" x2="6" y2="18" />
        </svg>
      </ToolBtn>
      <ToolBtn
        active={fmt().textAlign === "right"}
        onClick={() => props.onFormatChange({ textAlign: "right" })}
        title={t("alignRight")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="21" y1="10" x2="7" y2="10" />
          <line x1="21" y1="6" x2="3" y2="6" />
          <line x1="21" y1="14" x2="3" y2="14" />
          <line x1="21" y1="18" x2="7" y2="18" />
        </svg>
      </ToolBtn>

      <Separator />

      {/* Number format */}
      <select
        class="h-7 rounded bg-neutral-700 px-1 text-xs text-neutral-200 outline-none"
        value={fmt().numberFormat ?? ""}
        onChange={(e) =>
          props.onFormatChange({
            numberFormat: e.currentTarget.value || undefined,
          })}
        title={t("numberFormat")}
      >
        {numberFormats().map((nf) => (
          <option value={nf.value}>
            {nf.label}
          </option>
        ))}
      </select>

      <div class="flex-1" />
      <LanguageSwitcher />
    </div>
  );
};
