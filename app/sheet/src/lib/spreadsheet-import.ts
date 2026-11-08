import { importXlsxFile } from "./xlsx-worker.ts";
import type { ImportedSpreadsheet } from "./xlsx.ts";
import { captureSpreadsheetCreator } from "./storage.ts";
import { currentWorkspaceId } from "../../../shared/lib/space-id.ts";
import { captureCreateReceipt } from "../../../shared/lib/create-receipt.ts";

type Decode = (file: File, signal: AbortSignal) => Promise<ImportedSpreadsheet>;
export function createSpreadsheetImporter(decode: Decode = importXlsxFile) {
  let generation = 0, active: AbortController | undefined;
  const retire = () => { generation++; active?.abort(); active = undefined; };
  return { retire, async importFile(file: File, onSaving?: () => void): Promise<ImportedSpreadsheet | null> {
    retire();
    const ownGeneration = generation, controller = new AbortController(), workspace = currentWorkspaceId();
    active = controller;
    const isActive = () => ownGeneration === generation && !controller.signal.aborted && currentWorkspaceId() === workspace;
    const create = captureSpreadsheetCreator({ isActive });
    const receipt = captureCreateReceipt("takos-sheet-create-receipt");
    try {
      if (receipt.current() !== null) throw new Error("Previous spreadsheet creation needs a fresh library read");
      const converted = await decode(file, controller.signal);
      if (!isActive()) return null;
      const now = new Date().toISOString();
      const title = (converted.spreadsheet.title.trim() || file.name.replace(/\.xlsx$/i, "").trim() || "Spreadsheet").slice(0, 512);
      onSaving?.();
      if (!isActive()) return null;
      if (receipt.current() !== null) throw new Error("Previous spreadsheet creation needs a fresh library read");
      const token = receipt.begin();
      const spreadsheet = await create({ ...converted.spreadsheet, id: crypto.randomUUID(), title, createdAt: now, updatedAt: now });
      receipt.acknowledge(token);
      return isActive() ? { spreadsheet, hasUnsupportedContent: converted.hasUnsupportedContent } : null;
    } catch (error) {
      if (!isActive()) return null;
      throw error;
    } finally { if (active === controller) active = undefined; }
  } };
}
