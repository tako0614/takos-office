import { Component, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import {
  createSpreadsheet,
  deleteSpreadsheet,
  loadSpreadsheetsFromApi,
  loadSpreadsheets,
} from "../lib/storage";
import { SpreadsheetCard } from "../components/SpreadsheetCard";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import ThemeToggle from "../../../shared/components/ThemeToggle";
import OfficeNav from "../components/OfficeNav";
import { useI18n } from "../i18n";
import { withCurrentSpaceId } from "../../../shared/lib/space-id";
import { captureCreateReceipt } from "../../../shared/lib/create-receipt";
import type { Spreadsheet } from "../types";
import { createSpreadsheetImporter } from "../lib/spreadsheet-import.ts";
import { OfficeFileError } from "../../../shared/lib/office-file.ts";
import { handleModalKeyDown, isImeComposing } from "../../../shared/lib/dialog-a11y.ts";

export const SpreadsheetListPage: Component = () => {
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
  const [imported, setImported] = createSignal<{spreadsheet: Spreadsheet;hasUnsupportedContent: boolean} | null>(null);
  const importer = createSpreadsheetImporter();
  let importGeneration = 0, fileInput!: HTMLInputElement;
  const cancelImport = () => { importGeneration++;importer.retire();setImporting(false);setImportSaving(false); };
  onCleanup(() => importer.retire());

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
  const [loadError, setLoadError] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal("");
  const [deleting, setDeleting] = createSignal(new Set<string>());

  const [showNewDialog, setShowNewDialog] = createSignal(false);
  const [newTitle, setNewTitle] = createSignal("");
  let dialogRef: HTMLDivElement | undefined;
  let dialogInputRef: HTMLInputElement | undefined;
  let previouslyFocused: HTMLElement | null = null;

  createEffect(() => {
    if (!showNewDialog()) return;
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => dialogInputRef?.focus());
    const onKeyDown = (event: KeyboardEvent) =>
      handleModalKeyDown(event, dialogRef, () => setShowNewDialog(false));
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
      previouslyFocused = null;
    });
  });

  const handleImport = async (file: File) => {
    const operation = ++importGeneration;
    setImporting(true);setImportSaving(false);setImportError(null);setImported(null);
    try {
      const result = await importer.importFile(file, () => { if (operation === importGeneration) setImportSaving(true); });
      if (!result || operation !== importGeneration || !active) return;
      setSpreadsheets(loadSpreadsheets());setImported(result);
    } catch (error) {
      if (operation !== importGeneration || !active) return;
      setSpreadsheets(loadSpreadsheets());setImportError(error instanceof OfficeFileError ? error.code : "save");
    } finally { if (operation === importGeneration && active) setImporting(false); }
  };

  const handleCreate = async () => {
    if (creating() || importing() || creationError()) return;
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

  const fetchSpreadsheets = () => {
    const scope = routeScope();
    const generation = ++loadGeneration;
    const isCurrent = () =>
      active && routeScope() === scope && generation === loadGeneration;
    cancelImport();setImported(null);setImportError(null);
    setIsLoading(true);
    setLoadError(false);
    setSpreadsheets([]);
    setDeleteError("");
    setDeleting(new Set<string>());
    const receipt = creationReceipt();
    let snapshot: string | null | undefined;
    try { snapshot = receipt.current(); } catch { /* Fail closed until a usable read. */ }
    void loadSpreadsheetsFromApi({ isActive: isCurrent })
      .then((items) => {
        if (!isCurrent()) return;
        setSpreadsheets(items);
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
    fetchSpreadsheets();
  });

  onMount(() => {
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
    if (deleting().has(id) || !confirm(t("deleteSpreadsheetConfirm"))) return;
    const scope = routeScope();
    setDeleteError("");
    setDeleting((previous) => new Set(previous).add(id));
    void deleteSpreadsheet(id).then(() => {
      if (active && routeScope() === scope) setSpreadsheets(loadSpreadsheets());
    }).catch(() => {
      if (active && routeScope() === scope) setDeleteError(t("deleteUnconfirmed"));
    }).finally(() => {
      if (active && routeScope() === scope) setDeleting((previous) => {
        const next = new Set(previous);next.delete(id);return next;
      });
    });
  };

  return (
    <div class="min-h-screen bg-white dark:bg-neutral-900">
      {/* Header */}
      <header class="border-b border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 sm:gap-3 px-4 sm:px-6 py-4 sm:py-5">
          <div class="flex items-center gap-3 sm:gap-4">
            <OfficeNav />
            <div class="hidden sm:block">
              <h1 class="text-xl font-bold text-gray-900 dark:text-neutral-100">Takos Sheets</h1>
              <p class="mt-0.5 text-sm text-gray-600 dark:text-neutral-400">
                {t("spreadsheetEditor")}
              </p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2 sm:gap-3">
            <ThemeToggle t={t} />
            <LanguageSwitcher />
            <button
              type="button"
              class="flex whitespace-nowrap items-center gap-2 rounded-lg bg-emerald-600 px-3 sm:px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
              disabled={creating() || importing() || !!creationError()}
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
        <div class="mb-6 flex flex-col items-start gap-2">
          <input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="hidden" aria-label={t("importXlsx")}
            onChange={(event) => {const file=event.currentTarget.files?.[0];event.currentTarget.value="";if(file)void handleImport(file);}} />
          <button type="button" disabled={creating() || importing() || !!creationError()} onClick={() => fileInput.click()}
            class="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800">{t("importXlsx")}</button>
          <p class="max-w-xl text-xs text-gray-500 dark:text-neutral-400">{t("fileImportHelp")}</p>
          <Show when={importing()}><div role="status" aria-busy="true" class="text-sm text-gray-700 dark:text-neutral-200">
            {t(importSaving() ? "importSaving" : "importing")}
            <Show when={!importSaving()}><button type="button" class="ml-3 underline" onClick={cancelImport}>{t("cancel")}</button></Show>
          </div></Show>
          <Show when={importError()}>{(code) => <p role="alert" class="text-sm text-red-700 dark:text-red-300">{t({invalid:"fileInvalid","too-large":"fileTooLarge",unsafe:"fileUnsafe",unsupported:"fileUnsupported",timeout:"fileTimeout",save:"importSaveFailed"}[code()] as "fileInvalid" | "fileTooLarge" | "fileUnsafe" | "fileUnsupported" | "fileTimeout" | "importSaveFailed")}</p>}</Show>
          <Show when={imported()}>{(result) => <div role="status" class="text-sm text-gray-800 dark:text-neutral-100">
            <p>{t(result().hasUnsupportedContent ? "fileFormattingWarning" : "importComplete")}</p>
            <button type="button" class="mt-2 text-emerald-700 underline dark:text-emerald-300" onClick={() => navigate(withCurrentSpaceId(`/${result().spreadsheet.id}`))}>{t("openImportedSpreadsheet")}</button>
          </div>}</Show>
        </div>

        <Show when={deleting().size > 0}><p role="status" class="mb-3 text-sm">{t("deletePending")}</p></Show>
        <Show when={deleteError()}>
          <div role="alert" class="mb-4 rounded-lg border border-amber-300 p-3 text-sm dark:text-neutral-100">
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

        <Show when={loadError()}>
          <div
            role="alert"
            class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
          >
            <span class="min-w-0 flex-1">{t("loadSpreadsheetsFailed")}</span>
            <button
              type="button"
              class="rounded-md border border-red-300 dark:border-red-800 px-3 py-1.5 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
              onClick={fetchSpreadsheets}
            >
              {t("retry")}
            </button>
          </div>
        </Show>

        <Show when={!isLoading()}>
        <Show
          when={spreadsheets().length > 0}
          fallback={
            <Show when={!isLoading() && !loadError()}>
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
                    class="text-gray-400 dark:text-neutral-400"
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
                <p class="mb-6 text-sm text-gray-600 dark:text-neutral-400">
                  {t("noSpreadsheetsDescription")}
                </p>
                <button
                  type="button"
                  class="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500"
                  disabled={creating() || importing() || !!creationError()}
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
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 dark:bg-black/60"
          onClick={() => setShowNewDialog(false)}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-spreadsheet-dialog-title"
            class="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-neutral-700 dark:bg-neutral-800"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="new-spreadsheet-dialog-title"
              class="mb-4 text-lg font-semibold text-gray-900 dark:text-neutral-100"
            >
              {t("newSpreadsheet")}
            </h2>
            <input
              ref={dialogInputRef}
              class="mb-4 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
              placeholder={t("spreadsheetTitlePlaceholder")}
              aria-label={t("spreadsheetTitlePlaceholder")}
              value={newTitle()}
              onInput={(e) => setNewTitle(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (isImeComposing(e)) return;
                if (e.key === "Enter") handleCreate();
              }}
            />
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="rounded-lg px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                onClick={() => setShowNewDialog(false)}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                disabled={creating() || importing() || !!creationError()}
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
