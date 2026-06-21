import { For } from "solid-js";
import { useI18n } from "../i18n";

type AppKey = "docs" | "slide" | "sheet";

const APPS: { key: AppKey; path: string; labelKey: "officeDocs" | "officeSlides" | "officeSheets" }[] = [
  { key: "docs", path: "/docs", labelKey: "officeDocs" },
  { key: "slide", path: "/slide", labelKey: "officeSlides" },
  { key: "sheet", path: "/sheet", labelKey: "officeSheets" },
];

// The slide app is the current Office app, so the "Slides" switch link is active.
const CURRENT_APP: AppKey = "slide";

// Carry the active Workspace across the full-page navigations between sibling
// Office SPAs. The space id arrives as `space_id` (or camelCase `spaceId`) on
// the current URL; mirror it onto every cross-app href.
function withSpaceId(path: string): string {
  const search = globalThis.location?.search ?? "";
  const query = new URLSearchParams(search);
  const spaceId = query.get("space_id") ?? query.get("spaceId");
  if (!spaceId) return path;
  const next = new URLSearchParams();
  next.set("space_id", spaceId);
  return `${path}?${next.toString()}`;
}

export default function OfficeNav() {
  const { t } = useI18n();

  return (
    <nav class="flex items-center gap-3" aria-label={t("officeNavLabel")}>
      {/* Brand returns to the Office shell (NOT /slide). */}
      <a
        href={withSpaceId("/")}
        class="text-lg font-bold text-gray-900 hover:text-black dark:text-gray-100 dark:hover:text-white transition-colors"
      >
        Takos
      </a>
      <div
        class="inline-flex rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-900 p-0.5"
      >
        <For each={APPS}>
          {(app) => {
            const isCurrent = app.key === CURRENT_APP;
            return (
              <a
                href={withSpaceId(app.path)}
                class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
                classList={{
                  "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100":
                    isCurrent,
                  "text-gray-500 hover:text-gray-800 dark:text-gray-500 dark:hover:text-gray-200":
                    !isCurrent,
                }}
                aria-current={isCurrent ? "page" : undefined}
              >
                {t(app.labelKey)}
              </a>
            );
          }}
        </For>
      </div>
    </nav>
  );
}
