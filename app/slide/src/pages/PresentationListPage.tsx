import { createSignal, For, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { Presentation } from "../types";
import {
  createPresentation,
  deletePresentation,
  loadPresentationsFromApi,
  savePresentation,
} from "../lib/storage";
import PresentationCard from "../components/PresentationCard";
import LanguageSwitcher from "../components/LanguageSwitcher";
import ThemeToggle from "../components/ThemeToggle";
import OfficeNav from "../components/OfficeNav";
import { useI18n } from "../i18n";

export default function PresentationListPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [presentations, setPresentations] = createSignal<Presentation[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [showNewDialog, setShowNewDialog] = createSignal(false);
  const [newTitle, setNewTitle] = createSignal(t("untitledPresentation"));

  // Create a presentation and navigate into it. Shared by the dialog's
  // "Create" button and the `?new=1` quick-create entry from the Office shell.
  const createAndOpen = (title: string) => {
    const pres = createPresentation(title);
    const result = savePresentation(pres);
    setPresentations(result.value);
    void result.remote.catch((error) => {
      console.error("[takos-slide] Failed to save presentation", error);
    });
    setShowNewDialog(false);
    setNewTitle(t("untitledPresentation"));
    navigate(`/${pres.id}`);
  };

  onMount(() => {
    void loadPresentationsFromApi()
      .then(setPresentations)
      .catch(() => undefined)
      .finally(() => setIsLoading(false));

    // Quick-create from the Office shell: `?new=1` fires the same create+open
    // action as the "新規プレゼンテーション" button, then strips the param so a
    // refresh doesn't re-create another deck.
    const params = new URLSearchParams(globalThis.location?.search ?? "");
    if (params.get("new") === "1") {
      params.delete("new");
      const query = params.toString();
      const url = globalThis.location?.pathname +
        (query ? `?${query}` : "") + (globalThis.location?.hash ?? "");
      globalThis.history?.replaceState(null, "", url);
      createAndOpen(t("untitledPresentation"));
    }
  });

  const handleCreate = () => {
    createAndOpen(newTitle());
  };

  const openNewDialog = () => {
    setNewTitle(t("untitledPresentation"));
    setShowNewDialog(true);
  };

  const handleDelete = (id: string) => {
    if (!confirm(t("deletePresentationConfirm"))) return;
    const result = deletePresentation(id);
    setPresentations(result.value);
    void result.remote.catch((error) => {
      console.error("[takos-slide] Failed to delete presentation", error);
    });
  };

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header class="bg-white border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700 px-6 py-4">
        <div class="max-w-6xl mx-auto flex items-center justify-between">
          <OfficeNav />
          <div class="flex items-center gap-3">
            <LanguageSwitcher />
            <ThemeToggle />
            <button
              type="button"
              class="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
              onClick={openNewDialog}
            >
              {t("newPresentationButton")}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main class="max-w-6xl mx-auto px-6 py-8">
        <Show when={isLoading()}>
          <div
            class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
            role="status"
            aria-busy="true"
            aria-label={t("loadingPresentations")}
          >
            <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
              {() => (
                <div class="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
                  <div class="aspect-video bg-gray-200 dark:bg-gray-700 animate-pulse" />
                  <div class="p-3 space-y-2">
                    <div class="h-3.5 w-3/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                    <div class="h-2.5 w-1/2 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                  </div>
                </div>
              )}
            </For>
            <span class="sr-only">{t("loading")}</span>
          </div>
        </Show>

        <Show
          when={presentations().length > 0}
          fallback={
            <Show when={!isLoading()}>
              <div class="text-center py-24">
                <div class="text-6xl mb-4 text-gray-300 dark:text-gray-600">&#9657;</div>
                <h2 class="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  {t("noPresentationsTitle")}
                </h2>
                <p class="text-sm text-gray-500 dark:text-gray-500 mb-6">
                  {t("noPresentationsDescription")}
                </p>
                <button
                  type="button"
                  class="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
                  onClick={openNewDialog}
                >
                  {t("createPresentation")}
                </button>
              </div>
            </Show>
          }
        >
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <For each={presentations()}>
              {(pres) => (
                <PresentationCard
                  presentation={pres}
                  onClick={() => navigate(`/${pres.id}`)}
                  onDelete={() => handleDelete(pres.id)}
                />
              )}
            </For>
          </div>
        </Show>
      </main>

      {/* New Presentation Dialog */}
      <Show when={showNewDialog()}>
        <div
          class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setShowNewDialog(false)}
        >
          <div
            class="bg-white border border-gray-200 dark:bg-gray-800 dark:border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              {t("newPresentation")}
            </h2>
            <input
              type="text"
              class="w-full bg-gray-50 text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600 px-4 py-2.5 rounded-lg border outline-none focus:border-blue-500 text-sm mb-6"
              placeholder={t("titlePlaceholder")}
              value={newTitle()}
              onInput={(e) => setNewTitle(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autofocus
            />
            <div class="flex justify-end gap-3">
              <button
                type="button"
                class="px-4 py-2 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                onClick={() => setShowNewDialog(false)}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                class="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
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
}
