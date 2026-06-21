import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import type { Presentation, SlideElement } from "../types";
import {
  createDefaultSlide,
  createImageElement,
  createShapeElement,
  createTextElement,
  loadPresentationFromApi,
  savePresentation,
} from "../lib/storage";
import SlideCanvas from "../components/SlideCanvas";
import SlidePanel from "../components/SlidePanel";
import ShapeToolbar from "../components/ShapeToolbar";
import PropertyPanel from "../components/PropertyPanel";
import { useI18n } from "../i18n";

export default function EditorPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
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

  // Load presentation
  createEffect(() => {
    setPresentation(null);
    void loadPresentationFromApi(params.id)
      .then((remote) => setPresentation(remote))
      .catch(() => navigate("/"));
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
    setPresentation(pres);
    const result = savePresentation(pres);
    void result.remote.catch((error) => {
      console.error("[takos-slide] Failed to save presentation", error);
    });
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
    navigate(`/${id}/present`);
  };

  const handleEditText = (elementId: string) => {
    setEditingTextId(elementId);
    setSelectedElementId(elementId);
  };

  // Keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    // Don't handle if editing text in an input
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
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
      fallback={<div class="p-8 text-gray-400">{t("loading")}</div>}
    >
      <div class="h-screen flex flex-col bg-gray-900">
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
          canUndo={undoStack().length > 0}
          canRedo={redoStack().length > 0}
          hasSelection={selectedElementId() !== null}
        />

        <div class="flex-1 flex overflow-hidden">
          {/* Left Panel - Slide thumbnails */}
          <SlidePanel
            slides={presentation()!.slides}
            selectedIndex={selectedSlideIndex()}
            onSelectSlide={(i) => {
              setSelectedSlideIndex(i);
              setSelectedElementId(null);
            }}
            onAddSlide={handleAddSlide}
            onDeleteSlide={handleDeleteSlide}
            onReorderSlide={handleReorderSlide}
          />

          {/* Center - Main canvas */}
          <Show when={currentSlide()}>
            <SlideCanvas
              slide={currentSlide()!}
              selectedElementId={selectedElementId()}
              onSelectElement={setSelectedElementId}
              onUpdateElement={handleUpdateElement}
              onEditText={handleEditText}
            />
          </Show>

          {/* Right Panel - Properties */}
          <PropertyPanel
            element={selectedElement()}
            onUpdateElement={handleUpdateElement}
            slideBackground={currentSlide()?.background ?? "#ffffff"}
            onUpdateBackground={handleUpdateBackground}
            onReorderElement={handleReorderElement}
          />
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
                    class="bg-gray-800 rounded-lg p-4 border border-gray-600 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 class="text-sm font-medium text-gray-300 mb-2">
                      {t("editText")}
                    </h3>
                    <textarea
                      class="w-80 h-32 bg-gray-700 text-gray-100 px-3 py-2 rounded border border-gray-600 outline-none focus:border-blue-500 resize-none text-sm"
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
          <div class="bg-gray-800 border-t border-gray-700 px-4 py-2">
            <label
              for="speaker-notes"
              class="block text-xs font-medium text-gray-400 mb-1"
            >
              {t("speakerNotes")}
            </label>
            <textarea
              id="speaker-notes"
              class="w-full h-16 bg-gray-700 text-gray-100 text-xs px-3 py-2 rounded border border-gray-600 outline-none focus:border-blue-500 resize-none"
              value={currentSlide()!.notes ?? ""}
              placeholder={t("speakerNotesPlaceholder")}
              onInput={(e) => handleUpdateNotes(e.currentTarget.value)}
            />
          </div>
        </Show>

        {/* Bottom bar */}
        <div class="h-7 bg-gray-800 border-t border-gray-700 flex items-center px-4 text-xs text-gray-500">
          <span>
            {t("slideCount", {
              current: selectedSlideIndex() + 1,
              total: presentation()!.slides.length,
            })}
          </span>
          <span class="mx-2">|</span>
          <button
            type="button"
            class="hover:text-gray-300 transition-colors"
            onClick={() => navigate("/")}
          >
            {t("backToList")}
          </button>
        </div>
      </div>
    </Show>
  );
}
