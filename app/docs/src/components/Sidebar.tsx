import { createEffect, createSignal, For, Show } from "solid-js";
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
    return () => {
      editor.off("update", handler);
    };
  });

  const scrollToHeading = (pos: number) => {
    const editor = props.editor;
    if (!editor) return;
    editor.chain().focus().setTextSelection(pos).run();
    const view = editor.view;
    const dom = view.domAtPos(pos);
    const el = dom.node instanceof HTMLElement
      ? dom.node
      : dom.node.parentElement;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
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
    <div class="w-56 border-r border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 flex flex-col shrink-0">
      <div class="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-neutral-800">
        <span class="text-xs font-medium text-gray-400 dark:text-neutral-500 uppercase tracking-wider">
          {t("outline")}
        </span>
        <button
          type="button"
          class="p-1 rounded text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onClick={() => setCollapsed(!collapsed())}
          title={collapsed() ? t("expand") : t("collapse")}
          aria-label={t("toggleOutline")}
          aria-expanded={!collapsed()}
        >
          <List size={14} />
        </button>
      </div>

      <Show when={!collapsed()}>
        <div class="flex-1 overflow-y-auto p-3">
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
                    class={`text-left py-1 px-2 rounded truncate hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors ${
                      indent(heading.level)
                    } ${textStyle(heading.level)}`}
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
      </Show>
    </div>
  );
}
