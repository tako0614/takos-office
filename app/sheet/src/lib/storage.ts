import type { Sheet, Spreadsheet } from "../types/index.ts";
import { createApiClient } from "../../../shared/lib/api-client.ts";

const STORAGE_KEY = "takos-excel-spreadsheets";

const api = createApiClient("/api/spreadsheets", STORAGE_KEY);
const API_SPREADSHEETS_PATH = api.apiPath;
const { requestJson, withCurrentSpaceId, redirectToLogin } = api;

export interface LocalSaveResult<T> {
  value: T;
  remote: Promise<unknown>;
}

export function clearSpreadsheetsCache(): void {
  api.clearCache();
}

function syncSpreadsheetToApi(spreadsheet: Spreadsheet): Promise<Spreadsheet> {
  return requestJson<Spreadsheet>(
    `${API_SPREADSHEETS_PATH}/${encodeURIComponent(spreadsheet.id)}`,
    {
      method: "PUT",
      body: JSON.stringify(spreadsheet),
    },
  );
}

async function deleteSpreadsheetFromApi(id: string): Promise<void> {
  const response = await fetch(
    withCurrentSpaceId(`${API_SPREADSHEETS_PATH}/${encodeURIComponent(id)}`),
    {
      method: "DELETE",
      credentials: "same-origin",
    },
  );
  if (response.status === 401) {
    clearSpreadsheetsCache();
    redirectToLogin();
  }
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
}

export async function loadSpreadsheetsFromApi(): Promise<Spreadsheet[]> {
  const spreadsheets = await requestJson<Spreadsheet[]>(API_SPREADSHEETS_PATH);
  saveSpreadsheets(spreadsheets);
  return spreadsheets;
}

export async function loadSpreadsheetFromApi(id: string): Promise<Spreadsheet> {
  const spreadsheet = await requestJson<Spreadsheet>(
    `${API_SPREADSHEETS_PATH}/${encodeURIComponent(id)}`,
  );
  const spreadsheets = loadSpreadsheets();
  const index = spreadsheets.findIndex((entry) => entry.id === spreadsheet.id);
  if (index >= 0) spreadsheets[index] = spreadsheet;
  else spreadsheets.push(spreadsheet);
  saveSpreadsheets(spreadsheets);
  return spreadsheet;
}

/**
 * Load all spreadsheets from localStorage
 */
export function loadSpreadsheets(): Spreadsheet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Spreadsheet[];
  } catch {
    return [];
  }
}

/**
 * Save all spreadsheets to localStorage
 */
export function saveSpreadsheets(spreadsheets: Spreadsheet[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(spreadsheets));
}

/**
 * Get a single spreadsheet by ID
 */
export function getSpreadsheet(id: string): Spreadsheet | undefined {
  const all = loadSpreadsheets();
  return all.find((s) => s.id === id);
}

/**
 * Create a new spreadsheet
 */
export function createSpreadsheet(
  title: string,
  defaultSheetName = "Sheet1",
): LocalSaveResult<Spreadsheet> {
  const now = new Date().toISOString();
  const sheetId = crypto.randomUUID();
  const defaultSheet: Sheet = {
    id: sheetId,
    name: defaultSheetName,
    cells: {},
    colWidths: {},
    rowHeights: {},
  };

  const spreadsheet: Spreadsheet = {
    id: crypto.randomUUID(),
    title,
    sheets: [defaultSheet],
    activeSheetId: sheetId,
    createdAt: now,
    updatedAt: now,
  };

  const all = loadSpreadsheets();
  all.push(spreadsheet);
  saveSpreadsheets(all);
  return { value: spreadsheet, remote: syncSpreadsheetToApi(spreadsheet) };
}

/**
 * Update an existing spreadsheet
 */
export function updateSpreadsheet(
  spreadsheet: Spreadsheet,
): Promise<Spreadsheet | undefined> {
  const all = loadSpreadsheets();
  const index = all.findIndex((s) => s.id === spreadsheet.id);
  if (index !== -1) {
    all[index] = { ...spreadsheet, updatedAt: new Date().toISOString() };
    saveSpreadsheets(all);
    return syncSpreadsheetToApi(all[index]);
  }
  return Promise.resolve(undefined);
}

/**
 * Delete a spreadsheet by ID
 */
export function deleteSpreadsheet(id: string): Promise<void> {
  const all = loadSpreadsheets();
  saveSpreadsheets(all.filter((s) => s.id !== id));
  return deleteSpreadsheetFromApi(id);
}

/**
 * Add a sheet to a spreadsheet
 */
export function addSheet(
  spreadsheetId: string,
  sheetName?: string,
): LocalSaveResult<Sheet | undefined> {
  const all = loadSpreadsheets();
  const ss = all.find((s) => s.id === spreadsheetId);
  if (!ss) return { value: undefined, remote: Promise.resolve() };

  const sheetNum = ss.sheets.length + 1;
  const newSheet: Sheet = {
    id: crypto.randomUUID(),
    name: sheetName ?? `Sheet${sheetNum}`,
    cells: {},
    colWidths: {},
    rowHeights: {},
  };

  ss.sheets.push(newSheet);
  ss.activeSheetId = newSheet.id;
  ss.updatedAt = new Date().toISOString();
  saveSpreadsheets(all);
  return { value: newSheet, remote: syncSpreadsheetToApi(ss) };
}

/**
 * Delete a sheet from a spreadsheet
 */
export function deleteSheet(
  spreadsheetId: string,
  sheetId: string,
): LocalSaveResult<boolean> {
  const all = loadSpreadsheets();
  const ss = all.find((s) => s.id === spreadsheetId);
  if (!ss || ss.sheets.length <= 1) {
    return { value: false, remote: Promise.resolve() };
  }

  ss.sheets = ss.sheets.filter((s) => s.id !== sheetId);
  if (ss.activeSheetId === sheetId) {
    ss.activeSheetId = ss.sheets[0].id;
  }
  ss.updatedAt = new Date().toISOString();
  saveSpreadsheets(all);
  return { value: true, remote: syncSpreadsheetToApi(ss) };
}

/**
 * Rename a sheet
 */
export function renameSheet(
  spreadsheetId: string,
  sheetId: string,
  newName: string,
): LocalSaveResult<boolean> {
  const all = loadSpreadsheets();
  const ss = all.find((s) => s.id === spreadsheetId);
  if (!ss) return { value: false, remote: Promise.resolve() };

  const sheet = ss.sheets.find((s) => s.id === sheetId);
  if (!sheet) return { value: false, remote: Promise.resolve() };

  sheet.name = newName;
  ss.updatedAt = new Date().toISOString();
  saveSpreadsheets(all);
  return { value: true, remote: syncSpreadsheetToApi(ss) };
}
