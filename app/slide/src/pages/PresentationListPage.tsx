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
import { useI18n } from "../i18n";

export default function PresentationListPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [presentations, setPresentations] = createSignal<Presentation[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [showNewDialog, setShowNewDialog] = createSignal(false);
  const [newTitle, setNewTitle] = createSignal(t("untitledPresentation"));

  onMount(() => {
    void loadPresentationsFromApi()
      .then(setPresentations)
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  });

  const handleCreate = () => {
    const pres = createPresentation(newTitle());
    const result = savePresentation(pres);
    setPresentations(result.value);
    void result.remote.catch((error) => {
      console.error("[takos-slide] Failed to save presentation", error);
    });
    setShowNewDialog(false);
    setNewTitle(t("untitledPresentation"));
    navigate(`/${pres.id}`);
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
    <div class="min-h-screen bg-gray-900">
      {/* Header */}
      <header class="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div class="max-w-6xl mx-auto flex items-center justify-between">
          <h1 class="text-xl font-bold text-gray-100">Takos Slide</h1>
          <div class="flex items-center gap-3">
            <LanguageSwitcher />
            <button
              type="button"
              class="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              onClick={openNewDialog}
            >
              {t("newPresentationButton")}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main class="max-w-6xl mx-auto px-6 py-8">
        <Show
          when={presentations().length > 0}
          fallback={
            <Show when={!isLoading()}>
              <div class="text-center py-24">
                <div class="text-6xl mb-4 text-gray-600">&#9657;</div>
                <h2 class="text-lg font-semibold text-gray-300 mb-2">
                  {t("noPresentationsTitle")}
                </h2>
                <p class="text-sm text-gray-500 mb-6">
                  {t("noPresentationsDescription")}
                </p>
                <button
                  type="button"
                  class="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
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
            class="bg-gray-800 rounded-xl border border-gray-700 p-6 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 class="text-lg font-semibold text-gray-100 mb-4">
              {t("newPresentation")}
            </h2>
            <input
              type="text"
              class="w-full bg-gray-700 text-gray-100 px-4 py-2.5 rounded-lg border border-gray-600 outline-none focus:border-blue-500 text-sm mb-6"
              placeholder={t("titlePlaceholder")}
              value={newTitle()}
              onInput={(e) => setNewTitle(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autofocus
            />
            <div class="flex justify-end gap-3">
              <button
                type="button"
                class="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                onClick={() => setShowNewDialog(false)}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                class="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors"
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
