export interface CellData {
  value: string; // raw input (may be formula like "=SUM(A1:A10)")
  computed?: string; // computed display value
  format?: CellFormat;
}

export interface CellFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  textColor?: string;
  bgColor?: string;
  fontSize?: number;
  textAlign?: "left" | "center" | "right";
  numberFormat?: string; // e.g., '#,##0.00', '0%', 'yyyy-mm-dd'
}

export type CellAddress = string; // e.g., "A1", "B3"

export interface ConditionalRule {
  id: string;
  range: string; // e.g., "A1:C10"
  condition: {
    type:
      | "greaterThan"
      | "lessThan"
      | "equal"
      | "notEqual"
      | "between"
      | "textContains"
      | "isEmpty"
      | "isNotEmpty";
    values: string[]; // comparison values
  };
  format: CellFormat; // format to apply when condition is true
}

export interface Sheet {
  id: string;
  name: string;
  cells: Record<CellAddress, CellData>;
  colWidths: Record<number, number>; // column index -> width
  rowHeights: Record<number, number>; // row index -> height
  conditionalRules?: ConditionalRule[];
}

export interface Spreadsheet {
  id: string;
  title: string;
  sheets: Sheet[];
  activeSheetId: string;
  createdAt: string;
  updatedAt: string;
}
