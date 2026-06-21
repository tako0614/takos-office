import { For } from "solid-js";
import { FileText, Presentation, Sheet } from "lucide-solid";
import { useI18n } from "../i18n";

/**
 * Cross-editor "Office" navigation for the docs editor.
 *
 * Docs is one SPA in the takos-office suite (mounted at `/docs`); Slides and
 * Sheets are *separate* SPAs at `/slide` and `/sheet`. So these are plain
 * anchor links that do a full navigation across apps — NOT SolidJS router
 * links — and every href preserves the current Workspace via `withSpace`.
 */

type AppKey = "docs" | "slide" | "sheet";

interface AppLink {
  key: AppKey;
  href: string;
  labelKey: "doc" | "slide" | "sheet";
  icon: typeof FileText;
}

// The current app in this SPA. Docs is the light-themed editor.
const CURRENT: AppKey = "docs";

const APPS: AppLink[] = [
  { key: "docs", href: "/docs", labelKey: "doc", icon: FileText },
  { key: "slide", href: "/slide", labelKey: "slide", icon: Presentation },
  { key: "sheet", href: "/sheet", labelKey: "sheet", icon: Sheet },
];

/**
 * Append the current Workspace id (`space_id`/`spaceId` query param) to a path
 * so cross-app navigation stays inside the same Workspace.
 */
function withSpace(path: string): string {
  let spaceId = "";
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? "");
    spaceId = params.get("space_id") ?? params.get("spaceId") ?? "";
  } catch {
    spaceId = "";
  }
  if (!spaceId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}space_id=${encodeURIComponent(spaceId)}`;
}

export default function OfficeNav() {
  const { t } = useI18n();

  return (
    <div class="flex items-center gap-1 shrink-0">
      {/* Brand → Office shell (home, NOT the docs list) */}
      <a
        href={withSpace("/")}
        class="flex items-center gap-2.5 mr-1 rounded-lg px-1 py-0.5 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
        title={t("openOffice")}
        aria-label={t("openOffice")}
      >
        <div class="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
          <FileText size={20} class="text-white" />
        </div>
        <span class="text-base font-medium text-gray-800 dark:text-neutral-100 hidden sm:inline">
          <b class="font-semibold">Takos</b>{" "}
          <span class="text-gray-500 dark:text-neutral-400 font-normal">{t("office")}</span>
        </span>
      </a>

      {/* App switcher */}
      <nav class="flex items-center gap-0.5" aria-label={t("office")}>
        <For each={APPS}>
          {(app) => {
            const active = app.key === CURRENT;
            const Icon = app.icon;
            return (
              <a
                href={withSpace(app.href)}
                aria-current={active ? "page" : undefined}
                title={t(app.labelKey)}
                class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors"
                classList={{
                  "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300":
                    active,
                  "text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100":
                    !active,
                }}
              >
                <Icon size={14} />
                <span class="hidden md:inline">{t(app.labelKey)}</span>
              </a>
            );
          }}
        </For>
      </nav>
    </div>
  );
}
