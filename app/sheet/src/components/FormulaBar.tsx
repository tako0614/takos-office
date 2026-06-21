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
    <div class="flex h-8 items-center border-b border-gray-200 bg-gray-50 px-2 dark:border-neutral-700 dark:bg-neutral-800">
      {/* Cell address display */}
      <div class="flex h-6 w-16 items-center justify-center rounded border border-gray-300 bg-white text-xs font-medium text-gray-700 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
        {props.cellAddress}
      </div>

      {/* fx label */}
      <div class="mx-2 text-xs font-medium italic text-gray-500 dark:text-neutral-500">fx</div>

      {/* Formula input */}
      <input
        class="h-6 flex-1 rounded border border-gray-300 bg-white px-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
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
