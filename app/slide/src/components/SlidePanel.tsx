import { createEffect, For, onMount } from "solid-js";
import type { Slide } from "../types";
import { renderThumbnail } from "../lib/canvas-renderer";
import { useI18n } from "../i18n";

interface SlidePanelProps {
  slides: Slide[];
  selectedIndex: number;
  onSelectSlide: (index: number) => void;
  onAddSlide: () => void;
  onDeleteSlide: (index: number) => void;
  onReorderSlide: (fromIndex: number, toIndex: number) => void;
}

function SlideThumbnail(props: {
  slide: Slide;
  index: number;
  selected: boolean;
  onClick: () => void;
  onDelete: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}) {
  let thumbRef: HTMLDivElement | undefined;

  const updateThumb = () => {
    if (!thumbRef) return;
    thumbRef.innerHTML = "";
    const canvas = renderThumbnail(props.slide, 192);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.borderRadius = "4px";
    thumbRef.appendChild(canvas);
  };

  onMount(updateThumb);
  createEffect(updateThumb);

  return (
    <div
      class="group relative p-1 cursor-pointer rounded-lg transition-all duration-150"
      classList={{
        "bg-blue-600/30 ring-2 ring-blue-500": props.selected,
        "hover:bg-gray-700": !props.selected,
      }}
      draggable
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onClick={props.onClick}
    >
      <div class="flex items-start gap-2">
        <span class="text-xs text-gray-500 mt-1 w-4 text-right shrink-0">
          {props.index + 1}
        </span>
        <div
          ref={thumbRef}
          class="flex-1 rounded overflow-hidden border border-gray-600"
          style={{ "aspect-ratio": "16/9" }}
        />
      </div>
      {/* Delete button */}
      <button
        type="button"
        class="absolute top-2 right-2 w-5 h-5 rounded bg-red-600/80 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          props.onDelete();
        }}
      >
        x
      </button>
    </div>
  );
}

export default function SlidePanel(props: SlidePanelProps) {
  const { t } = useI18n();
  let dragFromIndex: number | null = null;

  return (
    <div class="w-56 bg-gray-800 border-r border-gray-700 flex flex-col h-full">
      <div class="p-3 border-b border-gray-700 flex items-center justify-between">
        <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          {t("slides")}
        </span>
        <button
          type="button"
          class="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded transition-colors"
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
              index={i()}
              selected={i() === props.selectedIndex}
              onClick={() => props.onSelectSlide(i())}
              onDelete={() => props.onDeleteSlide(i())}
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
