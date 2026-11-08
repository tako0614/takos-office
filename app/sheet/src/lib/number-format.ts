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
  const code = fmt.replace(/\\.|"(?:[^"]|"")*"|\[[^\]]*\]/g, "");
  return /[ymdhs]/i.test(code);
}

function parseSpreadsheetDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // Serial number (e.g. the result of TODAY()/DATE()).
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    if (!Number.isFinite(serial)) return null;
    const date = new Date(SERIAL_EPOCH_MS + serial * MS_PER_DAY);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function formatDate(date: Date, fmt: string): string {
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const tokens = fmt.match(/\\.|"(?:[^"]|"")*"|\[[^\]]*\]|AM\/PM|y{2,4}|m{1,5}|d{1,4}|h{1,2}|s{1,2}|./gi) ?? [];
  const isCode = (value: string) => /^(?:y{2,4}|m{1,5}|d{1,4}|h{1,2}|s{1,2}|AM\/PM)$/i.test(value);
  const hour = date.getUTCHours(), twelveHour = tokens.some(token => token.toLowerCase() === "am/pm");
  const pad = (value: number, length: number) => String(value).padStart(length, "0");
  const named = (kind: "month" | "weekday", length: "short" | "long") => new Intl.DateTimeFormat("en-US", { [kind]: length, timeZone: "UTC" }).format(date);
  return tokens.map((token, index) => {
    if (token.startsWith("\\")) return token.slice(1);
    if (token.startsWith('"')) return token.slice(1, -1).replaceAll('""', '"');
    if (token.startsWith("[")) return "";
    const code = token.toLowerCase();
    if (code === "yyyy") return yyyy;
    if (code === "yy") return yyyy.slice(-2);
    if (code === "mmmm") return named("month", "long");
    if (code === "mmm") return named("month", "short");
    if (code === "mmmmm") return named("month", "long").slice(0, 1);
    if (code === "dddd") return named("weekday", "long");
    if (code === "ddd") return named("weekday", "short");
    if (code === "d" || code === "dd") return pad(day, code.length);
    if (code === "m" || code === "mm") {
      const previous = tokens.slice(0, index).reverse().find(isCode)?.toLowerCase();
      const next = tokens.slice(index + 1).find(isCode)?.toLowerCase();
      const minute = previous === "h" || previous === "hh" || next === "s" || next === "ss";
      return pad(minute ? date.getUTCMinutes() : month, code.length);
    }
    if (code === "h" || code === "hh") return pad(twelveHour ? hour % 12 || 12 : hour, code.length);
    if (code === "s" || code === "ss") return pad(date.getUTCSeconds(), code.length);
    if (code === "am/pm") return hour < 12 ? "AM" : "PM";
    return token;
  }).join("");
}
