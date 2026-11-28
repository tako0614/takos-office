import { FileText, Trash2 } from "lucide-solid";
import type { Document } from "../types";
import { dateLocale, useI18n } from "../i18n";
import { extractDocumentPreview } from "../lib/document-preview";

interface DocumentCardProps {
  document: Document;
  onClick: () => void;
  onDelete: (e: MouseEvent) => void;
}

export default function DocumentCard(props: DocumentCardProps) {
  const { t } = useI18n();
  const preview = () => extractDocumentPreview(props.document.content);

  const formatDate = (iso: string) => {
    const date = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / 86400000);

    if (days === 0) return t("today");
    if (days === 1) return t("yesterday");
    if (days < 7) return t("daysAgo", { count: days });
    return date.toLocaleDateString(dateLocale(), {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  };

  return (
    <div
      class="group relative rounded-lg border border-gray-200 dark:border-neutral-700 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md dark:hover:shadow-black/40 transition-all overflow-hidden bg-white dark:bg-neutral-900"
    >
      <button
        type="button"
        onClick={() => props.onClick()}
        class="block w-full text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
      >
        {/* Preview area */}
        <div class="h-40 bg-white dark:bg-neutral-800 border-b border-gray-100 dark:border-neutral-700 p-4 overflow-hidden">
          <div class="text-xs leading-relaxed text-gray-600 dark:text-neutral-300 line-clamp-6">
            {preview() || props.document.title}
          </div>
        </div>

        {/* Info */}
        <div class="px-3 py-2.5">
          <h3 class="text-sm font-medium text-gray-800 dark:text-neutral-100 truncate">
            {props.document.title}
          </h3>
          <div class="flex items-center gap-1.5 mt-1">
            <FileText size={14} class="text-blue-600 dark:text-blue-400 shrink-0" />
            <span class="text-xs text-gray-500 dark:text-neutral-400">
              {t("opened", { date: formatDate(props.document.updatedAt) })}
            </span>
          </div>
        </div>
      </button>

      <button
        type="button"
        class="absolute top-2 right-2 inline-flex min-h-10 min-w-10 sm:min-h-8 sm:min-w-8 items-center justify-center p-2 rounded-full bg-white/90 dark:bg-neutral-800/90 text-gray-500 dark:text-neutral-400 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:bg-red-50 dark:hover:bg-red-500/15 hover:text-red-600 dark:hover:text-red-400 transition-all shadow-sm"
        onClick={(e) => {
          e.stopPropagation();
          props.onDelete(e);
        }}
        title={t("deleteDocumentTitle")}
        aria-label={`${t("deleteDocumentTitle")}: ${props.document.title}`}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
