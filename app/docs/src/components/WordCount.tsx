import { createEffect, createSignal } from "solid-js";
import type { Editor } from "@tiptap/core";
import { useI18n } from "../i18n";

interface WordCountProps {
  editor: Editor | null;
}

export default function WordCount(props: WordCountProps) {
  const { t } = useI18n();
  const [words, setWords] = createSignal(0);
  const [chars, setChars] = createSignal(0);

  createEffect(() => {
    const editor = props.editor;
    if (!editor) return;

    const update = () => {
      const storage = editor.storage.characterCount;
      setChars(storage?.characters?.() ?? 0);
      setWords(storage?.words?.() ?? 0);
    };
    update();
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  });

  return (
    <footer class="flex items-center justify-end gap-4 px-4 py-1.5 border-t border-gray-200 bg-gray-50 text-xs text-gray-500 shrink-0">
      <span>
        {t(words() === 1 ? "wordCountSingular" : "wordCount", {
          count: words(),
        })}
      </span>
      <span>
        {t(chars() === 1 ? "characterCountSingular" : "characterCount", {
          count: chars(),
        })}
      </span>
    </footer>
  );
}
