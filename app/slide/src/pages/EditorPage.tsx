import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { useLocation, useNavigate, useParams } from "@solidjs/router";
import type { Presentation, SlideElement } from "../types";
import {
  createDefaultSlide,
  createImageElement,
  createShapeElement,
  createTextElement,
  loadPresentationFromApi,
  getPresentation,
  getPresentationSaveState,
  capturePresentationWriter,
  retryPresentationAfterConflict,
} from "../lib/storage";
import SlideCanvas from "../components/SlideCanvas";
import SlidePanel from "../components/SlidePanel";
import ShapeToolbar from "../components/ShapeToolbar";
import PropertyPanel from "../components/PropertyPanel";
import OfficeNav from "../components/OfficeNav";
import ShortcutsHelp from "../components/ShortcutsHelp";
import { useI18n } from "../i18n";
import { withCurrentSpaceId } from "../../../shared/lib/space-id";
import { exportPptxFile } from "../lib/pptx-worker.ts";
import { downloadOfficeBlob, sanitizeFilename } from "../../../shared/lib/office-download.ts";

export default function EditorPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();

  const [presentation, setPresentation] = createSignal<Presentation | null>(
    null,
  );
  const [selectedSlideIndex, setSelectedSlideIndex] = createSignal(0);
  const [selectedElementId, setSelectedElementId] = createSignal<string | null>(
    null,
  );
  const [undoStack, setUndoStack] = createSignal<Presentation[]>([]);
  const [redoStack, setRedoStack] = createSignal<Presentation[]>([]);
  const [editingTextId, setEditingTextId] = createSignal<string | null>(null);
  const [showShortcuts, setShowShortcuts] = createSignal(false);
  const [mobilePanel, setMobilePanel] = createSignal<"slides" | "properties" | null>(null);
  let mobilePanelButton: HTMLButtonElement | undefined;

  const [saveKind, setSaveKind] = createSignal<ReturnType<typeof getPresentationSaveState>>("clean");
  const [recovering, setRecovering] = createSignal(false);
  const [recoveryError, setRecoveryError] = createSignal("");
  let owner: object | undefined;
  let writer: ReturnType<typeof capturePresentationWriter> | undefined;
  let editVersion = 0;
  let recoveryController: AbortController | undefined;
  const [exporting, setExporting] = createSignal(false);
  const [exportFailed, setExportFailed] = createSignal(false);
  const [exportWarning, setExportWarning] = createSignal(false);
  let exportController: AbortController | undefined;
  const refreshSaveKind = (failed = false) => {
    try {
      const state = getPresentationSaveState(params.id);
      setSaveKind(failed && state === "clean" ? "failed" : state);
    } catch { setSaveKind("failed"); }
  };

  // Capture a route binding before any asynchronous read or write.
  createEffect(() => {
    const id = params.id;
    void location.search;
    const binding = {}, controller = new AbortController();
    owner = binding;
    writer = capturePresentationWriter(id);
    editVersion++;
    setPresentation(null);
    setSelectedSlideIndex(0);
    setSelectedElementId(null);
    setEditingTextId(null);
    setMobilePanel(null);
    setUndoStack([]);
    setRedoStack([]);
    setRecovering(false);
    setRecoveryError("");
    setSaveKind("clean");
    setExporting(false);setExportFailed(false);setExportWarning(false);
    void loadPresentationFromApi(id, { signal: controller.signal }).then((remote) => {
      if (owner !== binding) return;
      setPresentation(remote);
      refreshSaveKind();
    }).catch(() => {
      if (owner !== binding || controller.signal.aborted) return;
      const retained = getPresentation(id);
      if (retained) { setPresentation(retained);refreshSaveKind(true); }
      else navigate(withCurrentSpaceId("/"));
    });
    onCleanup(() => {
      controller.abort();recoveryController?.abort();exportController?.abort();exportController=undefined;
      if (owner === binding) { owner = undefined;writer = undefined; }
    });
  });

  const currentSlide = createMemo(() => {
    const pres = presentation();
    if (!pres) return null;
    const idx = selectedSlideIndex();
    return pres.slides[idx] ?? null;
  });

  const selectedElement = createMemo(() => {
    const slide = currentSlide();
    const id = selectedElementId();
    if (!slide || !id) return null;
    return slide.elements.find((e) => e.id === id) ?? null;
  });

  const pushUndo = () => {
    const pres = presentation();
    if (!pres) return;
    setUndoStack((prev) => [...prev.slice(-50), structuredClone(pres)]);
    setRedoStack([]);
  };

  const persist = (pres: Presentation) => {
    if (!writer || !owner) return;
    const binding = owner, version = ++editVersion, id = params.id;
    setPresentation(pres);
    try {
      const result = writer(pres);
      refreshSaveKind();
      void result.remote.then(() => {
        if (owner !== binding) return;
        if (version === editVersion) {
          const acknowledged = getPresentation(id);
          if (acknowledged) setPresentation(acknowledged);
        }
        refreshSaveKind();
      }).catch(() => { if (owner === binding) refreshSaveKind(true); });
    } catch { refreshSaveKind(true); }
  };

  const reconcile = async (discard: boolean) => {
    if (recovering() || !owner) return;
    if (!confirm(t(discard ? "discardDraftConfirm" : "replaceDraftConfirm"))) return;
    const binding = owner, version = editVersion, id = params.id;
    const controller = new AbortController();
    recoveryController = controller;
    setRecovering(true);setRecoveryError("");
    try {
      const result = discard
        ? await loadPresentationFromApi(id, { discardLocal: true, signal: controller.signal })
        : await retryPresentationAfterConflict(id, { signal: controller.signal });
      if (owner !== binding) return;
      if (!discard && result === null) throw new Error("No retained draft is available");
      if (version === editVersion) {
        if (result) {
          setPresentation(result);setUndoStack([]);setRedoStack([]);
          setSelectedSlideIndex(0);setSelectedElementId(null);setEditingTextId(null);
        } else if (discard) navigate(withCurrentSpaceId("/"));
      } else if (discard) setRecoveryError(t("newerEditsKept"));
      refreshSaveKind();
    } catch {
      if (owner === binding && !controller.signal.aborted) {
        setRecoveryError(t("saveRecoveryFailed"));refreshSaveKind(true);
      }
    } finally { if (owner === binding) setRecovering(false); }
  };

  const updateSlide = (
    updater: (elements: SlideElement[]) => SlideElement[],
  ) => {
    const pres = presentation();
    if (!pres) return;
    pushUndo();
    const idx = selectedSlideIndex();
    const newSlides = [...pres.slides];
    newSlides[idx] = {
      ...newSlides[idx],
      elements: updater([...newSlides[idx].elements]),
    };
    persist({ ...pres, slides: newSlides });
  };

  const handleUpdateElement = (updated: SlideElement) => {
    updateSlide((elements) =>
      elements.map((e) => (e.id === updated.id ? updated : e))
    );
  };

  const handleInsertText = () => {
    const el = createTextElement(330, 240, t("defaultTextElement"));
    updateSlide((elements) => [...elements, el]);
    setSelectedElementId(el.id);
  };

  const handleInsertShape = (
    shape: "rect" | "ellipse" | "triangle" | "arrow",
  ) => {
    const el = createShapeElement(shape, 380, 195);
    updateSlide((elements) => [...elements, el]);
    setSelectedElementId(el.id);
  };

  const handleInsertImage = () => {
    const url = prompt(t("enterImageUrl"));
    if (!url) return;
    const el = createImageElement(url, 330, 170);
    updateSlide((elements) => [...elements, el]);
    setSelectedElementId(el.id);
  };

  const handleDelete = () => {
    const id = selectedElementId();
    if (!id) return;
    updateSlide((elements) => elements.filter((e) => e.id !== id));
    setSelectedElementId(null);
  };

  // Restack the selected element within the slide's draw order. Elements are
  // painted in array order, so the last element is on top.
  const handleReorderElement = (
    action: "front" | "back" | "forward" | "backward",
  ) => {
    const id = selectedElementId();
    if (!id) return;
    updateSlide((elements) => {
      const idx = elements.findIndex((e) => e.id === id);
      if (idx === -1) return elements;
      const next = [...elements];
      const [el] = next.splice(idx, 1);
      if (action === "front") {
        next.push(el);
      } else if (action === "back") {
        next.unshift(el);
      } else if (action === "forward") {
        next.splice(Math.min(idx + 1, next.length), 0, el);
      } else {
        next.splice(Math.max(idx - 1, 0), 0, el);
      }
      return next;
    });
  };

  const handleUndo = () => {
    const stack = undoStack();
    if (stack.length === 0) return;
    const pres = presentation();
    if (pres) {
      setRedoStack((prev) => [...prev, structuredClone(pres)]);
    }
    const prev = stack[stack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    persist(prev);
  };

  const handleRedo = () => {
    const stack = redoStack();
    if (stack.length === 0) return;
    const pres = presentation();
    if (pres) {
      setUndoStack((prev) => [...prev, structuredClone(pres)]);
    }
    const next = stack[stack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    persist(next);
  };

  const handleAddSlide = () => {
    const pres = presentation();
    if (!pres) return;
    pushUndo();
    const newSlide = createDefaultSlide();
    const newSlides = [...pres.slides, newSlide];
    persist({ ...pres, slides: newSlides });
    setSelectedSlideIndex(newSlides.length - 1);
    setSelectedElementId(null);
  };

  const handleDeleteSlide = (index: number) => {
    const pres = presentation();
    if (!pres || pres.slides.length <= 1) return;
    pushUndo();
    const newSlides = pres.slides.filter((_, i) => i !== index);
    persist({ ...pres, slides: newSlides });
    if (selectedSlideIndex() >= newSlides.length) {
      setSelectedSlideIndex(newSlides.length - 1);
    }
    setSelectedElementId(null);
  };

  const handleReorderSlide = (from: number, to: number) => {
    const pres = presentation();
    if (!pres) return;
    pushUndo();
    const newSlides = [...pres.slides];
    const [moved] = newSlides.splice(from, 1);
    newSlides.splice(to, 0, moved);
    persist({ ...pres, slides: newSlides });
    setSelectedSlideIndex(to);
  };

  const handleTitleChange = (title: string) => {
    const pres = presentation();
    if (!pres) return;
    persist({ ...pres, title });
  };

  const handleUpdateBackground = (color: string) => {
    const pres = presentation();
    if (!pres) return;
    pushUndo();
    const idx = selectedSlideIndex();
    const newSlides = [...pres.slides];
    newSlides[idx] = { ...newSlides[idx], background: color };
    persist({ ...pres, slides: newSlides });
  };

  const handleUpdateNotes = (notes: string) => {
    const pres = presentation();
    if (!pres) return;
    pushUndo();
    const idx = selectedSlideIndex();
    const newSlides = [...pres.slides];
    newSlides[idx] = { ...newSlides[idx], notes };
    persist({ ...pres, slides: newSlides });
  };

  const handlePresent = () => {
    const id = presentation()?.id ?? params.id;
    navigate(withCurrentSpaceId(`/${id}/present`));
  };

  const handleExportPptx = async () => {
    const current = presentation(), binding = owner;
    if (!current || !binding || exporting()) return;
    const snapshot = structuredClone(current), controller = new AbortController();
    exportController = controller;
    setExporting(true);setExportFailed(false);setExportWarning(false);
    try {
      const result = await exportPptxFile(snapshot,controller.signal);
      if (owner!==binding || controller.signal.aborted) return;
      downloadOfficeBlob(result.blob,`${sanitizeFilename(snapshot.title)}.pptx`,controller.signal);
      setExportWarning(result.hasUnsupportedContent);
    } catch {
      if (owner===binding && !controller.signal.aborted) setExportFailed(true);
    } finally {
      if (owner===binding && !controller.signal.aborted) setExporting(false);
      if (exportController===controller) exportController=undefined;
    }
  };

  const handleEditText = (elementId: string) => {
    setEditingTextId(elementId);
    setSelectedElementId(elementId);
  };

  // Keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && mobilePanel()) {
      e.preventDefault();
      setMobilePanel(null);
      mobilePanelButton?.focus();
      return;
    }
    // Don't handle if editing text in an input
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    // While the shortcuts help is open, let it own the keyboard (it handles its
    // own Esc / focus trap) and don't run editor shortcuts underneath it.
    if (showShortcuts()) return;

    // "?" (Shift + /) opens the shortcuts help when not typing in a field.
    if (e.key === "?") {
      e.preventDefault();
      setShowShortcuts(true);
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      handleDelete();
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
      if (e.key === "y") {
        e.preventDefault();
        handleRedo();
      }
    }
    if (e.key === "Escape") {
      setSelectedElementId(null);
      setEditingTextId(null);
    }
  };

  document.addEventListener("keydown", handleKeyDown);
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

  return (
    <Show
      when={presentation()}
      fallback={
        <div class="h-screen bg-gray-50 dark:bg-gray-900 p-8 text-gray-500 dark:text-gray-400">
          {t("loading")}
        </div>
      }
    >
      <div class="h-screen flex flex-col bg-gray-100 dark:bg-gray-900">
        {/* Office nav - return to the shell / switch apps from inside a deck */}
        <div class="bg-white border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700 px-4 py-2">
          <OfficeNav />
        </div>

            <Show when={saveKind() === "pending"}>
              <p role="status" class="px-4 py-1 text-sm text-gray-600 dark:text-gray-300">{t("savePending")}</p>
            </Show>
            <Show when={saveKind() === "conflict" || saveKind() === "failed"}>
              <div role="alert" class="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:bg-gray-800 dark:text-gray-100">
                <strong>{t(saveKind() === "conflict" ? "saveConflict" : "saveUnconfirmed")}</strong>
                <p>{t("saveRecoveryHint")}</p>
                <Show when={recoveryError()}><p>{recoveryError()}</p></Show>
                <div class="mt-2 flex flex-wrap gap-3">
                  <button type="button" class="rounded border px-3 py-1 disabled:opacity-50" disabled={recovering()} onClick={() => void reconcile(false)}>{t("replaceDraft")}</button>
                  <button type="button" class="rounded border px-3 py-1 disabled:opacity-50" disabled={recovering()} onClick={() => void reconcile(true)}>{t("readServer")}</button>
                </div>
              </div>
            </Show>

        {/* Toolbar */}
        <ShapeToolbar
          presentationTitle={presentation()!.title}
          onTitleChange={handleTitleChange}
          onInsertText={handleInsertText}
          onInsertShape={handleInsertShape}
          onInsertImage={handleInsertImage}
          onDelete={handleDelete}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onPresent={handlePresent}
          onExportPptx={() => void handleExportPptx()}
          exporting={exporting()}
          onShowHelp={() => setShowShortcuts(true)}
          canUndo={undoStack().length > 0}
          canRedo={redoStack().length > 0}
          hasSelection={selectedElementId() !== null}
        />
        <Show when={exportFailed()}><p role="alert" class="px-4 py-2 text-sm text-red-700 dark:text-red-300">{t("exportFailed")}</p></Show>
        <Show when={exportWarning()}><p role="status" class="px-4 py-2 text-sm text-amber-800 dark:text-amber-300">{t("fileFormattingWarning")}</p></Show>

        <div class="flex shrink-0 gap-3 border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800 md:hidden">
          <button type="button" class="rounded border px-3 py-1 text-sm text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-100" aria-controls="slide-navigation-panel" aria-expanded={mobilePanel() === "slides"}
            onClick={(event) => { mobilePanelButton = event.currentTarget;setMobilePanel(mobilePanel() === "slides" ? null : "slides"); }}>{t("slides")}</button>
          <button type="button" class="rounded border px-3 py-1 text-sm text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-100" aria-controls="slide-properties-panel" aria-expanded={mobilePanel() === "properties"}
            onClick={(event) => { mobilePanelButton = event.currentTarget;setMobilePanel(mobilePanel() === "properties" ? null : "properties"); }}>{t("properties")}</button>
        </div>

        <div class="relative min-h-0 flex-1 flex overflow-hidden">
          {/* Left Panel - Slide thumbnails */}
          <div id="slide-navigation-panel" class="absolute inset-y-0 left-0 z-10 shrink-0 md:static md:block" classList={{ hidden: mobilePanel() !== "slides" }}>
          <SlidePanel
            slides={presentation()!.slides}
            slideSize={presentation()!.slideSize}
            selectedIndex={selectedSlideIndex()}
            onSelectSlide={(i) => {
              setSelectedSlideIndex(i);
              setSelectedElementId(null);
              setMobilePanel(null);
            }}
            onAddSlide={handleAddSlide}
            onDeleteSlide={handleDeleteSlide}
            onReorderSlide={handleReorderSlide}
          />
          </div>

          {/* Center - Main canvas */}
          <Show when={currentSlide()}>
            <SlideCanvas
              slide={currentSlide()!}
              slideSize={presentation()!.slideSize}
              selectedElementId={selectedElementId()}
              onSelectElement={setSelectedElementId}
              onUpdateElement={handleUpdateElement}
              onEditText={handleEditText}
            />
          </Show>

          {/* Right Panel - Properties */}
          <div id="slide-properties-panel" class="absolute inset-y-0 right-0 z-10 shrink-0 md:static md:block" classList={{ hidden: mobilePanel() !== "properties" }}>
          <PropertyPanel
            element={selectedElement()}
            onUpdateElement={handleUpdateElement}
            slideBackground={currentSlide()?.background ?? "#ffffff"}
            onUpdateBackground={handleUpdateBackground}
            onReorderElement={handleReorderElement}
          />
          </div>
        </div>

        {/* Inline text editor overlay */}
        <Show when={editingTextId()}>
          {(id) => {
            const el = () =>
              currentSlide()?.elements.find((e) => e.id === id());
            return (
              <Show when={el()}>
                <div
                  class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
                  onClick={() => setEditingTextId(null)}
                >
                  <div
                    class="bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-600 rounded-lg p-4 border shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t("editText")}
                    </h3>
                    <textarea
                      class="w-80 h-32 bg-gray-50 text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600 px-3 py-2 rounded border outline-none focus:border-blue-500 resize-none text-sm"
                      value={el()!.text ?? ""}
                      onInput={(e) => {
                        handleUpdateElement({
                          ...el()!,
                          text: e.currentTarget.value,
                        });
                      }}
                      autofocus
                    />
                    <div class="flex justify-end mt-3">
                      <button
                        type="button"
                        class="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded text-sm transition-colors"
                        onClick={() => setEditingTextId(null)}
                      >
                        {t("done")}
                      </button>
                    </div>
                  </div>
                </div>
              </Show>
            );
          }}
        </Show>

        {/* Speaker notes */}
        <Show when={currentSlide()}>
          <div class="bg-white border-t border-gray-200 dark:bg-gray-800 dark:border-gray-700 px-4 py-2">
            <label
              for="speaker-notes"
              class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1"
            >
              {t("speakerNotes")}
            </label>
            <textarea
              id="speaker-notes"
              class="w-full h-16 bg-gray-50 text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600 text-xs px-3 py-2 rounded border outline-none focus:border-blue-500 resize-none"
              value={currentSlide()!.notes ?? ""}
              placeholder={t("speakerNotesPlaceholder")}
              onInput={(e) => handleUpdateNotes(e.currentTarget.value)}
            />
          </div>
        </Show>

        {/* Keyboard shortcuts help */}
        <Show when={showShortcuts()}>
          <ShortcutsHelp
            open={showShortcuts()}
            onClose={() => setShowShortcuts(false)}
          />
        </Show>

        {/* Bottom bar */}
        <div class="h-7 bg-white border-t border-gray-200 dark:bg-gray-800 dark:border-gray-700 flex items-center px-4 text-xs text-gray-500 dark:text-gray-500">
          <span>
            {t("slideCount", {
              current: selectedSlideIndex() + 1,
              total: presentation()!.slides.length,
            })}
          </span>
          <span class="mx-2">|</span>
          <button
            type="button"
            class="hover:text-gray-800 dark:hover:text-gray-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
            aria-label={t("backToList")}
            onClick={() => navigate(withCurrentSpaceId("/"))}
          >
            {t("backToList")}
          </button>
        </div>
      </div>
    </Show>
  );
}
