import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { FileText, Plus, Search, Upload } from "lucide-solid";
import type { Document } from "../types";
import {
  addDocument,
  loadDocumentsFromApi,
  loadDocuments,
  removeDocument,
} from "../lib/storage";
import DocumentCard from "../components/DocumentCard";
import LanguageSwitcher from "../components/LanguageSwitcher";
import ThemeToggle from "../../../shared/components/ThemeToggle";
import { withCurrentSpaceId } from "../../../shared/lib/space-id";
import OfficeNav from "../components/OfficeNav";
import { useI18n } from "../i18n";
import { createDocumentImporter } from "../lib/document-import.ts";
import { OfficeFileError } from "../../../shared/lib/office-file.ts";
import { ConfirmDialog } from "../../../shared/components/OfficeDialog";
import { isImeComposing } from "../../../shared/lib/dialog-a11y";

export default function DocumentListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useI18n();
  const [documents, setDocuments] = createSignal<Document[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const [deleteTargetId, setDeleteTargetId] = createSignal<string | null>(null);
  const [importing, setImporting] = createSignal(false);
  const [importSaving, setImportSaving] = createSignal(false);
  const [importError, setImportError] = createSignal<"invalid" | "too-large" | "unsafe" | "unsupported" | "timeout" | "save" | null>(null);
  const [imported, setImported] = createSignal<{document: Document; hasUnsupportedContent: boolean} | null>(null);
  const importer = createDocumentImporter();
  let fileInput!: HTMLInputElement;
  let viewGeneration = 0, importGeneration = 0;

  const cancelImport = () => {
    importGeneration++;
    importer.retire();
    setImporting(false);
    setImportSaving(false);
  };
  const fetchDocuments = () => {
    const generation = ++viewGeneration;
    cancelImport();
    setImportError(null);
    setImported(null);
    setLoadError(false);
    setDocuments([]);
    setIsLoading(true);
    void loadDocumentsFromApi({ isActive: () => generation === viewGeneration })
      .then((docs) => { if (generation === viewGeneration) setDocuments(docs); })
      .catch(() => { if (generation === viewGeneration) setLoadError(true); })
      .finally(() => { if (generation === viewGeneration) setIsLoading(false); });
  };
  createEffect(() => {
    // A→B→A is a new view even when the final Workspace id matches again.
    void location.search;
    fetchDocuments();
  });
  onCleanup(() => { viewGeneration++; cancelImport(); });

  const handleImport = async (file: File) => {
    const operation = ++importGeneration;
    setImporting(true);
    setImportSaving(false);
    setImportError(null);
    setImported(null);
    try {
      const result = await importer.importFile(file, () => { if (operation === importGeneration) setImportSaving(true); });
      if (operation !== importGeneration || !result) return;
      setDocuments(loadDocuments());
      setImported(result);
    } catch (error) {
      if (operation !== importGeneration) return;
      setDocuments(loadDocuments());
      setImportError(error instanceof OfficeFileError ? error.code : "save");
    } finally {
      if (operation === importGeneration) setImporting(false);
    }
  };

  const handleCreate = () => {
    const now = new Date().toISOString();
    const doc: Document = {
      id: crypto.randomUUID(),
      title: t("untitledDocument"),
      content: "",
      createdAt: now,
      updatedAt: now,
    };
    void addDocument(doc).catch((error) => {
      console.error("[takos-docs] Failed to save document", error);
    });
    setDocuments((prev) => [...prev, doc]);
    navigate(withCurrentSpaceId(`/${doc.id}`));
  };

  onMount(() => {
    // Quick-create entry point from the Office shell: `?new=1` fires the same
    // blank-document create action as the create card, then strips the param so
    // a refresh doesn't create another document.
    try {
      const params = new URLSearchParams(globalThis.location?.search ?? "");
      if (params.get("new") === "1") {
        params.delete("new");
        const query = params.toString();
        const url = `${globalThis.location.pathname}${query ? `?${query}` : ""}${globalThis.location.hash ?? ""}`;
        globalThis.history?.replaceState(globalThis.history.state, "", url);
        handleCreate();
      }
    } catch {
      // Ignore environments without a usable location/history (e.g. tests).
    }
  });

  createEffect(() => {
    void language();
    document.title = `${t("doc")} — Takos Office`;
  });

  const handleDelete = (id: string) => {
    setDeleteTargetId(id);
  };

  const confirmDelete = () => {
    const id = deleteTargetId();
    setDeleteTargetId(null);
    if (!id) return;
    void removeDocument(id).catch((error) => {
      console.error("[takos-docs] Failed to delete document", error);
    });
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  };

  const filtered = () => {
    const q = search().toLowerCase();
    const docs = [...documents()].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    if (!q) return docs;
    return docs.filter((d) => d.title.toLowerCase().includes(q));
  };

  return (
    <div class="min-h-screen bg-white dark:bg-neutral-900 text-gray-800 dark:text-neutral-100">
      <a
        href="#main"
        class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[130] focus:rounded-lg focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-lg"
      >
        {t("skipToMain")}
      </a>
      {/* Header */}
      <header class="border-b border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 sticky top-0 z-10">
        <div class="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <OfficeNav />

          {/* Search */}
          <div class="order-last basis-full md:order-none md:basis-0 md:flex-1 max-w-xl mx-auto">
            <div class="relative">
              <Search
                size={18}
                aria-hidden="true"
                class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-neutral-400 pointer-events-none"
              />
              <input
                type="search"
                placeholder={t("searchDocuments")}
                aria-label={t("searchDocuments")}
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (isImeComposing(e)) return;
                  if (e.key === "Escape" && search()) {
                    e.preventDefault();
                    setSearch("");
                  }
                }}
                class="w-full min-h-11 sm:min-h-9 pl-10 pr-4 py-2 bg-gray-100 dark:bg-neutral-800 rounded-lg text-sm text-gray-800 dark:text-neutral-100 placeholder-gray-500 dark:placeholder-neutral-400 outline-none focus:bg-white dark:focus:bg-neutral-800 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 border border-transparent transition-all"
              />
            </div>
          </div>

          <div class="shrink-0 flex items-center gap-1">
            <ThemeToggle t={t} />
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      {/* Content */}
      <main id="main" tabIndex={-1} class="max-w-5xl mx-auto px-4 sm:px-6 py-8 outline-none">
        <h1 class="sr-only">Takos {t("doc")}</h1>
        {/* New document section */}
        <div class="mb-8">
          <h2 class="text-sm font-medium text-gray-500 dark:text-neutral-400 mb-3">
            {t("startNewDocument")}
          </h2>
          <div class="flex flex-wrap items-start gap-4">
          <button
            type="button"
            onClick={handleCreate}
            class="group w-40 h-52 border-2 border-dashed border-gray-300 dark:border-neutral-700 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-500/10 transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <div class="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center group-hover:bg-blue-700 transition-colors">
              <Plus size={24} class="text-white" />
            </div>
            <span class="text-sm text-gray-600 dark:text-neutral-300 group-hover:text-blue-700 dark:group-hover:text-blue-400">
              {t("blankDocument")}
            </span>
          </button>
          <div class="flex flex-col gap-2 max-w-sm">
            <input ref={fileInput} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" class="hidden" aria-label={t("importDocx")}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void handleImport(file);
              }} />
            <button type="button" disabled={importing()} onClick={() => fileInput.click()}
              class="flex items-center gap-2 px-4 py-3 rounded-lg border border-gray-300 dark:border-neutral-600 hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-50">
              <Upload size={18} />{t("importDocx")}
            </button>
            <p class="text-xs text-gray-500 dark:text-neutral-400">{t("fileImportHelp")}</p>
            <Show when={importing()}>
              <div role="status" aria-busy="true" class="text-sm">
                {t(importSaving() ? "importSaving" : "importing")}
                <Show when={!importSaving()}><button type="button" class="ml-3 underline" onClick={cancelImport}>{t("cancel")}</button></Show>
              </div>
            </Show>
            <Show when={importError()}>{(code) => (
              <p role="alert" class="text-sm text-red-700 dark:text-red-300">{t({invalid:"fileInvalid", "too-large":"fileTooLarge", unsafe:"fileUnsafe", unsupported:"fileUnsupported", timeout:"fileTimeout", save:"importSaveFailed"}[code()] as "fileInvalid" | "fileTooLarge" | "fileUnsafe" | "fileUnsupported" | "fileTimeout" | "importSaveFailed")}</p>
            )}</Show>
            <Show when={imported()}>{(result) => (
              <div role="status" class="text-sm">
                <p>{t(result().hasUnsupportedContent ? "fileFormattingWarning" : "importComplete")}</p>
                <button type="button" class="mt-2 text-blue-700 dark:text-blue-300 underline" onClick={() => navigate(withCurrentSpaceId(`/${result().document.id}`))}>{t("openImportedDocument")}</button>
              </div>
            )}</Show>
          </div>
          </div>
        </div>

        {/* Recent documents */}
        <Show when={loadError()}>
          <div
            role="alert"
            class="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
          >
            <span class="min-w-0 flex-1">{t("loadDocumentsFailed")}</span>
            <button
              type="button"
              class="rounded-md border border-red-300 dark:border-red-800 px-3 py-1.5 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
              onClick={fetchDocuments}
            >
              {t("retry")}
            </button>
          </div>
        </Show>

        <Show
          when={!isLoading()}
          fallback={
            <div aria-busy="true" aria-label={t("loadingDocuments")}>
              <h2 class="text-sm font-medium text-gray-500 dark:text-neutral-400 mb-3">
                {t("recentDocuments")}
              </h2>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <For each={[0, 1, 2, 3]}>
                  {() => (
                    <div class="border border-gray-200 dark:border-neutral-700 rounded-lg overflow-hidden animate-pulse">
                      <div class="h-32 bg-gray-100 dark:bg-neutral-800" />
                      <div class="p-3 space-y-2">
                        <div class="h-3.5 w-3/4 rounded bg-gray-200 dark:bg-neutral-700" />
                        <div class="h-3 w-1/2 rounded bg-gray-100 dark:bg-neutral-800" />
                      </div>
                    </div>
                  )}
                </For>
              </div>
              <span class="sr-only">{t("loadingDocuments")}</span>
            </div>
          }
        >
          <Show
            when={filtered().length > 0}
            fallback={
              <Show when={!loadError()}>
                <Show
                  when={documents().length === 0}
                  fallback={
                    <div class="flex flex-col items-center justify-center py-16 text-center">
                      <p class="text-sm text-gray-600 dark:text-neutral-300 mb-3">
                        {t("noMatchingDocuments")}
                      </p>
                      <button
                        type="button"
                        class="rounded-md border border-gray-300 dark:border-neutral-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
                        onClick={() => setSearch("")}
                      >
                        {t("clearSearch")}
                      </button>
                    </div>
                  }
                >
                  <div class="flex flex-col items-center justify-center py-20 text-center">
                    <div class="w-20 h-20 rounded-full bg-gray-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
                      <FileText size={36} class="text-gray-400 dark:text-neutral-500" />
                    </div>
                    <h2 class="text-base font-medium text-gray-700 dark:text-neutral-200 mb-1">
                      {t("noDocumentsTitle")}
                    </h2>
                    <p class="text-sm text-gray-500 dark:text-neutral-400">
                      {t("noDocumentsDescription")}
                    </p>
                  </div>
                </Show>
              </Show>
            }
          >
            <h2 class="text-sm font-medium text-gray-500 dark:text-neutral-400 mb-3">
              {t("recentDocuments")}
            </h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <For each={filtered()}>
                {(doc) => (
                  <DocumentCard
                    document={doc}
                    onClick={() => navigate(withCurrentSpaceId(`/${doc.id}`))}
                    onDelete={() => handleDelete(doc.id)}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>
      </main>
      <ConfirmDialog
        open={deleteTargetId() !== null}
        title={t("deleteDocumentTitle")}
        message={t("deleteDocumentConfirm")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  );
}
