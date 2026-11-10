import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { FormulaBar } from "../../app/sheet/src/components/FormulaBar.tsx";
import { CellEditor } from "../../app/sheet/src/components/CellEditor.tsx";
import { Grid } from "../../app/sheet/src/components/Grid.tsx";
import { SpreadsheetListPage } from "../../app/sheet/src/pages/SpreadsheetListPage.tsx";
import { Router, Route } from "@solidjs/router";

const [formula, setFormula] = createSignal("");
const [cell, setCell] = createSignal("");
const actions = { formula: [] as string[], cell: [] as string[] };
const [gridEditing, setGridEditing] = createSignal(false);
const [gridValue, setGridValue] = createSignal("");
const gridStarts: { address: string; value: string }[] = [];
const gridActions: { action: string; value: string }[] = [];
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
      <div id="grid" tabIndex={0} style={{ width: "800px", height: "300px" }}>
        <Grid
          sheet={{
            id: "sheet-ime",
            name: "Sheet1",
            cells: { A1: { value: "existing" } },
            colWidths: {},
            rowHeights: {},
          }}
          selectedCell="A1"
          selectionRange={null}
          isEditing={gridEditing()}
          editValue={gridValue()}
          onSelectCell={() => {}}
          onSelectionRange={() => {}}
          onColWidthChange={() => {}}
          onStartEdit={(address, value) => {
            gridStarts.push({ address, value: value ?? "" });
            setGridValue(value ?? "");
            setGridEditing(true);
          }}
          onEditChange={setGridValue}
          onSubmitEdit={() => {
            // EditorPage ignores the blur submit after editing has ended.
            if (!gridEditing()) return;
            gridActions.push({ action: "submit", value: gridValue() });
            setGridEditing(false);
          }}
          onCancelEdit={() => {
            if (!gridEditing()) return;
            gridActions.push({ action: "cancel", value: gridValue() });
            setGridEditing(false);
          }}
          onTabEdit={() => {
            if (!gridEditing()) return;
            gridActions.push({ action: "tab", value: gridValue() });
            setGridEditing(false);
          }}
        />
      </div>
      <div id="library">
        <Router>
          <Route path="/" component={SpreadsheetListPage} />
        </Router>
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
    grid: {
      starts: gridStarts,
      actions: gridActions,
      value: gridValue,
      editing: gridEditing,
    },
  },
});
