import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Editor as TipTapEditor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Color from "@tiptap/extension-color";
import TextStyle from "@tiptap/extension-text-style";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import FontFamily from "@tiptap/extension-font-family";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import CharacterCount from "@tiptap/extension-character-count";
import { useI18n } from "../i18n";

interface EditorProps {
  content: string;
  onUpdate: (content: string) => void;
  onEditorReady?: (editor: TipTapEditor) => void;
}

function isSafeEditorUrl(url: string): boolean {
  const trimmed = url.trim();
  for (const char of trimmed) {
    const code = char.codePointAt(0);
    if (code !== undefined && (code <= 0x1f || code === 0x7f)) return false;
  }

  try {
    const base = globalThis.location?.origin ?? "https://takos.local";
    const parsed = new URL(trimmed, base);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function parseEditorContent(content: string): JSONContent | undefined {
  if (!content) return undefined;

  try {
    return JSON.parse(content) as JSONContent;
  } catch {
    return {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: content }],
        },
      ],
    };
  }
}

export default function Editor(props: EditorProps) {
  const { t } = useI18n();
  let editorRef!: HTMLDivElement;
  let editorInstance: TipTapEditor | null = null;
  const [isReady, setIsReady] = createSignal(false);

  onMount(() => {
    editorInstance = new TipTapEditor({
      element: editorRef,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
        }),
        Placeholder.configure({
          placeholder: () => t("typeSomething"),
        }),
        Underline,
        TextAlign.configure({
          types: ["heading", "paragraph"],
        }),
        Color,
        TextStyle,
        Image.configure({
          inline: false,
          allowBase64: false,
        }),
        Link.configure({
          openOnClick: false,
          validate: isSafeEditorUrl,
          HTMLAttributes: {
            rel: "noopener noreferrer",
            target: "_blank",
          },
        }),
        Table.configure({ resizable: true }),
        TableRow,
        TableCell,
        TableHeader,
        Highlight.configure({ multicolor: true }),
        TaskList,
        TaskItem.configure({ nested: true }),
        FontFamily,
        Superscript,
        Subscript,
        CharacterCount,
      ],
      content: parseEditorContent(props.content),
      onUpdate: ({ editor }) => {
        const json = JSON.stringify(editor.getJSON());
        props.onUpdate(json);
      },
      onCreate: ({ editor }) => {
        setIsReady(true);
        props.onEditorReady?.(editor);
      },
      editorProps: {
        attributes: {
          class: "tiptap",
        },
      },
    });
  });

  createEffect(() => {
    const content = props.content;
    if (!isReady() || !editorInstance) return;

    const currentJson = JSON.stringify(editorInstance.getJSON());
    if (content && content !== currentJson) {
      const parsed = parseEditorContent(content);
      if (parsed) editorInstance.commands.setContent(parsed, false);
    }
  });

  onCleanup(() => {
    editorInstance?.destroy();
    editorInstance = null;
  });

  return (
    <div
      ref={editorRef}
      class="flex-1 overflow-y-auto"
    />
  );
}
