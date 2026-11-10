import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { FormulaBar } from "../../app/sheet/src/components/FormulaBar.tsx";
import { CellEditor } from "../../app/sheet/src/components/CellEditor.tsx";

const [formula, setFormula] = createSignal("");
const [cell, setCell] = createSignal("");
const actions = { formula: [] as string[], cell: [] as string[] };
const events: {
  key: string;
  keyCode: number;
  isComposing: boolean;
  isTrusted: boolean;
  prevented: boolean;
}[] = [];

render(
  () => (
    <>
      <div id="formula">
        <FormulaBar
          cellAddress="A1"
          value={formula()}
          onValueChange={setFormula}
          onSubmit={() => actions.formula.push("submit")}
          onCancel={() => actions.formula.push("cancel")}
        />
      </div>
      <div id="cell">
        <CellEditor
          value={cell()}
          left={0}
          top={100}
          width={200}
          height={28}
          onChange={setCell}
          onSubmit={() => actions.cell.push("submit")}
          onCancel={() => actions.cell.push("cancel")}
          onTab={(shift) => actions.cell.push(shift ? "shift-tab" : "tab")}
        />
      </div>
    </>
  ),
  document.getElementById("root")!,
);

document.addEventListener("keydown", (event) =>
  events.push({
    key: event.key,
    keyCode: event.keyCode,
    isComposing: event.isComposing,
    isTrusted: event.isTrusted,
    prevented: event.defaultPrevented,
  }),
);
Object.assign(window, {
  sheetImeFixture: {
    actions,
    events,
    clear: () => {
      actions.formula.length = 0;
      actions.cell.length = 0;
      events.length = 0;
    },
  },
});
