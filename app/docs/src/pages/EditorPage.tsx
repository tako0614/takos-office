import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { ArrowLeft, Cloud, CloudOff, Keyboard } from "lucide-solid";
import type { Editor as TipTapEditor } from "@tiptap/core";
import type { Document } from "../types";
import {
  DocumentConflictError,
  loadDocumentFromApi,
  updateDocumentInStorage,
} from "../lib/storage";
import { nextBoundDoc } from "../lib/editor-sync";
import Editor from "../components/Editor";
import Toolbar from "../components/Toolbar";
import Sidebar from "../components/Sidebar";
import WordCount from "../components/WordCount";
import FindReplace from "../components/FindReplace";
import ShortcutsHelp from "../components/ShortcutsHelp";
import LanguageSwitcher from "../components/LanguageSwitcher";
import ThemeToggle from "../../../shared/components/ThemeToggle";
import OfficeNav from "../components/OfficeNav";
import { useI18n } from "../i18n";

/**
 * Whether keyboard input is currently going into an editable field (an input,
 * textarea, select, or any contenteditable host such as the TipTap surface), so
 * single-key shortcuts like `?` don't fire while the user is typing.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

export default function EditorPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [doc, setDoc] = createSignal<Document | null>(null);
  const [editor, setEditor] = createSignal<TipTapEditor | null>(null);
  const [title, setTitle] = createSignal("");
  const [saveStatus, setSaveStatus] = createSignal<
    "saved" | "saving" | "failed" | "idle"
  >("idle");
  const [showFind, setShowFind] = createSignal(false);
  const [showShortcuts, setShowShortcuts] = createSignal(false);

  let saveTimeout: ReturnType<typeof setTimeout> | undefined;
  let saveStatusResetTimeout: ReturnType<typeof setTimeout> | undefined;

  // Open Find & Replace on Ctrl/Cmd+F (suppressing the browser's own find bar)
  // and the shortcuts help on `?` (Shift+/) when not typing in a field.
  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setShowFind(true);
        return;
      }
      if (
        e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey &&
        !isTypingTarget(e.target)
      ) {
        e.preventDefault();
        setShowShortcuts(true);
      }
    };
    globalThis.addEventListener("keydown", handler);
    onCleanup(() => globalThis.removeEventListener("keydown", handler));
  });

  createEffect(() => {
    const id = params.id;
    setDoc(null);
    setTitle("");
    void loadDocumentFromApi(id)
      .then((remote) => {
        setDoc((d) => nextBoundDoc(d, { kind: "load", doc: remote }));
        setTitle(remote.title);
      })
      .catch(() => navigate("/", { replace: true }));
  });

  onCleanup(() => {
    if (saveTimeout) clearTimeout(saveTimeout);
    if (saveStatusResetTimeout) clearTimeout(saveStatusResetTimeout);
  });

  const debouncedSave = (
    updates: Partial<Pick<Document, "title" | "content">>,
  ) => {
    setSaveStatus("saving");
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      const id = doc()?.id ?? params.id;
      void updateDocumentInStorage(id, updates)
        .then((updated) => {
          // A successful autosave echoes back the content we just sent. Do NOT
          // feed it back into the bound document: the editor already holds it
          // (plus any keystrokes typed during the round-trip), and re-applying
          // the echo would reset the editor mid-typing and drop those edits.
          // nextBoundDoc treats a saveEcho as a no-op. (The optimistic-
          // concurrency base lives in localStorage, not this signal.)
          if (updated) {
            setDoc((d) => nextBoundDoc(d, { kind: "saveEcho", doc: updated }));
          }
          setSaveStatus("saved");
          if (saveStatusResetTimeout) clearTimeout(saveStatusResetTimeout);
          saveStatusResetTimeout = setTimeout(
            () => setSaveStatus("idle"),
            2000,
          );
        })
        .catch((error) => {
          if (error instanceof DocumentConflictError) {
            // Another writer (e.g. an agent over MCP) changed the doc between
            // load and this autosave. Adopt their version instead of silently
            // overwriting it; the editor reloads from the refreshed content.
            setDoc((d) =>
              nextBoundDoc(d, { kind: "conflict", doc: error.current })
            );
            setTitle(error.current.title);
            setSaveStatus("saved");
            return;
          }
          console.error("[takos-docs] Failed to save document", error);
          setSaveStatus("failed");
        });
    }, 500);
  };

  const handleContentUpdate = (content: string) => {
    debouncedSave({ content });
  };

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    debouncedSave({ title: newTitle });
  };

  return (
    <div class="h-screen flex flex-col bg-white dark:bg-neutral-900 text-gray-800 dark:text-neutral-100">
      {/* Header bar */}
      <header class="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shrink-0">
        <button
          type="button"
          class="p-1.5 rounded-full text-gray-500 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onClick={() => navigate("/")}
          title={t("backToDocuments")}
          aria-label={t("backToDocuments")}
        >
          <ArrowLeft size={20} />
        </button>

        <OfficeNav />

        <div class="flex flex-col flex-1 min-w-0">
          <input
            type="text"
            value={title()}
            onInput={(e) => handleTitleChange(e.currentTarget.value)}
            class="text-lg font-normal text-gray-800 dark:text-neutral-100 outline-none border-none bg-transparent placeholder-gray-400 dark:placeholder-neutral-500 px-1 py-0.5 rounded hover:ring-1 hover:ring-gray-300 dark:hover:ring-neutral-600 focus:ring-2 focus:ring-blue-500 transition-all"
            placeholder={t("untitledDocument")}
          />
        </div>

        {/* Save indicator */}
        <div class="flex items-center gap-1.5 text-xs text-gray-400 dark:text-neutral-500 shrink-0 pr-2">
          <Show when={saveStatus() === "saving"}>
            <CloudOff size={14} />
            <span>{t("saving")}</span>
          </Show>
          <Show when={saveStatus() === "saved"}>
            <Cloud size={14} class="text-green-600" />
            <span class="text-green-600">{t("saved")}</span>
          </Show>
          <Show when={saveStatus() === "failed"}>
            <CloudOff size={14} class="text-red-600" />
            <span class="text-red-600">{t("saveFailed")}</span>
          </Show>
        </div>
        <button
          type="button"
          class="p-1.5 rounded-full text-gray-500 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onClick={() => setShowShortcuts(true)}
          title={t("keyboardShortcuts")}
          aria-label={t("keyboardShortcuts")}
          aria-haspopup="dialog"
        >
          <Keyboard size={18} />
        </button>
        <ThemeToggle t={t} />
        <LanguageSwitcher />
      </header>

      {/* Toolbar */}
      <Toolbar
        editor={editor()}
        documentTitle={title()}
        documentContent={doc()?.content ?? ""}
      />

      {/* Find & Replace */}
      <FindReplace
        editor={editor()}
        open={showFind()}
        onClose={() => setShowFind(false)}
      />

      {/* Keyboard shortcut help */}
      <ShortcutsHelp
        open={showShortcuts()}
        onClose={() => setShowShortcuts(false)}
      />

      {/* Main area: sidebar + paper */}
      <div class="flex flex-1 overflow-hidden">
        <Sidebar editor={editor()} />

        {/* Document area — gray background with centered white paper */}
        <div class="flex-1 overflow-y-auto bg-gray-100 dark:bg-neutral-950">
          <div class="max-w-[816px] mx-auto my-6 bg-white dark:bg-neutral-900 shadow-sm dark:shadow-black/40 border border-gray-200 dark:border-neutral-800 rounded-sm min-h-[1056px]">
            <Show when={doc()} fallback={<div />}>
              <Editor
                content={doc()!.content}
                onUpdate={handleContentUpdate}
                onEditorReady={(e) => setEditor(e)}
              />
            </Show>
          </div>
        </div>
      </div>

      {/* Footer — word count */}
      <WordCount editor={editor()} />
    </div>
  );
}
