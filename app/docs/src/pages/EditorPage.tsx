import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { ArrowLeft, Cloud, CloudOff, Keyboard } from "lucide-solid";
import type { Editor as TipTapEditor } from "@tiptap/core";
import type { Document } from "../types";
import {
  DocumentConflictError,
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
import { withCurrentSpaceId } from "../../../shared/lib/space-id";
import OfficeNav from "../components/OfficeNav";
import { useI18n } from "../i18n";
import { ConfirmDialog } from "../../../shared/components/OfficeDialog";
import { isImeComposing } from "../../../shared/lib/dialog-a11y";

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
          status:
            saveKind() === "conflict"
              ? "保存の競合"
              : saveKind() === "draft"
                ? "未保存の下書きがあります"
                : "保存結果が不明です",
          message:
            saveKind() === "conflict"
              ? "別の場所で文書が変更されています。下書きはエディターに残っています。"
              : saveKind() === "draft"
                ? "この端末に下書きが残っています。サーバーの内容を確認して保存するか、下書きを破棄できます。"
                : "保存を確認できません。下書きはエディターに残っています。",
          replaceConfirm:
            "サーバーの最新内容をこの下書きで置き換えますか？別の場所で行われた変更も上書きされます。",
          retry: "自分の下書きで置き換える",
          reload: "サーバーの内容を読み直す",
          confirm:
            "この端末の未保存の変更を破棄し、サーバーの内容を読み直しますか？",
        }
      : {
          status:
            saveKind() === "conflict"
              ? "Save conflict"
              : saveKind() === "draft"
                ? "Unsaved draft"
                : "Save unconfirmed",
          message:
            saveKind() === "conflict"
              ? "This document changed elsewhere. Your draft is still in the editor."
              : saveKind() === "draft"
                ? "A draft is retained on this device. Check the server version before saving, or discard the draft."
                : "Save is unconfirmed. Your draft is still in the editor.",
          replaceConfirm:
            "Replace the latest server version with this draft? Changes made elsewhere will be overwritten.",
          retry: "Replace with my draft",
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
  const [saveKind, setSaveKind] = createSignal<"failed" | "conflict" | "draft">(
    "failed",
  );
  const [recovering, setRecovering] = createSignal(false);
  const [pendingRecovery, setPendingRecovery] = createSignal<
    "reload" | "replace" | null
  >(null);
  const [showFind, setShowFind] = createSignal(false);
  const [showShortcuts, setShowShortcuts] = createSignal(false);

  createEffect(() => {
    const name = title().trim() || t("untitledDocument");
    document.title = `${name} — Takos ${t("doc")}`;
  });

  let saveTimeout: ReturnType<typeof setTimeout> | undefined;
  let saveStatusResetTimeout: ReturnType<typeof setTimeout> | undefined;
  let routeVersion = 0;
  let editVersion = 0;
  let recoveryController: AbortController | undefined;
  type Patch = Partial<Pick<Document, "title" | "content">>;
  let pendingSave:
    | {
        write: ReturnType<typeof captureDocumentWriter>;
        updates: Patch;
        route: number;
        edit: number;
      }
    | undefined;

  function showSaveFailure(id: string, error?: unknown): void {
    let conflict = error instanceof DocumentConflictError;
    let draft = false;
    try {
      const state = getDocumentSaveState(id);
      conflict ||= state === "conflict";
      draft = state === "draft";
    } catch {
      /* Cache failures stay visible. */
    }
    setSaveKind(conflict ? "conflict" : draft ? "draft" : "failed");
    setSaveStatus("failed");
  }

  function flushSave(): Promise<void> | undefined {
    if (saveTimeout) clearTimeout(saveTimeout);
    const pending = pendingSave;
    pendingSave = undefined;
    if (!pending) return;
    const current = () =>
      routeVersion === pending.route && editVersion === pending.edit;
    return pending
      .write(pending.updates)
      .then((updated) => {
        if (!current()) return;
        if (!updated) throw new Error("Document is no longer available");
        if (getDocumentSaveState(updated.id) !== "clean") {
          showSaveFailure(updated.id);
          return;
        }
        // Never feed a successful echo back over keystrokes entered in flight.
        setDoc((d) => nextBoundDoc(d, { kind: "saveEcho", doc: updated }));
        setSaveStatus("saved");
        saveStatusResetTimeout = setTimeout(() => {
          if (current()) setSaveStatus("idle");
        }, 2000);
      })
      .catch((error) => {
        if (current()) showSaveFailure(params.id, error);
      });
  }

  // Open Find & Replace on Ctrl/Cmd+F (suppressing the browser's own find bar)
  // and the shortcuts help on `?` (Shift+/) when not typing in a field.
  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        recovering() ||
        pendingRecovery() !== null ||
        showShortcuts() ||
        isImeComposing(e)
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setShowFind(true);
        return;
      }
      if (
        e.key === "?" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
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
    recoveryController?.abort();
    recoveryController = undefined;
    routeVersion++;
    editVersion++;
    flushSave();
    if (saveStatusResetTimeout) clearTimeout(saveStatusResetTimeout);
    const selectedRoute = routeVersion;
    const selectedEdit = editVersion;
    setDoc(null);
    setTitle("");
    setSaveStatus("idle");
    setRecovering(false);
    setPendingRecovery(null);
    void loadDocumentFromApi(id, {
      isActive: () => routeVersion === selectedRoute,
    })
      .then((remote) => {
        if (routeVersion !== selectedRoute) return;
        setDoc((d) => nextBoundDoc(d, { kind: "load", doc: remote }));
        if (editVersion === selectedEdit) setTitle(remote.title);
        if (getDocumentSaveState(id) !== "clean") showSaveFailure(id);
      })
      .catch(() => {
        if (routeVersion === selectedRoute)
          navigate(`/${location.search}`, { replace: true });
      });
  });

  onCleanup(() => {
    recoveryController?.abort();
    routeVersion++;
    editVersion++;
    // Flush only the already-captured original operation; no route retargeting.
    flushSave();
    if (saveStatusResetTimeout) clearTimeout(saveStatusResetTimeout);
  });

  const debouncedSave = (
    updates: Partial<Pick<Document, "title" | "content">>,
  ) => {
    if (recovering()) return;
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
    try {
      pendingSave.write.stage(pendingSave.updates);
    } catch (error) {
      showSaveFailure(doc()?.id ?? params.id, error);
      return;
    }
    saveTimeout = setTimeout(flushSave, 500);
  };

  const requestRecoverSave = (reload: boolean) => {
    if (recovering()) return;
    setPendingRecovery(reload ? "reload" : "replace");
  };

  const executeRecoverSave = async (reload: boolean) => {
    setPendingRecovery(null);
    if (recovering()) return;
    const selectedRoute = routeVersion;
    const selectedEdit = ++editVersion;
    const id = doc()?.id ?? params.id;
    const controller = new AbortController();
    recoveryController = controller;
    const discardedPending = reload ? pendingSave : undefined;
    if (saveTimeout) clearTimeout(saveTimeout);
    if (saveStatusResetTimeout) clearTimeout(saveStatusResetTimeout);
    if (reload) pendingSave = undefined;
    setRecovering(true);
    setSaveStatus("saving");
    try {
      if (!reload) await flushSave();
      if (routeVersion !== selectedRoute || editVersion !== selectedEdit)
        return;
      const updated = reload
        ? await loadDocumentFromApi(id, {
            discardLocal: true,
            signal: controller.signal,
          })
        : await retryDocumentAfterConflict(id, { signal: controller.signal });
      if (routeVersion !== selectedRoute || editVersion !== selectedEdit)
        return;
      if (!updated) {
        if (reload) navigate(`/${location.search}`, { replace: true });
        else setSaveStatus("idle");
        return;
      }
      if (reload) {
        setDoc(updated);
        setTitle(updated.title);
      }
      if (getDocumentSaveState(id) !== "clean") showSaveFailure(id);
      else setSaveStatus(reload ? "idle" : "saved");
    } catch (error) {
      if (routeVersion === selectedRoute && editVersion === selectedEdit) {
        // A failed discard read did not replace the draft. Keep its unflushed
        // patch for the next explicit recovery instead of saving older cache.
        if (discardedPending)
          pendingSave = {
            ...discardedPending,
            edit: selectedEdit,
          };
        showSaveFailure(id, error);
      }
    } finally {
      if (recoveryController === controller) recoveryController = undefined;
      if (routeVersion === selectedRoute) setRecovering(false);
    }
  };

  const handleContentUpdate = (content: string) => {
    debouncedSave({ content });
  };

  const handleTitleChange = (newTitle: string) => {
    if (recovering()) return;
    setTitle(newTitle);
    debouncedSave({ title: newTitle });
  };

  return (
    <div class="h-screen flex flex-col bg-white dark:bg-neutral-900 text-gray-800 dark:text-neutral-100">
      <a
        href="#main"
        class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[130] focus:rounded-lg focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-lg"
      >
        {t("skipToMain")}
      </a>
      <h1 class="sr-only">{title().trim() || t("untitledDocument")}</h1>
      {/* Header bar */}
      <header class="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shrink-0">
        <button
          type="button"
          class="flex min-h-9 min-w-9 sm:min-h-8 sm:min-w-8 items-center justify-center rounded-full text-gray-600 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onClick={() => navigate(withCurrentSpaceId("/"))}
          title={t("backToDocuments")}
          aria-label={t("backToDocuments")}
        >
          <ArrowLeft size={20} />
        </button>

        <OfficeNav />

        <div class="order-last basis-full lg:order-none lg:basis-0 flex flex-col flex-1 min-w-0">
          <input
            type="text"
            value={title()}
            disabled={recovering() || !doc()}
            onInput={(e) => handleTitleChange(e.currentTarget.value)}
            aria-label={t("documentTitle")}
            class="w-full min-w-0 text-lg font-normal text-gray-800 dark:text-neutral-100 outline-none border-none bg-transparent placeholder-gray-500 dark:placeholder-neutral-400 px-1 py-0.5 rounded hover:ring-1 hover:ring-gray-300 dark:hover:ring-neutral-600 focus:ring-2 focus:ring-blue-500 transition-all"
            placeholder={t("untitledDocument")}
          />
        </div>

        {/* Save indicator */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          class="flex items-center gap-1.5 text-xs text-gray-600 dark:text-neutral-300 shrink-0 pr-2"
        >
          <Show when={saveStatus() === "saving"}>
            <CloudOff size={14} aria-hidden="true" />
            <span>{t("saving")}</span>
          </Show>
          <Show when={saveStatus() === "saved"}>
            <Cloud size={14} aria-hidden="true" class="text-green-700 dark:text-green-400" />
            <span class="text-green-700 dark:text-green-400">{t("saved")}</span>
          </Show>
          <Show when={saveStatus() === "failed"}>
            <CloudOff size={14} aria-hidden="true" class="text-red-700 dark:text-red-400" />
            <span class="text-red-700 dark:text-red-400">{recoveryLabels().status}</span>
          </Show>
        </div>
        <button
          type="button"
          class="flex min-h-9 min-w-9 sm:min-h-8 sm:min-w-8 items-center justify-center rounded-full text-gray-600 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onClick={() => setShowShortcuts(true)}
          disabled={recovering()}
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
            onClick={() => requestRecoverSave(false)}
          >
            {recoveryLabels().retry}
          </button>
          <button
            type="button"
            class="underline"
            onClick={() => requestRecoverSave(true)}
          >
            {recoveryLabels().reload}
          </button>
        </div>
      </Show>

      <div class="contents" inert={recovering()}>
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
        <main
          id="main"
          tabIndex={-1}
          class="docs-editor-main flex flex-1 min-h-0 min-w-0 overflow-hidden outline-none"
        >
          <Sidebar editor={editor()} />

          {/* Document area — gray background with centered white paper */}
          <div class="flex-1 min-h-0 min-w-0 overflow-y-auto bg-gray-100 dark:bg-neutral-950">
            <div class="docs-paper max-w-[816px] mx-auto my-6 bg-white dark:bg-neutral-900 shadow-sm dark:shadow-black/40 border border-gray-200 dark:border-neutral-800 rounded-sm min-h-[1056px]">
              <Show
                keyed
                when={doc()}
                fallback={
                  <div role="status" class="p-6 text-sm text-gray-600 dark:text-neutral-300">
                    {t("loadingDocuments")}
                  </div>
                }
              >
                <Editor
                  content={doc()!.content}
                  onUpdate={handleContentUpdate}
                  onEditorReady={(e) => setEditor(e)}
                />
              </Show>
            </div>
          </div>
        </main>

        {/* Footer — word count */}
        <WordCount editor={editor()} />
      </div>

      <ConfirmDialog
        open={pendingRecovery() !== null}
        title={recoveryLabels().status}
        message={pendingRecovery() === "reload"
          ? recoveryLabels().confirm
          : recoveryLabels().replaceConfirm}
        confirmLabel={pendingRecovery() === "reload"
          ? recoveryLabels().reload
          : recoveryLabels().retry}
        cancelLabel={t("cancel")}
        danger={pendingRecovery() === "reload"}
        busy={recovering()}
        onConfirm={() => void executeRecoverSave(pendingRecovery() === "reload")}
        onCancel={() => setPendingRecovery(null)}
      />
    </div>
  );
}
