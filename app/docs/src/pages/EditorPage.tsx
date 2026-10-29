import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { ArrowLeft, Cloud, CloudOff, Keyboard } from "lucide-solid";
import type { Editor as TipTapEditor } from "@tiptap/core";
import type { Document } from "../types";
import {
  captureDocumentWriter,
  getDocumentSaveState,
  loadDocumentFromApi,
  retryDocumentAfterConflict,
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
  const location = useLocation();
  const { t, language } = useI18n();
  const recoveryLabels = () =>
    language() === "ja"
      ? {
          message: "保存を確認できません。変更はエディターに残っています。",
          retry: "この変更で再試行",
          reload: "サーバーの内容を読み直す",
          confirm:
            "この端末の未保存の変更を破棄し、サーバーの内容を読み直しますか？",
        }
      : {
          message: "Save is unconfirmed. Your changes are still in the editor.",
          retry: "Retry my changes",
          reload: "Reload server version",
          confirm:
            "Discard this device's unsaved changes and reload the server version?",
        };

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
  let routeVersion = 0;
  let editVersion = 0;
  type Patch = Partial<Pick<Document, "title" | "content">>;
  let pendingSave:
    | {
        write: ReturnType<typeof captureDocumentWriter>;
        updates: Patch;
        route: number;
        edit: number;
      }
    | undefined;

  function flushSave(): void {
    if (saveTimeout) clearTimeout(saveTimeout);
    const pending = pendingSave;
    pendingSave = undefined;
    if (!pending) return;
    const current = () =>
      routeVersion === pending.route && editVersion === pending.edit;
    void pending
      .write(pending.updates)
      .then((updated) => {
        if (!current()) return;
        if (!updated) throw new Error("Document is no longer available");
        // Never feed a successful echo back over keystrokes entered in flight.
        setDoc((d) => nextBoundDoc(d, { kind: "saveEcho", doc: updated }));
        setSaveStatus("saved");
        saveStatusResetTimeout = setTimeout(() => {
          if (current()) setSaveStatus("idle");
        }, 2000);
      })
      .catch(() => {
        if (current()) setSaveStatus("failed");
      });
  }

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
    // Query-only Workspace navigation must fence old asynchronous completions.
    void location.search;
    routeVersion++;
    editVersion++;
    flushSave();
    if (saveStatusResetTimeout) clearTimeout(saveStatusResetTimeout);
    const selectedRoute = routeVersion;
    setDoc(null);
    setTitle("");
    setSaveStatus("idle");
    void loadDocumentFromApi(id)
      .then((remote) => {
        if (routeVersion !== selectedRoute) return;
        setDoc((d) => nextBoundDoc(d, { kind: "load", doc: remote }));
        setTitle(remote.title);
        if (getDocumentSaveState(id) !== "clean") setSaveStatus("failed");
      })
      .catch(() => {
        if (routeVersion === selectedRoute) navigate("/", { replace: true });
      });
  });

  onCleanup(() => {
    routeVersion++;
    editVersion++;
    // Flush only the already-captured original operation; no route retargeting.
    flushSave();
    if (saveStatusResetTimeout) clearTimeout(saveStatusResetTimeout);
  });

  const debouncedSave = (
    updates: Partial<Pick<Document, "title" | "content">>,
  ) => {
    setSaveStatus("saving");
    editVersion++;
    if (saveStatusResetTimeout) clearTimeout(saveStatusResetTimeout);
    if (saveTimeout) clearTimeout(saveTimeout);
    pendingSave = {
      write:
        pendingSave?.write ?? captureDocumentWriter(doc()?.id ?? params.id),
      updates: { ...pendingSave?.updates, ...updates },
      route: routeVersion,
      edit: editVersion,
    };
    saveTimeout = setTimeout(flushSave, 500);
  };

  const recoverSave = async (reload: boolean) => {
    if (reload && !globalThis.confirm(recoveryLabels().confirm)) return;
    const selectedRoute = routeVersion;
    const selectedEdit = ++editVersion;
    const id = doc()?.id ?? params.id;
    setSaveStatus("saving");
    try {
      const updated = reload
        ? await loadDocumentFromApi(id, { discardLocal: true })
        : await retryDocumentAfterConflict(id);
      if (routeVersion !== selectedRoute || editVersion !== selectedEdit)
        return;
      if (!updated) throw new Error("Document is no longer available");
      if (reload) {
        setDoc(updated);
        setTitle(updated.title);
      }
      setSaveStatus(reload ? "idle" : "saved");
    } catch {
      if (routeVersion === selectedRoute && editVersion === selectedEdit)
        setSaveStatus("failed");
    }
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

      <Show when={saveStatus() === "failed"}>
        <div
          role="alert"
          class="flex flex-wrap items-center gap-3 px-4 py-2 text-sm text-red-700 bg-red-50 dark:bg-red-950 dark:text-red-200"
        >
          <span>{recoveryLabels().message}</span>
          <button
            type="button"
            class="underline"
            onClick={() => void recoverSave(false)}
          >
            {recoveryLabels().retry}
          </button>
          <button
            type="button"
            class="underline"
            onClick={() => void recoverSave(true)}
          >
            {recoveryLabels().reload}
          </button>
        </div>
      </Show>

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
