import type { Presentation } from "../types/index.ts";
import type { ImportedPresentation } from "./pptx-import.ts";
import { importPptxFile } from "./pptx-worker.ts";
import { capturePresentationCreator } from "./storage.ts";
import { currentWorkspaceId } from "../../../shared/lib/space-id.ts";
import { captureCreateReceipt } from "../../../shared/lib/create-receipt.ts";

type Decode = (file: File, signal: AbortSignal) => Promise<ImportedPresentation>;
export function createPresentationImporter(decode: Decode = importPptxFile) {
  let generation = 0, active: AbortController | undefined;
  const retire = () => {generation++;active?.abort();active=undefined;};
  return {retire,async importFile(file: File,onSaving?: () => void): Promise<{presentation: Presentation;hasUnsupportedContent: boolean} | null> {
    retire();
    const ownGeneration = generation, controller = new AbortController(), workspace = currentWorkspaceId();
    active = controller;
    const isActive = () => ownGeneration===generation && !controller.signal.aborted && currentWorkspaceId()===workspace;
    const create = capturePresentationCreator({isActive});
    const receipt = captureCreateReceipt("takos-slide-create-receipt");
    try {
      if (receipt.current() !== null) throw new Error("Previous presentation creation needs a fresh library read");
      const converted = await decode(file,controller.signal);
      if (!isActive()) return null;
      const now = new Date().toISOString();
      const title = (converted.title?.trim() || file.name.replace(/\.pptx$/i,"").trim() || "Presentation").slice(0,512);
      onSaving?.();
      if (!isActive()) return null;
      // Another ordinary create may have started while conversion was pending.
      // Never overwrite its unconfirmed receipt or automatically replay it.
      if (receipt.current() !== null) throw new Error("Previous presentation creation needs a fresh library read");
      const token = receipt.begin();
      const presentation = await create({id:crypto.randomUUID(),title,slides:converted.slides,slideSize:converted.slideSize,createdAt:now,updatedAt:now});
      receipt.acknowledge(token);
      return isActive() ? {presentation,hasUnsupportedContent:converted.hasUnsupportedContent} : null;
    } catch (error) {
      if (!isActive()) return null;
      throw error;
    } finally {if(active===controller)active=undefined;}
  }};
}
