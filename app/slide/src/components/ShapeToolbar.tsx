import { createSignal, onCleanup, onMount } from "solid-js";
import { useI18n } from "../i18n";
import {
  observeHorizontalScrollEdges,
  setupToolbarRovingTabIndex,
  type HorizontalScrollEdges,
} from "../../../shared/lib/dialog-a11y";

interface ShapeToolbarProps {
  onInsertText: () => void;
  onInsertShape: (shape: "rect" | "ellipse" | "triangle" | "arrow") => void;
  onInsertImage: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onPresent: () => void;
  onExportPptx: () => void;
  exporting: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  presentationTitle: string;
  onTitleChange: (title: string) => void;
}

function ToolButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger" | "primary";
}) {
  const variant = () => props.variant ?? "default";
  return (
    <button
      type="button"
      class="shrink-0 whitespace-nowrap min-h-11 sm:min-h-7 px-3 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      classList={{
        "bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200":
          variant() === "default",
        "bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-700/60 dark:hover:bg-red-600/80 dark:text-red-200":
          variant() === "danger",
        "bg-blue-600 hover:bg-blue-500 text-white": variant() === "primary",
      }}
      onClick={() => props.onClick()}
      disabled={props.disabled}
    >
      {props.label}
    </button>
  );
}

export default function ShapeToolbar(props: ShapeToolbarProps) {
  const { t } = useI18n();
  const [scrollEdges, setScrollEdges] = createSignal<HorizontalScrollEdges>({
    canScrollLeft: false,
    canScrollRight: false,
  });
  let toolbarRowRef: HTMLDivElement | undefined;

  onMount(() => {
    if (!toolbarRowRef) return;
    const stopRoving = setupToolbarRovingTabIndex(toolbarRowRef);
    const stopEdges = observeHorizontalScrollEdges(toolbarRowRef, setScrollEdges);
    onCleanup(() => {
      stopRoving();
      stopEdges();
    });
  });

  return (
    <div class="shrink-0 bg-white border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700 flex flex-col sm:flex-row sm:flex-wrap sm:items-center px-3 sm:px-4 py-1.5 sm:py-2 gap-1.5 sm:gap-2">
      {/* Title — stays visible while mobile action strip scrolls horizontally */}
      <input
        class="min-h-11 sm:min-h-7 bg-transparent text-sm font-semibold text-gray-900 dark:text-gray-100 border-none outline-none hover:bg-gray-100 focus:bg-gray-100 dark:hover:bg-gray-700 dark:focus:bg-gray-700 px-2 py-1 rounded min-w-0 w-full sm:w-48 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500"
        value={props.presentationTitle}
        aria-label={t("presentationTitleLabel")}
        onInput={(e) => props.onTitleChange(e.currentTarget.value)}
      />

      <div class="hidden sm:block w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

      <div class="relative min-w-0 sm:flex-1">
      <div
        ref={toolbarRowRef}
        role="toolbar"
        aria-label={t("officeSlides")}
        class="flex items-center gap-1.5 sm:gap-2 flex-nowrap overflow-x-auto sm:flex-wrap sm:overflow-visible sm:flex-1"
      >
        {/* Insert tools */}
        <span class="hidden sm:inline text-xs text-gray-600 dark:text-gray-300 mr-1">{t("insert")}</span>
        <ToolButton label={t("text")} onClick={() => props.onInsertText()} />
        <ToolButton
          label={t("rect")}
          onClick={() => props.onInsertShape("rect")}
        />
        <ToolButton
          label={t("ellipse")}
          onClick={() => props.onInsertShape("ellipse")}
        />
        <ToolButton
          label={t("triangle")}
          onClick={() => props.onInsertShape("triangle")}
        />
        <ToolButton
          label={t("arrow")}
          onClick={() => props.onInsertShape("arrow")}
        />
        <ToolButton label={t("image")} onClick={() => props.onInsertImage()} />

        <div class="hidden sm:block w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

        {/* Edit tools */}
        <ToolButton
          label={t("undo")}
          onClick={() => props.onUndo()}
          disabled={!props.canUndo}
        />
        <ToolButton
          label={t("redo")}
          onClick={() => props.onRedo()}
          disabled={!props.canRedo}
        />
        <ToolButton
          label={t("delete")}
          onClick={() => props.onDelete()}
          disabled={!props.hasSelection}
          variant="danger"
        />

        <div class="hidden sm:block flex-1" />

        {/* Export & Present */}
        <ToolButton
          label={t(props.exporting ? "exporting" : "exportPptx")}
          onClick={() => props.onExportPptx()}
          disabled={props.exporting}
        />
        <ToolButton
          label={t("present")}
          onClick={() => props.onPresent()}
          variant="primary"
        />
      </div>
      <div
        aria-hidden="true"
        data-scroll-fade="left"
        class="pointer-events-none absolute inset-y-0 left-0 w-7 bg-gradient-to-r from-white via-white/75 to-transparent dark:from-gray-800 dark:via-gray-800/75 sm:hidden transition-opacity duration-150"
        classList={{
          "opacity-100": scrollEdges().canScrollLeft,
          "opacity-0": !scrollEdges().canScrollLeft,
        }}
      />
      <div
        aria-hidden="true"
        data-scroll-fade="right"
        class="pointer-events-none absolute inset-y-0 right-0 w-7 bg-gradient-to-l from-white via-white/75 to-transparent dark:from-gray-800 dark:via-gray-800/75 sm:hidden transition-opacity duration-150"
        classList={{
          "opacity-100": scrollEdges().canScrollRight,
          "opacity-0": !scrollEdges().canScrollRight,
        }}
      />
      </div>
    </div>
  );
}
