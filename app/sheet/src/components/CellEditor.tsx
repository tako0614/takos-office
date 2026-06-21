import { Component, onMount } from "solid-js";

interface CellEditorProps {
  value: string;
  left: number;
  top: number;
  width: number;
  height: number;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onTab: (shiftKey: boolean) => void;
}

export const CellEditor: Component<CellEditorProps> = (props) => {
  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    inputRef?.focus();
  });

  return (
    <input
      ref={inputRef}
      class="absolute z-20 border-2 border-blue-500 bg-neutral-900 px-1 text-sm text-neutral-100 outline-none"
      style={{
        left: `${props.left}px`,
        top: `${props.top}px`,
        width: `${props.width}px`,
        height: `${props.height}px`,
        "box-sizing": "border-box",
      }}
      value={props.value}
      onInput={(e) => props.onChange(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          props.onSubmit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          props.onCancel();
        } else if (e.key === "Tab") {
          e.preventDefault();
          props.onTab(e.shiftKey);
        }
      }}
      onBlur={() => props.onSubmit()}
    />
  );
};
