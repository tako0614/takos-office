import { Component, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import {
  createSpreadsheet,
  deleteSpreadsheet,
  loadSpreadsheetsFromApi,
} from "../lib/storage";
import { SpreadsheetCard } from "../components/SpreadsheetCard";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import ThemeToggle from "../../../shared/components/ThemeToggle";
import OfficeNav from "../components/OfficeNav";
import { useI18n } from "../i18n";
import { withCurrentSpaceId } from "../../../shared/lib/space-id";
import { captureCreateReceipt } from "../../../shared/lib/create-receipt";
import type { Spreadsheet } from "../types";

export const SpreadsheetListPage: Component = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routeScope = createMemo(() => ({
    pathname: location.pathname,
    search: location.search,
  }));
  let active = true;
  onCleanup(() => { active = false; });
  const [creating, setCreating] = createSignal(false);
  const [creationFailures, setCreationFailures] = createSignal(new Set<string>());
  const creationReceipt = () => {
    routeScope();
    return captureCreateReceipt("takos-sheet-create-receipt");
  };
  const clearCreationFailure = (key: string) => {
    setCreationFailures((previous) => {
      const next = new Set(previous);
      next.delete(key);
      return next;
    });
  };
  const creationError = () => {
    const receipt = creationReceipt();
    if (creating()) return "";
    try {
      return creationFailures().has(receipt.key) || receipt.current()
        ? t("createUnconfirmed")
        : "";
    } catch {
      return t("createUnconfirmed");
    }
  };
  const { t } = useI18n();
  const [spreadsheets, setSpreadsheets] = createSignal<Spreadsheet[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [showNewDialog, setShowNewDialog] = createSignal(false);
  const [newTitle, setNewTitle] = createSignal("");

  const handleCreate = async () => {
    if (creating() || creationError()) return;
    const scope = routeScope();
    const receipt = creationReceipt();
    setCreating(true);
    try {
      const token = receipt.begin();
      const title = newTitle().trim() || t("untitledSpreadsheet");
      const result = createSpreadsheet(title, t("defaultSheetName"));
      const destination = withCurrentSpaceId("/" + result.value.id);
      setShowNewDialog(false);
      setNewTitle("");
      await result.remote;
      if (receipt.acknowledge(token) && active) clearCreationFailure(receipt.key);
      if (active && routeScope() === scope) navigate(destination);
    } catch {
      if (active) {
        setCreationFailures((previous) => new Set(previous).add(receipt.key));
      }
    } finally {
      if (active) setCreating(false);
    }
  };

  onMount(() => {
    const scope = routeScope();
    const receipt = creationReceipt();
    let snapshot: string | null | undefined;
    try { snapshot = receipt.current(); } catch { /* Fail closed until a usable read. */ }
    void loadSpreadsheetsFromApi()
      .then((items) => {
        if (!active || routeScope() !== scope) return;
        setSpreadsheets(items);
        if (snapshot !== undefined && receipt.acknowledge(snapshot)) {
          clearCreationFailure(receipt.key);
        }
      })
      .catch(() => undefined)
      .finally(() => setIsLoading(false));

    // Quick-create entry point from the Office shell: `?new=1` immediately
    // fires the same create action as the "New Spreadsheet" button and then
    // strips the param so a refresh doesn't create another spreadsheet.
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      params.delete("new");
      const query = params.toString();
      const url = window.location.pathname +
        (query ? `?${query}` : "") + window.location.hash;
      window.history.replaceState(window.history.state, "", url);
      void handleCreate();
    }
  });

  const handleDelete = (e: Event, id: string) => {
    e.stopPropagation();
    if (confirm(t("deleteSpreadsheetConfirm"))) {
      void deleteSpreadsheet(id).catch((error) => {
        console.error("[takos-excel] Failed to delete spreadsheet", error);
      });
      setSpreadsheets((prev) => prev.filter((ss) => ss.id !== id));
    }
  };

  return (
    <div class="min-h-screen bg-white dark:bg-neutral-900">
      {/* Header */}
      <header class="border-b border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <div class="flex items-center gap-4">
            <OfficeNav />
            <div class="hidden sm:block">
              <h1 class="text-xl font-bold text-gray-900 dark:text-neutral-100">Takos Sheets</h1>
              <p class="mt-0.5 text-sm text-gray-500 dark:text-neutral-500">
                {t("spreadsheetEditor")}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <ThemeToggle t={t} />
            <LanguageSwitcher />
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
              disabled={creating() || !!creationError()}
              onClick={() => setShowNewDialog(true)}
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
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t("newSpreadsheetButton")}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main class="mx-auto max-w-5xl px-6 py-6">
        <Show when={creating()}>
          <p role="status" class="mb-4 text-sm text-gray-600 dark:text-gray-300">
            {t("creating")}
          </p>
        </Show>
        <Show when={creationError()}>
          <div role="alert" class="mb-4 rounded-lg border border-amber-300 p-3 text-sm dark:text-gray-100">
            <p>{creationError()}</p>
            <button
              type="button"
              class="mt-2 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              onClick={() => window.location.reload()}
            >
              {t("reloadLibrary")}
            </button>
          </div>
        </Show>
        <Show when={isLoading()}>
          {/* Lightweight skeleton while the list loads from the API. */}
          <div
            class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            role="status"
            aria-label={t("loadingSpreadsheets")}
            aria-busy="true"
          >
            <For each={[0, 1, 2, 3, 4, 5]}>
              {() => (
                <div class="animate-pulse rounded-xl border border-gray-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                  <div class="mb-4 h-24 rounded-lg bg-gray-100 dark:bg-neutral-800" />
                  <div class="mb-2 h-4 w-2/3 rounded bg-gray-100 dark:bg-neutral-800" />
                  <div class="h-3 w-1/3 rounded bg-gray-100 dark:bg-neutral-800" />
                </div>
              )}
            </For>
            <span class="sr-only">{t("loadingSpreadsheets")}</span>
          </div>
        </Show>

        <Show when={!isLoading()}>
        <Show
          when={spreadsheets().length > 0}
          fallback={
            <Show when={!isLoading()}>
              <div class="flex flex-col items-center justify-center py-24 text-center">
                <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-neutral-800">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="text-gray-400 dark:text-neutral-500"
                  >
                    <rect
                      x="3"
                      y="3"
                      width="18"
                      height="18"
                      rx="2"
                      ry="2"
                    />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="3" y1="15" x2="21" y2="15" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                    <line x1="15" y1="3" x2="15" y2="21" />
                  </svg>
                </div>
                <h2 class="mb-2 text-lg font-semibold text-gray-800 dark:text-neutral-200">
                  {t("noSpreadsheetsTitle")}
                </h2>
                <p class="mb-6 text-sm text-gray-500 dark:text-neutral-500">
                  {t("noSpreadsheetsDescription")}
                </p>
                <button
                  type="button"
                  class="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500"
                  disabled={creating() || !!creationError()}
              onClick={() => setShowNewDialog(true)}
                >
                  {t("createSpreadsheet")}
                </button>
              </div>
            </Show>
          }
        >
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <For each={spreadsheets()}>
              {(ss) => (
                <SpreadsheetCard
                  spreadsheet={ss}
                  onClick={() => navigate(withCurrentSpaceId(`/${ss.id}`))}
                  onDelete={(e) => handleDelete(e, ss.id)}
                />
              )}
            </For>
          </div>
        </Show>
        </Show>
      </main>

      {/* New spreadsheet dialog */}
      <Show when={showNewDialog()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60"
          onClick={() => setShowNewDialog(false)}
        >
          <div
            class="w-96 rounded-xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-neutral-700 dark:bg-neutral-800"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 class="mb-4 text-lg font-semibold text-gray-900 dark:text-neutral-100">
              {t("newSpreadsheet")}
            </h2>
            <input
              class="mb-4 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
              placeholder={t("spreadsheetTitlePlaceholder")}
              value={newTitle()}
              onInput={(e) => setNewTitle(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setShowNewDialog(false);
              }}
              ref={(el) => setTimeout(() => el.focus(), 0)}
            />
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="rounded-lg px-4 py-2 text-sm text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                onClick={() => setShowNewDialog(false)}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                disabled={creating() || !!creationError()}
                onClick={handleCreate}
              >
                {t("create")}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
