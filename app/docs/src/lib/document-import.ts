import { currentWorkspaceId } from "../../../shared/lib/space-id.ts";
import { captureDocumentCreator } from "./storage.ts";
import { importDocxFile } from "./docx-worker.ts";
import type { ImportedOfficeDocument } from "./docx-model.ts";
import type { Document } from "../types/index.ts";

type DecodeDocument = (file: File, signal: AbortSignal) => Promise<ImportedOfficeDocument>;

/** An import belongs to the route and Workspace where the file was selected. */
export function createDocumentImporter(decode: DecodeDocument = importDocxFile) {
  let generation = 0;
  let active: AbortController | undefined;
  const retire = () => {
    generation++;
    active?.abort();
    active = undefined;
  };
  return {
    retire,
    async importFile(file: File, onSaving?: () => void): Promise<{document: Document; hasUnsupportedContent: boolean} | null> {
      retire();
      const ownGeneration = generation;
      const controller = new AbortController();
      active = controller;
      const workspace = currentWorkspaceId();
      const isActive = () => generation === ownGeneration && !controller.signal.aborted && currentWorkspaceId() === workspace;
      // Capture before even reading the file. Conversion never chooses a new destination.
      const create = captureDocumentCreator({isActive});
      try {
        const converted = await decode(file, controller.signal);
        if (!isActive()) return null;
        onSaving?.();
        if (!isActive()) return null;
        const now = new Date().toISOString();
        const fallback = file.name.replace(/\.docx$/i, "").trim() || "Document";
        const title = (converted.title?.trim() || fallback).slice(0, 512);
        const document = await create({id: crypto.randomUUID(), title, content: converted.content, createdAt: now, updatedAt: now});
        // An already dispatched write is allowed to settle in its captured cache;
        // navigation must not adopt that response or error in another view.
        return isActive() ? {document, hasUnsupportedContent: converted.hasUnsupportedContent} : null;
      } catch (error) {
        if (!isActive()) return null;
        throw error;
      } finally {
        if (active === controller) active = undefined;
      }
    },
  };
}
