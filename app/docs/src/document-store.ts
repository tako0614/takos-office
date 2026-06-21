/**
 * DocumentStore backed by the Takos product storage API.
 *
 * Each document is stored under a `/takos-docs/` folder:
 *   - File name: `{id}.takosdoc`
 *   - Content: `{ title, content, createdAt, updatedAt }`
 *
 * Reads (list / get / search) always go to the backing storage API,
 * which is the single source of truth. The in-process Map only memoizes
 * the doc.id -> fileId mapping discovered while reading; it is never used
 * as an authoritative read cache, so writes by other replicas/isolates or
 * external Takos-side changes are reflected on the next read instead of
 * being masked until the process restarts.
 */

import type { Document } from "./types/index.ts";
import type { TakosStorageClient } from "../../shared/lib/takos-storage.ts";

const FOLDER_NAME = "takos-docs";
const FILE_EXTENSION = ".takosdoc";
const MIME_TYPE = "application/vnd.takos.docs+json";

export interface DocumentStore {
  list(): Promise<Document[]>;
  get(id: string): Promise<Document | null>;
  create(title: string, content?: string): Promise<Document>;
  upsert(doc: Document): Promise<Document>;
  update(
    id: string,
    data: Partial<Pick<Document, "title" | "content">>,
  ): Promise<Document | null>;
  delete(id: string): Promise<boolean>;
  search(query: string): Promise<Document[]>;
}

export class TakosDocumentStore implements DocumentStore {
  private client: TakosStorageClient;
  /**
   * doc.id -> fileId memo. Populated while reading and updated on writes so
   * we can address files by their backing fileId without an extra round trip.
   * It is NOT an authoritative read cache: list()/get()/search() always
   * re-read content from storage.
   */
  private fileIds = new Map<string, string>();
  private folderId: string | null = null;

  constructor(client: TakosStorageClient) {
    this.client = client;
  }

  private isSupportedFile(file: { name: string; mimeType?: string | null }) {
    return file.name.endsWith(FILE_EXTENSION);
  }

  /** Resolve a fileId from a doc.id (or accept a fileId directly). */
  private fileIdFor(idOrFileId: string): string | undefined {
    if (this.fileIds.has(idOrFileId)) return this.fileIds.get(idOrFileId);
    for (const fileId of this.fileIds.values()) {
      if (fileId === idOrFileId) return fileId;
    }
    return undefined;
  }

  private async loadFile(fileId: string): Promise<
    { doc: Document; fileId: string } | null
  > {
    const file = await this.client.get(fileId);
    if (!file || file.type !== "file" || !this.isSupportedFile(file)) {
      return null;
    }
    const raw = await this.client.getContent(file.id);
    const doc = JSON.parse(raw) as Document;
    this.fileIds.set(doc.id, file.id);
    return { doc, fileId: file.id };
  }

  // -------------------------------------------------------------------------
  // Initialization — ensure the app folder exists (structure only)
  // -------------------------------------------------------------------------

  /**
   * Ensure the app folder exists and cache its id. Folder structure is stable,
   * so this is the only thing memoized for the process lifetime; document
   * content is always re-read from storage by the read methods below.
   */
  private async ensureFolder(): Promise<void> {
    if (this.folderId) return;
    const files = await this.client.list();
    const folder = files.find((f) =>
      f.type === "folder" && f.name === FOLDER_NAME
    );
    if (folder) {
      this.folderId = folder.id;
    } else {
      const created = await this.client.createFolder(FOLDER_NAME);
      this.folderId = created.id;
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Re-read every supported document file in the folder from storage. */
  private async loadAll(): Promise<Document[]> {
    await this.ensureFolder();
    const allFiles = await this.client.list(FOLDER_NAME);
    const docs: Document[] = [];
    for (const file of allFiles) {
      if (file.type !== "file" || !this.isSupportedFile(file)) continue;
      try {
        const loaded = await this.loadFile(file.id);
        if (loaded) docs.push(loaded.doc);
      } catch {
        // Skip files that cannot be parsed
        console.warn(`[takos-docs] Skipping unreadable file: ${file.name}`);
      }
    }
    return docs;
  }

  async list(): Promise<Document[]> {
    const docs = await this.loadAll();
    return docs.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async get(id: string): Promise<Document | null> {
    await this.ensureFolder();
    // Prefer the memoized fileId, but always re-read content from storage.
    let knownFileId = this.fileIdFor(id);
    if (!knownFileId) {
      await this.loadAll(); // refresh fileId memo from storage
      knownFileId = this.fileIdFor(id);
    }
    if (knownFileId) {
      const loaded = await this.loadFile(knownFileId);
      if (loaded) return loaded.doc;
      // File disappeared (deleted elsewhere): drop the stale mapping.
      this.fileIds.delete(id);
    }
    // Fall back to treating the argument as a fileId.
    return (await this.loadFile(id))?.doc ?? null;
  }

  async create(title: string, content?: string): Promise<Document> {
    await this.ensureFolder();

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const doc: Document = {
      id,
      title,
      content: content ?? "",
      createdAt: now,
      updatedAt: now,
    };

    // Persist to takos storage
    const file = await this.client.create(
      `${id}${FILE_EXTENSION}`,
      this.folderId ?? undefined,
      { content: JSON.stringify(doc), mimeType: MIME_TYPE },
    );
    this.fileIds.set(id, file.id);
    return doc;
  }

  async upsert(doc: Document): Promise<Document> {
    await this.ensureFolder();

    // Resolve the current fileId from storage (source of truth) rather than
    // a process-lifetime cache, so writes are not lost across isolates.
    let fileId = this.fileIdFor(doc.id);
    if (!fileId) {
      await this.list(); // refresh fileId memo from storage
      fileId = this.fileIdFor(doc.id);
    }

    if (fileId) {
      await this.client.putContent(fileId, JSON.stringify(doc), MIME_TYPE);
      this.fileIds.set(doc.id, fileId);
      return doc;
    }

    const file = await this.client.create(
      `${doc.id}${FILE_EXTENSION}`,
      this.folderId ?? undefined,
      { content: JSON.stringify(doc), mimeType: MIME_TYPE },
    );
    this.fileIds.set(doc.id, file.id);
    return doc;
  }

  async update(
    id: string,
    data: Partial<Pick<Document, "title" | "content">>,
  ): Promise<Document | null> {
    await this.ensureFolder();

    // Read the current document from storage so concurrent writes by other
    // replicas are not clobbered by a stale in-process copy.
    const current = await this.get(id);
    if (!current) return null;
    const fileId = this.fileIdFor(current.id);
    if (!fileId) return null;

    const updated: Document = {
      ...current,
      ...data,
      updatedAt: new Date().toISOString(),
    };

    await this.client.putContent(fileId, JSON.stringify(updated), MIME_TYPE);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureFolder();

    // Resolve from storage so a fresh isolate can delete docs it never read.
    let fileId = this.fileIdFor(id);
    if (!fileId) {
      const current = await this.get(id);
      if (!current) return false;
      fileId = this.fileIdFor(current.id);
    }
    if (!fileId) return false;

    await this.client.delete(fileId);
    this.fileIds.delete(id);
    return true;
  }

  async search(query: string): Promise<Document[]> {
    const docs = await this.list();
    const lower = query.toLowerCase();
    return docs.filter(
      (doc) =>
        doc.title.toLowerCase().includes(lower) ||
        doc.content.toLowerCase().includes(lower),
    );
  }
}
