import { For } from "solid-js";
import { useI18n } from "../i18n";

type AppKey = "docs" | "slide" | "sheet";

const APPS: {
  key: AppKey;
  path: string;
  labelKey: "officeDocs" | "officeSlides" | "officeSheets";
}[] = [
  { key: "docs", path: "/docs", labelKey: "officeDocs" },
  { key: "slide", path: "/slide", labelKey: "officeSlides" },
  { key: "sheet", path: "/sheet", labelKey: "officeSheets" },
];

// The sheet app is the current Office app, so the "Sheets" switch link is active.
const CURRENT_APP: AppKey = "sheet";

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
      {/* Brand returns to the Office shell (NOT /sheet). */}
      <a
        href={withSpaceId("/")}
        class="text-lg font-bold text-neutral-100 transition-colors hover:text-white"
      >
        Takos
      </a>
      <div class="inline-flex rounded-lg border border-neutral-700 bg-neutral-950 p-0.5">
        <For each={APPS}>
          {(app) => {
            const isCurrent = app.key === CURRENT_APP;
            return (
              <a
                href={withSpaceId(app.path)}
                class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
                classList={{
                  "bg-emerald-600 text-white": isCurrent,
                  "text-neutral-500 hover:text-neutral-200": !isCurrent,
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
