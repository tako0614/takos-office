import { Component } from "solid-js";
import type { Spreadsheet } from "../types";
import { dateLocale, useI18n } from "../i18n";

interface SpreadsheetCardProps {
  spreadsheet: Spreadsheet;
  onClick: () => void;
  onDelete: (e: Event) => void;
}

export const SpreadsheetCard: Component<SpreadsheetCardProps> = (props) => {
  const { t } = useI18n();

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(dateLocale(), {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const sheetCount = () => props.spreadsheet.sheets.length;
  const cellCount = () =>
    props.spreadsheet.sheets.reduce(
      (sum, s) => sum + Object.keys(s.cells).length,
      0,
    );

  return (
    <div
      class="group relative flex flex-col rounded-lg border border-gray-200 bg-white transition-all hover:border-gray-300 hover:shadow-md dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-neutral-500 dark:hover:shadow-none overflow-hidden"
    >
      <button
        type="button"
        class="flex flex-1 flex-col p-5 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
        onClick={props.onClick}
      >
        {/* Icon */}
        <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600/20 text-emerald-600 dark:text-emerald-400">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="3" y1="15" x2="21" y2="15" />
            <line x1="9" y1="3" x2="9" y2="21" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </div>

        <h3 class="mb-1 pr-7 truncate text-base font-semibold text-gray-900 dark:text-neutral-100">
          {props.spreadsheet.title}
        </h3>

        <div class="mb-3 flex gap-3 text-xs text-gray-600 dark:text-neutral-400">
          <span>
            {t(sheetCount() === 1 ? "sheetCountSingular" : "sheetCount", {
              count: sheetCount(),
            })}
          </span>
          <span>
            {t(cellCount() === 1 ? "cellCountSingular" : "cellCount", {
              count: cellCount(),
            })}
          </span>
        </div>

        <div class="mt-auto text-xs text-gray-500 dark:text-neutral-400">
          {t("updated", { date: formatDate(props.spreadsheet.updatedAt) })}
        </div>
      </button>

      {/* Delete button */}
      <button
        type="button"
        class="absolute top-3 right-3 inline-flex min-h-10 min-w-10 sm:min-h-8 sm:min-w-8 items-center justify-center rounded-md p-2 text-gray-500 opacity-80 sm:opacity-0 transition-opacity hover:bg-gray-100 hover:text-red-600 sm:group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-red-400"
        onClick={props.onDelete}
        title={t("deleteSpreadsheetTitle")}
        aria-label={`${t("deleteSpreadsheetTitle")}: ${props.spreadsheet.title}`}
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
          aria-hidden="true"
        >
          <path d="M3 6h18" />
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        </svg>
      </button>
    </div>
  );
};
