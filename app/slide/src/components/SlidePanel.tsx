import { createEffect, For, onCleanup, onMount, Show } from "solid-js";
import type { Slide, SlideSize } from "../types";
import { observeSlideImages, renderThumbnail } from "../lib/canvas-renderer";
import { t, useI18n } from "../i18n";
import { logicalSlideSize } from "../../../shared/lib/slide-size.ts";

interface SlidePanelProps {
  slides: Slide[];
  slideSize?: SlideSize;
  selectedIndex: number;
  onSelectSlide: (index: number) => void;
  onAddSlide: () => void;
  onDeleteSlide: (index: number) => void;
  onReorderSlide: (fromIndex: number, toIndex: number) => void;
}

function SlideThumbnail(props: {
  slide: Slide;
  slideSize?: SlideSize;
  index: number;
  total: number;
  selected: boolean;
  canDelete: boolean;
  onClick: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}) {
  let thumbRef: HTMLDivElement | undefined;

  const updateThumb = () => {
    images.update([props.slide]);
    if (!thumbRef) return;
    thumbRef.innerHTML = "";
    const canvas = renderThumbnail(props.slide, 192, props.slideSize);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.borderRadius = "4px";
    thumbRef.appendChild(canvas);
  };

  const images = observeSlideImages(updateThumb);
  onCleanup(() => images.close());
  onMount(updateThumb);
  createEffect(updateThumb);

  return (
    <div
      class="group relative rounded-lg transition-all duration-150"
      classList={{
        "bg-blue-100 dark:bg-blue-600/30 ring-2 ring-blue-500": props.selected,
        "hover:bg-gray-100 dark:hover:bg-gray-700": !props.selected,
      }}
      draggable
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
    >
      <button
        type="button"
        class="w-full p-1 text-left rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        aria-label={t("slideNumberLabel", { number: props.index + 1 })}
        aria-current={props.selected ? "true" : undefined}
        onClick={props.onClick}
      >
        <div class="flex items-start gap-2">
          <span
            class="text-xs mt-1 w-4 text-right shrink-0"
            classList={{
              "font-semibold text-blue-900 dark:text-blue-100": props.selected,
              "text-gray-600 dark:text-gray-300": !props.selected,
            }}
          >
            {props.index + 1}
          </span>
          <div
            ref={thumbRef}
            class="flex-1 rounded overflow-hidden border border-gray-300 dark:border-gray-600"
            style={{ "aspect-ratio": `${logicalSlideSize(props.slideSize).width}/${logicalSlideSize(props.slideSize).height}` }}
          />
        </div>
      </button>
      {/* Reorder + Delete controls */}
      <Show when={props.total > 1}>
        <div class="mt-1 flex items-center justify-end gap-1.5 px-1 pb-1 sm:mt-0 sm:px-0 sm:pb-0 sm:absolute sm:top-2 sm:right-2 sm:gap-1 sm:opacity-0 sm:group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            disabled={props.index === 0}
            class="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 sm:w-6 sm:h-6 rounded bg-gray-800/85 text-white text-xs flex items-center justify-center hover:bg-gray-700 disabled:opacity-35 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            aria-label={t("moveSlideUp", { number: props.index + 1 })}
            title={t("moveSlideUp", { number: props.index + 1 })}
            onClick={() => props.onMoveUp()}
          >
            ↑
          </button>
          <button
            type="button"
            disabled={props.index === props.total - 1}
            class="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 sm:w-6 sm:h-6 rounded bg-gray-800/85 text-white text-xs flex items-center justify-center hover:bg-gray-700 disabled:opacity-35 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            aria-label={t("moveSlideDown", { number: props.index + 1 })}
            title={t("moveSlideDown", { number: props.index + 1 })}
            onClick={() => props.onMoveDown()}
          >
            ↓
          </button>
          <Show when={props.canDelete}>
            <button
              type="button"
              class="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 sm:w-6 sm:h-6 rounded bg-red-600/90 text-white text-xs flex items-center justify-center hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              aria-label={t("deleteSlide", { number: props.index + 1 })}
              title={t("deleteSlide", { number: props.index + 1 })}
              onClick={() => props.onDelete()}
            >
              ×
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export default function SlidePanel(props: SlidePanelProps) {
  const { t } = useI18n();
  let dragFromIndex: number | null = null;

  return (
    <div class="w-56 max-w-full bg-white border-r border-gray-200 dark:bg-gray-800 dark:border-gray-700 flex flex-col h-full">
      <div class="p-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <span class="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
          {t("slides")}
        </span>
        <button
          type="button"
          class="min-h-11 sm:min-h-8 text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          aria-label={t("addSlide")}
          onClick={() => props.onAddSlide()}
        >
          + {t("add")}
        </button>
      </div>
      <div class="flex-1 overflow-y-auto p-2 space-y-1">
        <For each={props.slides}>
          {(slide, i) => (
            <SlideThumbnail
              slide={slide}
              slideSize={props.slideSize}
              index={i()}
              total={props.slides.length}
              selected={i() === props.selectedIndex}
              canDelete={props.slides.length > 1}
              onClick={() => props.onSelectSlide(i())}
              onDelete={() => props.onDeleteSlide(i())}
              onMoveUp={() => {
                if (i() > 0) props.onReorderSlide(i(), i() - 1);
              }}
              onMoveDown={() => {
                if (i() < props.slides.length - 1) props.onReorderSlide(i(), i() + 1);
              }}
              onDragStart={(e) => {
                dragFromIndex = i();
                e.dataTransfer?.setData("text/plain", String(i()));
              }}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFromIndex !== null && dragFromIndex !== i()) {
                  props.onReorderSlide(dragFromIndex, i());
                }
                dragFromIndex = null;
              }}
            />
          )}
        </For>
      </div>
    </div>
  );
}
