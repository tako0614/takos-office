import {
  Component,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { CellData, CellFormat, Sheet } from "../types";
import {
  columnToLetter,
  formatCellAddress,
  parseCellAddress,
} from "../lib/cell-utils";
import { evaluateConditionalRules } from "../lib/conditional-format";
import { CellEditor } from "./CellEditor";

const TOTAL_COLS = 100;
const TOTAL_ROWS = 1000;
const DEFAULT_COL_WIDTH = 100;
const DEFAULT_ROW_HEIGHT = 28;
const HEADER_WIDTH = 50; // row number column width
const HEADER_HEIGHT = 28; // column header row height

interface GridProps {
  sheet: Sheet;
  selectedCell: string;
  selectionRange: { start: string; end: string } | null;
  isEditing: boolean;
  editValue: string;
  onSelectCell: (address: string) => void;
  onStartEdit: (address: string, value?: string) => void;
  onEditChange: (value: string) => void;
  onSubmitEdit: () => void;
  onCancelEdit: () => void;
  onTabEdit: (shiftKey: boolean) => void;
  onSelectionRange: (range: { start: string; end: string } | null) => void;
  onColWidthChange: (colIndex: number, width: number) => void;
}

export const Grid: Component<GridProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;

  const [scrollLeft, setScrollLeft] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerWidth, setContainerWidth] = createSignal(800);
  const [containerHeight, setContainerHeight] = createSignal(600);
  const [resizingCol, setResizingCol] = createSignal<number | null>(null);
  const [resizeStartX, setResizeStartX] = createSignal(0);
  const [resizeStartWidth, setResizeStartWidth] = createSignal(0);

  // Get column width
  const getColWidth = (col: number) =>
    props.sheet.colWidths[col] ?? DEFAULT_COL_WIDTH;

  // Get row height
  const getRowHeight = (row: number) =>
    props.sheet.rowHeights[row] ?? DEFAULT_ROW_HEIGHT;

  // Compute cumulative column positions
  const colPositions = createMemo(() => {
    const positions: number[] = [0];
    for (let c = 0; c < TOTAL_COLS; c++) {
      positions.push(positions[c] + getColWidth(c));
    }
    return positions;
  });

  // Compute cumulative row positions
  const rowPositions = createMemo(() => {
    const positions: number[] = [0];
    for (let r = 0; r < TOTAL_ROWS; r++) {
      positions.push(positions[r] + getRowHeight(r));
    }
    return positions;
  });

  // Total grid dimensions
  const totalWidth = createMemo(
    () => colPositions()[TOTAL_COLS] + HEADER_WIDTH,
  );
  const totalHeight = createMemo(
    () => rowPositions()[TOTAL_ROWS] + HEADER_HEIGHT,
  );

  // Visible column range
  const visibleCols = createMemo(() => {
    const sl = scrollLeft();
    const cw = containerWidth();
    const positions = colPositions();

    let startCol = 0;
    for (let c = 0; c < TOTAL_COLS; c++) {
      if (positions[c + 1] > sl) {
        startCol = c;
        break;
      }
    }

    let endCol = startCol;
    for (let c = startCol; c < TOTAL_COLS; c++) {
      endCol = c;
      if (positions[c] > sl + cw) break;
    }

    return { start: startCol, end: Math.min(endCol + 1, TOTAL_COLS) };
  });

  // Visible row range
  const visibleRows = createMemo(() => {
    const st = scrollTop();
    const ch = containerHeight();
    const positions = rowPositions();

    let startRow = 0;
    for (let r = 0; r < TOTAL_ROWS; r++) {
      if (positions[r + 1] > st) {
        startRow = r;
        break;
      }
    }

    let endRow = startRow;
    for (let r = startRow; r < TOTAL_ROWS; r++) {
      endRow = r;
      if (positions[r] > st + ch) break;
    }

    return { start: startRow, end: Math.min(endRow + 1, TOTAL_ROWS) };
  });

  // Selected cell parsed
  const selectedParsed = createMemo(() => {
    try {
      return parseCellAddress(props.selectedCell);
    } catch {
      return { col: 0, row: 0 };
    }
  });

  // Selection range parsed
  const selectionBounds = createMemo(() => {
    const range = props.selectionRange;
    if (!range) return null;
    try {
      const start = parseCellAddress(range.start);
      const end = parseCellAddress(range.end);
      return {
        minCol: Math.min(start.col, end.col),
        maxCol: Math.max(start.col, end.col),
        minRow: Math.min(start.row, end.row),
        maxRow: Math.max(start.row, end.row),
      };
    } catch {
      return null;
    }
  });

  // Check if cell is in selection range
  const isCellInRange = (col: number, row: number) => {
    const bounds = selectionBounds();
    if (!bounds) return false;
    return (
      col >= bounds.minCol &&
      col <= bounds.maxCol &&
      row >= bounds.minRow &&
      row <= bounds.maxRow
    );
  };

  // Get cell display value
  const getCellDisplay = (col: number, row: number): string => {
    const addr = formatCellAddress(col, row);
    const cell = props.sheet.cells[addr];
    if (!cell) return "";
    return cell.computed ?? cell.value;
  };

  // Get cell data
  const getCellData = (col: number, row: number): CellData | undefined => {
    const addr = formatCellAddress(col, row);
    return props.sheet.cells[addr];
  };

  // Conditional formatting: evaluate once whenever sheet data changes
  const conditionalFormats = createMemo(() => {
    const rules = props.sheet.conditionalRules;
    if (!rules || rules.length === 0) return {};
    return evaluateConditionalRules(rules, props.sheet.cells);
  });

  /** Merge base cell format with any conditional formatting overrides. */
  const getMergedFormat = (
    col: number,
    row: number,
  ): CellFormat | undefined => {
    const addr = formatCellAddress(col, row);
    const base = props.sheet.cells[addr]?.format;
    const cond = conditionalFormats()[addr];
    if (!base && !cond) return undefined;
    return { ...(base ?? {}), ...(cond ?? {}) };
  };

  // Handle scroll
  const handleScroll = () => {
    if (!containerRef) return;
    setScrollLeft(containerRef.scrollLeft);
    setScrollTop(containerRef.scrollTop);
  };

  // Handle cell click
  const handleCellClick = (col: number, row: number, e: MouseEvent) => {
    const addr = formatCellAddress(col, row);
    if (e.shiftKey) {
      // Range selection
      props.onSelectionRange({
        start: props.selectionRange?.start ?? props.selectedCell,
        end: addr,
      });
    } else {
      props.onSelectCell(addr);
      props.onSelectionRange(null);
    }
  };

  // Handle cell double click
  const handleCellDblClick = (col: number, row: number) => {
    const addr = formatCellAddress(col, row);
    const cell = props.sheet.cells[addr];
    props.onStartEdit(addr, cell?.value ?? "");
  };

  // Handle keydown for navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.isEditing) return;

    const { col, row } = selectedParsed();

    const navigate = (newCol: number, newRow: number, shift: boolean) => {
      const clampedCol = Math.max(0, Math.min(TOTAL_COLS - 1, newCol));
      const clampedRow = Math.max(0, Math.min(TOTAL_ROWS - 1, newRow));
      const addr = formatCellAddress(clampedCol, clampedRow);
      if (shift) {
        props.onSelectionRange({
          start: props.selectionRange?.start ?? props.selectedCell,
          end: addr,
        });
      } else {
        props.onSelectionRange(null);
      }
      props.onSelectCell(addr);
      scrollCellIntoView(clampedCol, clampedRow);
    };

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        navigate(col, row - 1, e.shiftKey);
        break;
      case "ArrowDown":
        e.preventDefault();
        navigate(col, row + 1, e.shiftKey);
        break;
      case "ArrowLeft":
        e.preventDefault();
        navigate(col - 1, row, e.shiftKey);
        break;
      case "ArrowRight":
        e.preventDefault();
        navigate(col + 1, row, e.shiftKey);
        break;
      case "Tab":
        e.preventDefault();
        navigate(e.shiftKey ? col - 1 : col + 1, row, false);
        break;
      case "Enter":
        e.preventDefault();
        if (e.shiftKey) {
          navigate(col, row - 1, false);
        } else {
          const cell = getCellData(col, row);
          props.onStartEdit(
            formatCellAddress(col, row),
            cell?.value ?? "",
          );
        }
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        props.onStartEdit(formatCellAddress(col, row), "");
        props.onSubmitEdit();
        break;
      case "Escape":
        props.onSelectionRange(null);
        break;
      default:
        // Start typing into cell
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          props.onStartEdit(formatCellAddress(col, row), e.key);
        }
        break;
    }
  };

  // Scroll a cell into view
  const scrollCellIntoView = (col: number, row: number) => {
    if (!containerRef) return;
    const positions = colPositions();
    const rowPos = rowPositions();

    const cellLeft = positions[col];
    const cellRight = positions[col] + getColWidth(col);
    const cellTop = rowPos[row];
    const cellBottom = rowPos[row] + getRowHeight(row);

    const viewLeft = containerRef.scrollLeft;
    const viewRight = viewLeft + containerRef.clientWidth - HEADER_WIDTH;
    const viewTop = containerRef.scrollTop;
    const viewBottom = viewTop + containerRef.clientHeight - HEADER_HEIGHT;

    if (cellLeft < viewLeft) containerRef.scrollLeft = cellLeft;
    else if (cellRight > viewRight) {
      containerRef.scrollLeft = cellRight -
        (containerRef.clientWidth - HEADER_WIDTH);
    }

    if (cellTop < viewTop) containerRef.scrollTop = cellTop;
    else if (cellBottom > viewBottom) {
      containerRef.scrollTop = cellBottom -
        (containerRef.clientHeight - HEADER_HEIGHT);
    }
  };

  // Column resize handlers
  const handleResizeMouseDown = (
    col: number,
    e: MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingCol(col);
    setResizeStartX(e.clientX);
    setResizeStartWidth(getColWidth(col));
  };

  const handleResizeMouseMove = (e: MouseEvent) => {
    const col = resizingCol();
    if (col === null) return;
    const diff = e.clientX - resizeStartX();
    const newWidth = Math.max(30, resizeStartWidth() + diff);
    props.onColWidthChange(col, newWidth);
  };

  const handleResizeMouseUp = () => {
    setResizingCol(null);
  };

  // Editor position
  const editorPosition = createMemo(() => {
    const { col, row } = selectedParsed();
    const positions = colPositions();
    const rowPos = rowPositions();
    return {
      left: positions[col] + HEADER_WIDTH - scrollLeft(),
      top: rowPos[row] + HEADER_HEIGHT - scrollTop(),
      width: getColWidth(col),
      height: getRowHeight(row),
    };
  });

  // Observe container size
  onMount(() => {
    if (!containerRef) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(containerRef);

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousemove", handleResizeMouseMove);
    document.addEventListener("mouseup", handleResizeMouseUp);

    onCleanup(() => {
      observer.disconnect();
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousemove", handleResizeMouseMove);
      document.removeEventListener("mouseup", handleResizeMouseUp);
    });
  });

  // Build visible column indices
  const visibleColIndices = createMemo(() => {
    const { start, end } = visibleCols();
    const indices: number[] = [];
    for (let c = start; c < end; c++) indices.push(c);
    return indices;
  });

  // Build visible row indices
  const visibleRowIndices = createMemo(() => {
    const { start, end } = visibleRows();
    const indices: number[] = [];
    for (let r = start; r < end; r++) indices.push(r);
    return indices;
  });

  return (
    <div
      ref={containerRef}
      class="relative flex-1 overflow-auto bg-neutral-900"
      onScroll={handleScroll}
      tabIndex={0}
      style={{ outline: "none" }}
    >
      {/* Virtual content sizer */}
      <div
        style={{
          width: `${totalWidth()}px`,
          height: `${totalHeight()}px`,
          position: "relative",
        }}
      >
        {/* Corner cell (top-left) */}
        <div
          class="sticky top-0 left-0 z-30 flex items-center justify-center border-b border-r border-neutral-600 bg-neutral-800"
          style={{
            width: `${HEADER_WIDTH}px`,
            height: `${HEADER_HEIGHT}px`,
            position: "sticky",
          }}
        />

        {/* Column headers */}
        <div
          class="sticky top-0 z-20"
          style={{
            position: "sticky",
            height: `${HEADER_HEIGHT}px`,
            "margin-left": `${HEADER_WIDTH}px`,
          }}
        >
          <For each={visibleColIndices()}>
            {(col) => (
              <div
                class={`absolute top-0 flex items-center justify-center border-b border-r border-neutral-600 text-xs font-medium select-none ${
                  selectedParsed().col === col
                    ? "bg-blue-900/50 text-blue-300"
                    : "bg-neutral-800 text-neutral-400"
                }`}
                style={{
                  left: `${colPositions()[col]}px`,
                  width: `${getColWidth(col)}px`,
                  height: `${HEADER_HEIGHT}px`,
                }}
              >
                {columnToLetter(col)}
                {/* Resize handle */}
                <div
                  class="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-blue-500"
                  onMouseDown={(e) => handleResizeMouseDown(col, e)}
                />
              </div>
            )}
          </For>
        </div>

        {/* Row headers */}
        <div
          class="sticky left-0 z-20"
          style={{
            position: "sticky",
            width: `${HEADER_WIDTH}px`,
            "margin-top": `${-HEADER_HEIGHT}px`,
          }}
        >
          <For each={visibleRowIndices()}>
            {(row) => (
              <div
                class={`absolute flex items-center justify-center border-b border-r border-neutral-600 text-xs select-none ${
                  selectedParsed().row === row
                    ? "bg-blue-900/50 text-blue-300"
                    : "bg-neutral-800 text-neutral-400"
                }`}
                style={{
                  top: `${rowPositions()[row] + HEADER_HEIGHT}px`,
                  width: `${HEADER_WIDTH}px`,
                  height: `${getRowHeight(row)}px`,
                }}
              >
                {row + 1}
              </div>
            )}
          </For>
        </div>

        {/* Cells */}
        <For each={visibleRowIndices()}>
          {(row) => (
            <For each={visibleColIndices()}>
              {(col) => {
                const isSelected = () =>
                  selectedParsed().col === col && selectedParsed().row === row;
                const inRange = () => isCellInRange(col, row);
                const fmt = () => getMergedFormat(col, row);

                return (
                  <div
                    class={`grid-cell absolute flex items-center overflow-hidden px-1 text-sm ${
                      isSelected() ? "cell-selected" : ""
                    } ${inRange() && !isSelected() ? "cell-in-range" : ""}`}
                    style={{
                      left: `${colPositions()[col] + HEADER_WIDTH}px`,
                      top: `${rowPositions()[row] + HEADER_HEIGHT}px`,
                      width: `${getColWidth(col)}px`,
                      height: `${getRowHeight(row)}px`,
                      ...(fmt()?.bgColor
                        ? { "background-color": fmt()!.bgColor }
                        : {}),
                      ...(fmt()?.textColor
                        ? { color: fmt()!.textColor }
                        : { color: "#e5e5e5" }),
                      ...(fmt()?.bold ? { "font-weight": "bold" } : {}),
                      ...(fmt()?.italic ? { "font-style": "italic" } : {}),
                      ...(fmt()?.underline
                        ? { "text-decoration": "underline" }
                        : {}),
                      ...(fmt()?.fontSize
                        ? { "font-size": `${fmt()!.fontSize}px` }
                        : {}),
                      ...(fmt()?.textAlign
                        ? {
                          "text-align": fmt()!.textAlign,
                          "justify-content": fmt()!.textAlign === "center"
                            ? "center"
                            : fmt()!.textAlign === "right"
                            ? "flex-end"
                            : "flex-start",
                        }
                        : {}),
                    }}
                    onClick={(e) => handleCellClick(col, row, e)}
                    onDblClick={() => handleCellDblClick(col, row)}
                  >
                    {getCellDisplay(col, row)}
                  </div>
                );
              }}
            </For>
          )}
        </For>

        {/* Cell editor overlay */}
        <Show when={props.isEditing}>
          <CellEditor
            value={props.editValue}
            left={editorPosition().left}
            top={editorPosition().top}
            width={editorPosition().width}
            height={editorPosition().height}
            onChange={props.onEditChange}
            onSubmit={props.onSubmitEdit}
            onCancel={props.onCancelEdit}
            onTab={props.onTabEdit}
          />
        </Show>
      </div>
    </div>
  );
};
