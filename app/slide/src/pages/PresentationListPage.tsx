import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import type { Presentation } from "../types";
import {
  createPresentation,
  deletePresentation,
  loadPresentationsFromApi,
  loadPresentations,
  savePresentation,
} from "../lib/storage";
import PresentationCard from "../components/PresentationCard";
import LanguageSwitcher from "../components/LanguageSwitcher";
import ThemeToggle from "../../../shared/components/ThemeToggle";
import OfficeNav from "../components/OfficeNav";
import { useI18n } from "../i18n";
import { withCurrentSpaceId } from "../../../shared/lib/space-id";
import { captureCreateReceipt } from "../../../shared/lib/create-receipt";
import { createPresentationImporter } from "../lib/presentation-import.ts";
import { OfficeFileError } from "../../../shared/lib/office-file.ts";
import {
  acquireModalScrollLock,
  handleModalKeyDown,
  isImeComposing,
  restoreFocus,
} from "../../../shared/lib/dialog-a11y.ts";
import { ConfirmDialog } from "../../../shared/components/OfficeDialog";

export default function PresentationListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeScope = createMemo(() => ({
    pathname: location.pathname,
    search: location.search,
  }));
  let active = true;
  let loadGeneration = 0;
  onCleanup(() => { active = false; loadGeneration++; });
  const [creating, setCreating] = createSignal(false);
  const [importing, setImporting] = createSignal(false);
  const [importSaving, setImportSaving] = createSignal(false);
  const [importError, setImportError] = createSignal<OfficeFileError["code"] | "save" | null>(null);
  const [imported, setImported] = createSignal<{presentation: Presentation; hasUnsupportedContent: boolean} | null>(null);
  const importer = createPresentationImporter();
  let importGeneration = 0, fileInput!: HTMLInputElement;
  const cancelImport = () => {importGeneration++;importer.retire();setImporting(false);setImportSaving(false);};
  onCleanup(() => importer.retire());
  const [creationFailures, setCreationFailures] = createSignal(new Set<string>());
  const creationReceipt = () => {
    routeScope();
    return captureCreateReceipt("takos-slide-create-receipt");
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
  const { t, language } = useI18n();
  const [presentations, setPresentations] = createSignal<Presentation[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal("");
  const [deleting, setDeleting] = createSignal(new Set<string>());
  const [deleteTargetId, setDeleteTargetId] = createSignal<string | null>(null);
  const [showNewDialog, setShowNewDialog] = createSignal(false);
  const [newTitle, setNewTitle] = createSignal(t("untitledPresentation"));
  let dialogRef: HTMLDivElement | undefined;
  let dialogInputRef: HTMLInputElement | undefined;
  let previouslyFocused: HTMLElement | null = null;

  createEffect(() => {
    void language();
    document.title = `${t("officeSlides")} — Takos Office`;
  });

  createEffect(() => {
    if (!showNewDialog()) return;
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseScrollLock = acquireModalScrollLock();
    queueMicrotask(() => dialogInputRef?.focus());
    const onKeyDown = (event: KeyboardEvent) =>
      handleModalKeyDown(event, dialogRef, () => setShowNewDialog(false));
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown);
      releaseScrollLock();
      restoreFocus(previouslyFocused);
      previouslyFocused = null;
    });
  });

  const handleImport = async (file: File) => {
    const operation = ++importGeneration;
    setImporting(true);setImportSaving(false);setImportError(null);setImported(null);
    try {
      const result = await importer.importFile(file, () => {if(operation===importGeneration)setImportSaving(true);});
      if (!result || operation!==importGeneration || !active) return;
      setPresentations(loadPresentations());setImported(result);
    } catch (error) {
      if (operation!==importGeneration || !active) return;
      setPresentations(loadPresentations());
      setImportError(error instanceof OfficeFileError ? error.code : "save");
    } finally {if(operation===importGeneration && active)setImporting(false);}
  };

  // Create a presentation and navigate into it. Shared by the dialog's
  // "Create" button and the `?new=1` quick-create entry from the Office shell.
  const createAndOpen = async (title: string) => {
    if (creating() || importing() || creationError()) return;
    const scope = routeScope();
    const receipt = creationReceipt();
    setCreating(true);
    try {
      const token = receipt.begin();
      const pres = createPresentation(title);
      const destination = withCurrentSpaceId("/" + pres.id);
      const result = savePresentation(pres);
      setShowNewDialog(false);
      setNewTitle(t("untitledPresentation"));
      await result.remote;
      if (receipt.acknowledge(token) && active) clearCreationFailure(receipt.key);
      if (active && routeScope() === scope) {
        setPresentations(loadPresentations());
        navigate(destination);
      }
    } catch {
      if (active) {
        setCreationFailures((previous) => new Set(previous).add(receipt.key));
      }
    } finally {
      if (active) setCreating(false);
    }
  };

  const fetchPresentations = () => {
    const scope = routeScope();
    const generation = ++loadGeneration;
    const isCurrent = () =>
      active && routeScope() === scope && generation === loadGeneration;
    cancelImport();setImportError(null);setImported(null);
    setIsLoading(true);setLoadError(false);setPresentations([]);setDeleteError("");setDeleting(new Set<string>());
    const receipt = creationReceipt();
    let snapshot: string | null | undefined;
    try { snapshot = receipt.current(); } catch { /* Fail closed until a usable read. */ }
    void loadPresentationsFromApi({ isActive: isCurrent })
      .then((items) => {
        if (!isCurrent()) return;
        setPresentations(items);
        if (snapshot !== undefined && receipt.acknowledge(snapshot)) {
          clearCreationFailure(receipt.key);
        }
      })
      .catch(() => {
        if (isCurrent()) setLoadError(true);
      })
      .finally(() => { if (isCurrent()) setIsLoading(false); });
  };

  createEffect(() => {
    routeScope();
    fetchPresentations();
  });

  onMount(() => {
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
      void createAndOpen(t("untitledPresentation"));
    }
  });

  const handleCreate = () => {
    void createAndOpen(newTitle());
  };

  const openNewDialog = () => {
    setNewTitle(t("untitledPresentation"));
    setShowNewDialog(true);
  };

  const handleDelete = (id: string) => {
    if (deleting().has(id)) return;
    setDeleteTargetId(id);
  };

  const confirmDelete = () => {
    const id = deleteTargetId();
    setDeleteTargetId(null);
    if (!id || deleting().has(id)) return;
    const scope = routeScope();
    setDeleteError("");setDeleting((previous) => new Set(previous).add(id));
    void deletePresentation(id).then(() => {
      if (active && routeScope() === scope) setPresentations(loadPresentations());
    }).catch(() => {
      if (active && routeScope() === scope) setDeleteError(t("deleteUnconfirmed"));
    }).finally(() => {
      if (active && routeScope() === scope) setDeleting((previous) => {
        const next = new Set(previous);next.delete(id);return next;
      });
    });
  };

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
      <a
        href="#main"
        class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[130] focus:rounded-lg focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-lg"
      >
        {t("skipToMain")}
      </a>
      {/* Header */}
      <header class="bg-white border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700 px-4 sm:px-6 py-3 sm:py-4">
        <div class="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <OfficeNav />
          <div class="flex flex-wrap items-center gap-2 sm:gap-3">
            <LanguageSwitcher />
            <ThemeToggle t={t} />
            <button
              type="button"
              class="whitespace-nowrap bg-blue-600 hover:bg-blue-500 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
              disabled={creating() || importing() || !!creationError()}
              onClick={openNewDialog}
            >
              {t("newPresentationButton")}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main id="main" tabIndex={-1} class="max-w-6xl mx-auto px-4 sm:px-6 py-8 outline-none">
        <h1 class="sr-only">Takos {t("officeSlides")}</h1>
        <div class="mb-6 flex flex-col items-start gap-2">
          <input ref={fileInput} type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" class="hidden" aria-label={t("importPptx")}
            onChange={(event) => {const file=event.currentTarget.files?.[0];event.currentTarget.value="";if(file)void handleImport(file);}} />
          <button type="button" disabled={creating() || importing() || !!creationError()} onClick={() => fileInput.click()}
            class="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800">{t("importPptx")}</button>
          <p class="max-w-xl text-xs text-gray-500 dark:text-gray-400">{t("fileImportHelp")}</p>
          <Show when={importing()}><div role="status" aria-busy="true" class="text-sm text-gray-700 dark:text-gray-200">
            {t(importSaving() ? "importSaving" : "importing")}
            <Show when={!importSaving()}><button type="button" class="ml-3 underline" onClick={cancelImport}>{t("cancel")}</button></Show>
          </div></Show>
          <Show when={importError()}>{(code) => <p role="alert" class="text-sm text-red-700 dark:text-red-300">{t({invalid:"fileInvalid","too-large":"fileTooLarge",unsafe:"fileUnsafe",unsupported:"fileUnsupported",timeout:"fileTimeout",save:"importSaveFailed"}[code()] as "fileInvalid" | "fileTooLarge" | "fileUnsafe" | "fileUnsupported" | "fileTimeout" | "importSaveFailed")}</p>}</Show>
          <Show when={imported()}>{(result) => <div role="status" class="text-sm text-gray-800 dark:text-gray-100">
            <p>{t(result().hasUnsupportedContent ? "fileFormattingWarning" : "importComplete")}</p>
            <button type="button" class="mt-2 text-blue-700 underline dark:text-blue-300" onClick={() => navigate(withCurrentSpaceId(`/${result().presentation.id}`))}>{t("openImportedPresentation")}</button>
          </div>}</Show>
        </div>
        <Show when={deleteError()}>
          <div role="alert" class="mb-4 rounded-lg border border-amber-300 p-3 text-sm dark:text-gray-100">
            <p>{deleteError()}</p>
            <button type="button" class="mt-2 underline" onClick={() => window.location.reload()}>{t("reloadLibrary")}</button>
          </div>
        </Show>
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

        <Show when={loadError()}>
          <div
            role="alert"
            class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
          >
            <span class="min-w-0 flex-1">{t("loadPresentationsFailed")}</span>
            <button
              type="button"
              class="rounded-md border border-red-300 dark:border-red-800 px-3 py-1.5 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
              onClick={fetchPresentations}
            >
              {t("retry")}
            </button>
          </div>
        </Show>

        <Show
          when={presentations().length > 0}
          fallback={
            <Show when={!isLoading() && !loadError()}>
              <div class="text-center py-24">
                <div class="text-6xl mb-4 text-gray-300 dark:text-gray-600">&#9657;</div>
                <h2 class="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  {t("noPresentationsTitle")}
                </h2>
                <p class="text-sm text-gray-600 dark:text-gray-400 mb-6">
                  {t("noPresentationsDescription")}
                </p>
                <button
                  type="button"
                  class="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
                  disabled={creating() || importing() || !!creationError()}
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
                  onClick={() => navigate(withCurrentSpaceId(`/${pres.id}`))}
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
          class="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
          onClick={() => setShowNewDialog(false)}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-presentation-dialog-title"
            class="bg-white border border-gray-200 dark:bg-gray-800 dark:border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="new-presentation-dialog-title"
              class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4"
            >
              {t("newPresentation")}
            </h2>
            <input
              ref={dialogInputRef}
              type="text"
              class="w-full bg-gray-50 text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600 px-4 py-2.5 rounded-lg border outline-none focus:border-blue-500 text-sm mb-6"
              placeholder={t("titlePlaceholder")}
              aria-label={t("titlePlaceholder")}
              value={newTitle()}
              onInput={(e) => setNewTitle(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (isImeComposing(e)) return;
                if (e.key === "Enter") handleCreate();
              }}
            />
            <div class="flex justify-end gap-3">
              <button
                type="button"
                class="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                onClick={() => setShowNewDialog(false)}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                class="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
                disabled={creating() || importing() || !!creationError()}
                onClick={handleCreate}
              >
                {t("create")}
              </button>
            </div>
          </div>
        </div>
      </Show>
      <ConfirmDialog
        open={deleteTargetId() !== null}
        title={t("deletePresentation")}
        message={t("deletePresentationConfirm")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  );
}
