import { Component } from "solid-js";

interface FormulaBarProps {
  cellAddress: string;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export const FormulaBar: Component<FormulaBarProps> = (props) => {
  return (
    <div class="flex h-8 items-center border-b border-neutral-700 bg-neutral-800 px-2">
      {/* Cell address display */}
      <div class="flex h-6 w-16 items-center justify-center rounded border border-neutral-600 bg-neutral-900 text-xs font-medium text-neutral-300">
        {props.cellAddress}
      </div>

      {/* fx label */}
      <div class="mx-2 text-xs font-medium italic text-neutral-500">fx</div>

      {/* Formula input */}
      <input
        class="h-6 flex-1 rounded border border-neutral-600 bg-neutral-900 px-2 text-sm text-neutral-100 outline-none focus:border-blue-500"
        value={props.value}
        onInput={(e) => props.onValueChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            props.onSubmit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            props.onCancel();
          }
        }}
      />
    </div>
  );
};
