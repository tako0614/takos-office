import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js";
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  ChevronDown,
  ChevronUp,
  CaseSensitive,
  X,
} from "lucide-solid";
import { useI18n } from "../i18n";
import { isImeComposing, restoreFocus } from "../../../shared/lib/dialog-a11y";
import {
  findMatches,
  type MatchRange,
  nextMatchIndex,
  previousMatchIndex,
  type TextSpan,
} from "../lib/find-replace.ts";

interface FindReplaceProps {
  editor: Editor | null;
  open: boolean;
  onClose: () => void;
}

const searchPluginKey = new PluginKey("docsSearchHighlight");

/**
 * Collect the editor's text nodes as spans carrying the ProseMirror position of
 * each node's first character, so concatenated-text match offsets map back to
 * PM ranges (see lib/find-replace.ts).
 */
function collectSpans(doc: PmNode): TextSpan[] {
  const spans: TextSpan[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && typeof node.text === "string") {
      spans.push({ text: node.text, from: pos });
    }
    return true;
  });
  return spans;
}

/** A ProseMirror plugin that paints inline decorations over match ranges. */
function buildHighlightPlugin(
  matches: MatchRange[],
  activeIndex: number,
): Plugin {
  return new Plugin({
    key: searchPluginKey,
    props: {
      decorations(state) {
        if (matches.length === 0) return DecorationSet.empty;
        const decorations = matches.map((m, i) =>
          Decoration.inline(m.from, m.to, {
            class: i === activeIndex
              ? "docs-search-match docs-search-match-active"
              : "docs-search-match",
          })
        );
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

export default function FindReplace(props: FindReplaceProps) {
  const { t } = useI18n();
  const [query, setQuery] = createSignal("");
  const [replacement, setReplacement] = createSignal("");
  const [caseSensitive, setCaseSensitive] = createSignal(false);
  const [matches, setMatches] = createSignal<MatchRange[]>([]);
  const [activeIndex, setActiveIndex] = createSignal(-1);

  let findInputRef: HTMLInputElement | undefined;
  let opener: HTMLElement | null = null;
  let wasOpen = false;
  let pluginActive = false;

  const removePlugin = () => {
    const editor = props.editor;
    if (editor && pluginActive && !editor.isDestroyed) {
      editor.unregisterPlugin(searchPluginKey);
      pluginActive = false;
    }
  };

  /** Re-register the highlight plugin with the current matches/active index. */
  const paint = (ranges: MatchRange[], active: number) => {
    const editor = props.editor;
    if (!editor || editor.isDestroyed) return;
    removePlugin();
    editor.registerPlugin(buildHighlightPlugin(ranges, active));
    pluginActive = true;
  };

  /** Recompute matches for the current query against the live document. */
  const recompute = (preserveCursor = false) => {
    const editor = props.editor;
    if (!editor || editor.isDestroyed) {
      setMatches([]);
      setActiveIndex(-1);
      return;
    }
    const spans = collectSpans(editor.state.doc);
    const found = findMatches(spans, query(), caseSensitive());
    setMatches(found);

    if (found.length === 0) {
      setActiveIndex(-1);
      paint([], -1);
      return;
    }
    // Choose the active match nearest the caret (so re-searching after typing
    // keeps you near where you were) unless we're told to keep the index.
    let next = activeIndex();
    if (!preserveCursor || next < 0 || next >= found.length) {
      const cursor = editor.state.selection.from;
      next = nextMatchIndex(found, cursor);
    }
    setActiveIndex(next);
    paint(found, next);
  };

  /** Move selection to the active match and scroll it into view. */
  const focusMatch = (index: number) => {
    const editor = props.editor;
    const list = matches();
    if (!editor || editor.isDestroyed || index < 0 || index >= list.length) {
      return;
    }
    const { from, to } = list[index];
    editor.commands.setTextSelection({ from, to });
    editor.commands.scrollIntoView();
    paint(list, index);
  };

  const goNext = () => {
    const list = matches();
    if (list.length === 0) return;
    const editor = props.editor;
    const cursor = editor ? editor.state.selection.to : 0;
    // From the current selection, pick the first match starting at/after it,
    // but if we're already sitting on the active match, advance by one.
    let index = nextMatchIndex(list, cursor);
    if (index === activeIndex()) index = (index + 1) % list.length;
    setActiveIndex(index);
    focusMatch(index);
  };

  const goPrevious = () => {
    const list = matches();
    if (list.length === 0) return;
    const editor = props.editor;
    const cursor = editor ? editor.state.selection.from : 0;
    let index = previousMatchIndex(list, cursor);
    if (index === activeIndex()) {
      index = (index - 1 + list.length) % list.length;
    }
    setActiveIndex(index);
    focusMatch(index);
  };

  const replaceCurrent = () => {
    const editor = props.editor;
    const list = matches();
    const index = activeIndex();
    if (!editor || editor.isDestroyed || index < 0 || index >= list.length) {
      return;
    }
    const { from, to } = list[index];
    editor
      .chain()
      .focus()
      .insertContentAt({ from, to }, replacement())
      .run();
    // The document changed; recompute and stay near the same spot.
    recompute(false);
    queueMicrotask(() => goNext());
  };

  const replaceAll = () => {
    const editor = props.editor;
    if (!editor || editor.isDestroyed) return;
    const list = matches();
    if (list.length === 0) return;
    const replaceText = replacement();

    // Apply right-to-left in a single transaction so earlier replacements don't
    // shift the positions of later ones, and the whole batch is one undo step.
    let chain = editor.chain().setMeta("addToHistory", true);
    for (let i = list.length - 1; i >= 0; i--) {
      const { from, to } = list[i];
      chain = chain.insertContentAt({ from, to }, replaceText);
    }
    chain.run();
    recompute(false);
  };

  // Focus the find field when the panel opens; seed from the current selection.
  // Only track `props.open` so typing/navigating matches never re-selects the
  // input or overwrites the captured opener.
  createEffect(() => {
    if (!props.open) return;
    wasOpen = true;
    opener = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    untrack(() => {
      const editor = props.editor;
      if (editor && !editor.isDestroyed) {
        const { from, to } = editor.state.selection;
        const selected = editor.state.doc.textBetween(from, to);
        if (selected && !selected.includes("\n")) setQuery(selected);
      }
    });
    queueMicrotask(() => {
      findInputRef?.focus();
      findInputRef?.select();
    });
  });

  // Clear highlights and restore focus when the panel closes.
  createEffect(() => {
    if (!props.open) {
      setMatches([]);
      setActiveIndex(-1);
      untrack(() => removePlugin());
      if (wasOpen) {
        wasOpen = false;
        const prev = opener;
        opener = null;
        queueMicrotask(() => {
          const editor = untrack(() => props.editor);
          if (
            editor &&
            !editor.isDestroyed &&
            (!prev || prev.closest(".tiptap"))
          ) {
            editor.commands.focus();
          } else {
            restoreFocus(prev);
          }
        });
      }
    }
  });

  // Re-run search when the panel opens, editor attaches, query changes, or
  // case-sensitivity toggles (untracking activeIndex inside recompute).
  createEffect(() => {
    const isOpen = props.open;
    const editor = props.editor;
    query();
    caseSensitive();
    if (isOpen && editor) {
      untrack(() => recompute(false));
    }
  });

  onCleanup(removePlugin);

  const counterLabel = () => {
    const total = matches().length;
    if (query().length === 0) return "";
    if (total === 0) return t("noMatches");
    const current = activeIndex() >= 0 ? activeIndex() + 1 : 1;
    return t("matchCounter", { current, total });
  };

  return (
    <Show when={props.open}>
      <div
        class="flex items-center gap-2 px-3 py-1.5 border-t border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 flex-wrap"
        role="search"
        aria-label={t("findAndReplace")}
        onKeyDown={(e) => {
          if (isImeComposing(e)) return;
          if (e.key === "Escape") {
            e.preventDefault();
            props.onClose();
          }
        }}
      >
        <div class="flex items-center gap-1">
          <input
            ref={findInputRef}
            type="text"
            placeholder={t("findPlaceholder")}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) goPrevious();
                else goNext();
              }
            }}
            aria-label={t("find")}
            class="w-44 bg-gray-50 dark:bg-neutral-800 text-gray-800 dark:text-neutral-100 text-sm px-3 py-1.5 rounded-md border border-gray-300 dark:border-neutral-600 outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            class="text-xs text-gray-500 dark:text-neutral-400 min-w-12 tabular-nums"
          >
            {counterLabel()}
          </span>
        </div>

        <button
          type="button"
          class={`inline-flex min-h-11 min-w-11 sm:min-h-7 sm:min-w-7 items-center justify-center p-1.5 rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            caseSensitive()
              ? "bg-blue-100 text-blue-700 dark:bg-blue-500/25 dark:text-blue-300"
              : "text-gray-600 hover:bg-gray-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          }`}
          onClick={() => setCaseSensitive((v) => !v)}
          title={t("caseSensitive")}
          aria-label={t("caseSensitive")}
          aria-pressed={caseSensitive()}
        >
          <CaseSensitive size={16} />
        </button>

        <button
          type="button"
          class="inline-flex min-h-11 min-w-11 sm:min-h-7 sm:min-w-7 items-center justify-center p-1.5 rounded text-gray-600 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40"
          onClick={goPrevious}
          disabled={matches().length === 0}
          title={t("previousMatch")}
          aria-label={t("previousMatch")}
        >
          <ChevronUp size={16} />
        </button>
        <button
          type="button"
          class="inline-flex min-h-11 min-w-11 sm:min-h-7 sm:min-w-7 items-center justify-center p-1.5 rounded text-gray-600 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40"
          onClick={goNext}
          disabled={matches().length === 0}
          title={t("nextMatch")}
          aria-label={t("nextMatch")}
        >
          <ChevronDown size={16} />
        </button>

        <div class="w-px h-5 bg-gray-300 dark:bg-neutral-700 mx-0.5 self-center" />

        <input
          type="text"
          placeholder={t("replacePlaceholder")}
          value={replacement()}
          onInput={(e) => setReplacement(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === "Enter") {
              e.preventDefault();
              replaceCurrent();
            }
          }}
          aria-label={t("replace")}
          class="w-44 bg-gray-50 dark:bg-neutral-800 text-gray-800 dark:text-neutral-100 text-sm px-3 py-1.5 rounded-md border border-gray-300 dark:border-neutral-600 outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
        />
        <button
          type="button"
          class="min-h-11 sm:min-h-7 px-3 py-1.5 text-gray-700 dark:text-neutral-200 text-sm rounded-md hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40"
          onClick={replaceCurrent}
          disabled={matches().length === 0}
        >
          {t("replace")}
        </button>
        <button
          type="button"
          class="min-h-11 sm:min-h-7 px-3 py-1.5 text-gray-700 dark:text-neutral-200 text-sm rounded-md hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40"
          onClick={replaceAll}
          disabled={matches().length === 0}
        >
          {t("replaceAll")}
        </button>

        <button
          type="button"
          class="ml-auto inline-flex min-h-11 min-w-11 sm:min-h-7 sm:min-w-7 items-center justify-center p-1.5 rounded text-gray-500 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onClick={props.onClose}
          title={t("closeFind")}
          aria-label={t("closeFind")}
        >
          <X size={16} />
        </button>
      </div>
    </Show>
  );
}
