import { Component, createSignal, For, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  createSpreadsheet,
  deleteSpreadsheet,
  loadSpreadsheetsFromApi,
} from "../lib/storage";
import { SpreadsheetCard } from "../components/SpreadsheetCard";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import OfficeNav from "../components/OfficeNav";
import { useI18n } from "../i18n";
import type { Spreadsheet } from "../types";

export const SpreadsheetListPage: Component = () => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [spreadsheets, setSpreadsheets] = createSignal<Spreadsheet[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [showNewDialog, setShowNewDialog] = createSignal(false);
  const [newTitle, setNewTitle] = createSignal("");

  onMount(() => {
    void loadSpreadsheetsFromApi()
      .then(setSpreadsheets)
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  });

  const handleCreate = () => {
    const title = newTitle().trim() || t("untitledSpreadsheet");
    const result = createSpreadsheet(title, t("defaultSheetName"));
    const ss = result.value;
    void result.remote.catch((error) => {
      console.error("[takos-excel] Failed to save spreadsheet", error);
    });
    setShowNewDialog(false);
    setNewTitle("");
    navigate(`/${ss.id}`);
  };

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
    <div class="min-h-screen bg-neutral-900">
      {/* Header */}
      <header class="border-b border-neutral-800 bg-neutral-900">
        <div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <div class="flex items-center gap-4">
            <OfficeNav />
            <div class="hidden sm:block">
              <h1 class="text-xl font-bold text-neutral-100">Takos Sheets</h1>
              <p class="mt-0.5 text-sm text-neutral-500">
                {t("spreadsheetEditor")}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <LanguageSwitcher />
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
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
        <Show
          when={spreadsheets().length > 0}
          fallback={
            <Show when={!isLoading()}>
              <div class="flex flex-col items-center justify-center py-24 text-center">
                <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-800">
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
                    class="text-neutral-500"
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
                <h2 class="mb-2 text-lg font-semibold text-neutral-200">
                  {t("noSpreadsheetsTitle")}
                </h2>
                <p class="mb-6 text-sm text-neutral-500">
                  {t("noSpreadsheetsDescription")}
                </p>
                <button
                  type="button"
                  class="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500"
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
                  onClick={() => navigate(`/${ss.id}`)}
                  onDelete={(e) => handleDelete(e, ss.id)}
                />
              )}
            </For>
          </div>
        </Show>
      </main>

      {/* New spreadsheet dialog */}
      <Show when={showNewDialog()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowNewDialog(false)}
        >
          <div
            class="w-96 rounded-xl border border-neutral-700 bg-neutral-800 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 class="mb-4 text-lg font-semibold text-neutral-100">
              {t("newSpreadsheet")}
            </h2>
            <input
              class="mb-4 w-full rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
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
                class="rounded-lg px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200"
                onClick={() => setShowNewDialog(false)}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
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
