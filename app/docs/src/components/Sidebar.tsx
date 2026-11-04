import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { Editor } from "@tiptap/core";
import { List } from "lucide-solid";
import { useI18n } from "../i18n";

interface HeadingItem {
  level: number;
  text: string;
  pos: number;
}

interface SidebarProps {
  editor: Editor | null;
}

export default function Sidebar(props: SidebarProps) {
  const { t } = useI18n();
  const [headings, setHeadings] = createSignal<HeadingItem[]>([]);
  const [collapsed, setCollapsed] = createSignal(false);
  const [phone, setPhone] = createSignal(false);
  const [phoneOpen, setPhoneOpen] = createSignal(false);
  const contentId = createUniqueId();
  const expanded = () => (phone() ? phoneOpen() : !collapsed());
  let toggleButton: HTMLButtonElement | undefined;

  onMount(() => {
    const media = matchMedia("(max-width: 767px)");
    const update = () => {
      const focusedInside = document
        .getElementById(contentId)
        ?.contains(document.activeElement);
      setPhone(media.matches);
      if (focusedInside && !expanded()) toggleButton?.focus();
    };
    update();
    media.addEventListener("change", update);
    onCleanup(() => media.removeEventListener("change", update));
  });

  const toggle = () => {
    if (phone()) setPhoneOpen(!phoneOpen());
    else setCollapsed(!collapsed());
  };

  const extractHeadings = () => {
    const editor = props.editor;
    if (!editor) return;

    const items: HeadingItem[] = [];
    const doc = editor.state.doc;
    doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        items.push({
          level: node.attrs.level as number,
          text: node.textContent,
          pos,
        });
      }
    });
    setHeadings(items);
  };

  createEffect(() => {
    const editor = props.editor;
    if (!editor) return;
    extractHeadings();
    const handler = () => extractHeadings();
    editor.on("update", handler);
    onCleanup(() => {
      editor.off("update", handler);
    });
  });

  const scrollToHeading = (pos: number) => {
    const editor = props.editor;
    if (!editor) return;
    editor
      .chain()
      .focus()
      .setTextSelection(pos + 1)
      .run();
    const view = editor.view;
    const el = view.nodeDOM(pos);
    if (phone()) setPhoneOpen(false);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const indent = (level: number) =>
    level === 1 ? "pl-0" : level === 2 ? "pl-3" : "pl-6";

  const textStyle = (level: number) =>
    level === 1
      ? "text-sm font-semibold text-gray-800 dark:text-neutral-100"
      : level === 2
        ? "text-sm text-gray-600 dark:text-neutral-300"
        : "text-xs text-gray-500 dark:text-neutral-400";

  return (
    <div
      class="docs-outline w-56 border-r border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 flex flex-col shrink-0"
      classList={{ "docs-outline-collapsed": !phone() && collapsed() }}
    >
      <div class="docs-outline-header flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-neutral-800">
        <span
          class="text-xs font-medium text-gray-400 dark:text-neutral-500 uppercase tracking-wider"
          classList={{ "sr-only": !phone() && collapsed() }}
        >
          {t("outline")}
        </span>
        <button
          ref={toggleButton}
          type="button"
          class="p-1 rounded text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onClick={toggle}
          title={expanded() ? t("collapse") : t("expand")}
          aria-label={t("toggleOutline")}
          aria-expanded={expanded()}
          aria-controls={contentId}
        >
          <List size={14} />
        </button>
      </div>

      <div
        id={contentId}
        hidden={!expanded()}
        class="min-h-0 flex-1 overflow-y-auto p-3"
      >
        <Show
          when={headings().length > 0}
          fallback={
            <p class="text-gray-400 dark:text-neutral-500 text-xs italic">
              {t("noHeadings")}
            </p>
          }
        >
          <nav class="flex flex-col gap-0.5">
            <For each={headings()}>
              {(heading) => (
                <button
                  type="button"
                  class={`text-left py-1 px-2 rounded truncate hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors ${indent(
                    heading.level,
                  )} ${textStyle(heading.level)}`}
                  onClick={() => scrollToHeading(heading.pos)}
                  title={heading.text}
                >
                  {heading.text || t("untitled")}
                </button>
              )}
            </For>
          </nav>
        </Show>
      </div>
    </div>
  );
}
