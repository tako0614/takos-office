import { createEffect, createSignal, onMount } from "solid-js";
import type { Presentation } from "../types";
import { renderThumbnail } from "../lib/canvas-renderer";
import { dateLocale, useI18n } from "../i18n";

interface PresentationCardProps {
  presentation: Presentation;
  onClick: () => void;
  onDelete: (e: MouseEvent) => void;
}

export default function PresentationCard(props: PresentationCardProps) {
  const { t } = useI18n();
  let thumbnailRef: HTMLDivElement | undefined;
  const [hovered, setHovered] = createSignal(false);

  const updateThumbnail = () => {
    if (!thumbnailRef) return;
    thumbnailRef.innerHTML = "";
    const slide = props.presentation.slides[0];
    if (slide) {
      const canvas = renderThumbnail(slide, 280);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.objectFit = "cover";
      canvas.style.borderRadius = "8px 8px 0 0";
      thumbnailRef.appendChild(canvas);
    }
  };

  onMount(updateThumbnail);
  createEffect(updateThumbnail);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(dateLocale(), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div
      class="bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700 rounded-xl border cursor-pointer transition-all duration-200 overflow-hidden group"
      classList={{
        "border-blue-500 shadow-lg shadow-blue-500/20": hovered(),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => props.onClick()}
    >
      <div
        ref={thumbnailRef}
        class="w-full bg-gray-100 dark:bg-gray-700"
        style={{ "aspect-ratio": "16/9" }}
      />
      <div class="p-4">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
          {props.presentation.title}
        </h3>
        <div class="flex items-center justify-between mt-2">
          <span class="text-xs text-gray-500 dark:text-gray-400">
            {formatDate(props.presentation.updatedAt)}
          </span>
          <button
            type="button"
            class="text-xs text-red-500 dark:text-red-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-600 dark:hover:text-red-300 transition-opacity px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            aria-label={t("deletePresentationLabel", {
              title: props.presentation.title,
            })}
            onClick={(e) => {
              e.stopPropagation();
              props.onDelete(e);
            }}
          >
            {t("deletePresentation")}
          </button>
        </div>
      </div>
    </div>
  );
}
