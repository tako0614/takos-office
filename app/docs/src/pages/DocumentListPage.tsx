import { createSignal, For, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { FileText, Plus, Search } from "lucide-solid";
import type { Document } from "../types";
import {
  addDocument,
  loadDocumentsFromApi,
  removeDocument,
} from "../lib/storage";
import DocumentCard from "../components/DocumentCard";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useI18n } from "../i18n";

export default function DocumentListPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [documents, setDocuments] = createSignal<Document[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [search, setSearch] = createSignal("");

  onMount(() => {
    void loadDocumentsFromApi()
      .then(setDocuments)
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  });

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
    navigate(`/${doc.id}`);
  };

  const handleDelete = (id: string) => {
    if (!confirm(t("deleteDocumentConfirm"))) return;
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
    <div class="min-h-screen bg-white">
      {/* Header */}
      <header class="border-b border-gray-200 bg-white sticky top-0 z-10">
        <div class="max-w-5xl mx-auto px-6 py-3 flex items-center gap-4">
          <div class="flex items-center gap-2.5 shrink-0">
            <div class="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
              <FileText size={22} class="text-white" />
            </div>
            <span class="text-lg font-medium text-gray-800">Takos Docs</span>
          </div>

          {/* Search */}
          <div class="flex-1 max-w-xl mx-auto">
            <div class="relative">
              <Search
                size={18}
                class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder={t("searchDocuments")}
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
                class="w-full pl-10 pr-4 py-2 bg-gray-100 rounded-lg text-sm text-gray-700 placeholder-gray-400 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 border border-transparent transition-all"
              />
            </div>
          </div>

          <div class="shrink-0">
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      {/* Content */}
      <main class="max-w-5xl mx-auto px-6 py-8">
        {/* New document section */}
        <div class="mb-8">
          <h2 class="text-sm font-medium text-gray-500 mb-3">
            {t("startNewDocument")}
          </h2>
          <button
            type="button"
            onClick={handleCreate}
            class="group w-40 h-52 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-blue-400 hover:bg-blue-50/50 transition-all cursor-pointer"
          >
            <div class="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center group-hover:bg-blue-700 transition-colors">
              <Plus size={24} class="text-white" />
            </div>
            <span class="text-sm text-gray-600 group-hover:text-blue-700">
              {t("blankDocument")}
            </span>
          </button>
        </div>

        {/* Recent documents */}
        <Show
          when={filtered().length > 0}
          fallback={
            <Show when={!isLoading() && documents().length === 0}>
              <div class="flex flex-col items-center justify-center py-20 text-center">
                <div class="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                  <FileText size={36} class="text-gray-400" />
                </div>
                <h2 class="text-base font-medium text-gray-700 mb-1">
                  {t("noDocumentsTitle")}
                </h2>
                <p class="text-sm text-gray-500">
                  {t("noDocumentsDescription")}
                </p>
              </div>
            </Show>
          }
        >
          <h2 class="text-sm font-medium text-gray-500 mb-3">
            {t("recentDocuments")}
          </h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <For each={filtered()}>
              {(doc) => (
                <DocumentCard
                  document={doc}
                  onClick={() => navigate(`/${doc.id}`)}
                  onDelete={() => handleDelete(doc.id)}
                />
              )}
            </For>
          </div>
        </Show>
      </main>
    </div>
  );
}
