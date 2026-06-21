/**
 * Display-time number/date formatting.
 *
 * `CellFormat.numberFormat` (e.g. "#,##0.00", "0%", "$#,##0.00", "yyyy-mm-dd")
 * is applied here when a cell is rendered. This is display-only: the stored raw
 * `value` and evaluated `computed` are never changed, so CSV/JSON export stays
 * faithful to the underlying data.
 */

// HyperFormula's default nullDate is 1899-12-30, so serial 0 maps to that day.
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/** Apply a cell's number format to its display string. */
export function applyNumberFormat(raw: string, fmt?: string): string {
  if (!fmt || raw === "") return raw;

  if (isDateFormat(fmt)) {
    const date = parseSpreadsheetDate(raw);
    return date ? formatDate(date, fmt) : raw;
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;

  const isPercent = fmt.includes("%");
  const scaled = isPercent ? n * 100 : n;

  const decimalsMatch = fmt.match(/\.(0+)/);
  const decimals = decimalsMatch ? decimalsMatch[1].length : 0;
  const useGrouping = fmt.includes(",");

  const negative = scaled < 0;
  let body = Math.abs(scaled).toFixed(decimals);
  if (useGrouping) {
    const [intPart, frac] = body.split(".");
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    body = frac ? `${grouped}.${frac}` : grouped;
  }

  const currency = fmt.match(/[$¥€£]/)?.[0] ?? "";
  const suffix = isPercent ? "%" : "";
  return `${negative ? "-" : ""}${currency}${body}${suffix}`;
}

function isDateFormat(fmt: string): boolean {
  const f = fmt.toLowerCase();
  return f.includes("y") && (f.includes("m") || f.includes("d"));
}

function parseSpreadsheetDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // Serial number (e.g. the result of TODAY()/DATE()).
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    if (!Number.isFinite(serial)) return null;
    return new Date(SERIAL_EPOCH_MS + Math.round(serial) * MS_PER_DAY);
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function formatDate(date: Date, fmt: string): string {
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  // Replace longest tokens first so "yyyy" isn't clobbered by "yy", etc.
  return fmt
    .replace(/yyyy/gi, yyyy)
    .replace(/yy/gi, yyyy.slice(-2))
    .replace(/mm/g, String(month).padStart(2, "0"))
    .replace(/m/g, String(month))
    .replace(/dd/gi, String(day).padStart(2, "0"))
    .replace(/d/gi, String(day));
}
