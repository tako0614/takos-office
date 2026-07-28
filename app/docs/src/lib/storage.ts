import type { Document } from "../types/index.ts";
import { createApiClient } from "../../../shared/lib/api-client.ts";

const STORAGE_KEY = "takos-docs-documents";

const api = createApiClient("/api/documents", STORAGE_KEY);
const API_DOCUMENTS_PATH = api.apiPath;
const { requestJson, withCurrentSpaceId, redirectToLogin } = api;

export function clearDocumentsCache(): void {
  api.clearCache();
}

/** Thrown by a save that lost an optimistic-concurrency check (HTTP 409). */
export class DocumentConflictError extends Error {
  constructor(public readonly current: Document) {
    super("Document was modified elsewhere");
    this.name = "DocumentConflictError";
  }
}

async function syncDocumentToApi(
  doc: Document,
  baseUpdatedAt?: string,
): Promise<Document> {
  const response = await fetch(
    withCurrentSpaceId(`${API_DOCUMENTS_PATH}/${encodeURIComponent(doc.id)}`),
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        // Send the loaded version so the server can reject a stale overwrite.
        ...(baseUpdatedAt
          ? { "If-Match": baseUpdatedAt }
          : { "If-None-Match": "*" }),
      },
      body: JSON.stringify(doc),
      credentials: "same-origin",
    },
  );
  if (response.status === 401) {
    clearDocumentsCache();
    redirectToLogin();
  }
  if (response.status === 409) {
    const body = (await response.json()) as { current: Document };
    // Keep the local cache as the recovery copy. DocumentWriter rebases its
    // precondition but retains the rejected draft until it is saved.
    throw new DocumentConflictError(body.current);
  }
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as Document;
}

async function deleteDocumentFromApi(
  id: string,
  expectedUpdatedAt: string,
): Promise<void> {
  const response = await fetch(
    withCurrentSpaceId(`${API_DOCUMENTS_PATH}/${encodeURIComponent(id)}`),
    {
      method: "DELETE",
      headers: { "If-Match": expectedUpdatedAt },
      credentials: "same-origin",
    },
  );
  if (response.status === 401) {
    clearDocumentsCache();
    redirectToLogin();
  }
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
}

export async function loadDocumentsFromApi(): Promise<Document[]> {
  const documents = await requestJson<Document[]>(API_DOCUMENTS_PATH);
  saveDocuments(documents);
  return documents;
}

export async function loadDocumentFromApi(id: string): Promise<Document> {
  const document = await requestJson<Document>(
    `${API_DOCUMENTS_PATH}/${encodeURIComponent(id)}`,
  );
  const docs = loadDocuments();
  const index = docs.findIndex((entry) => entry.id === document.id);
  if (index >= 0) docs[index] = document;
  else docs.push(document);
  saveDocuments(docs);
  return document;
}

export function loadDocuments(): Document[] {
  try {
    const raw = localStorage.getItem(api.cacheKey());
    if (!raw) return [];
    return JSON.parse(raw) as Document[];
  } catch {
    return [];
  }
}

export function saveDocuments(documents: Document[]): void {
  localStorage.setItem(api.cacheKey(), JSON.stringify(documents));
}

export function getDocument(id: string): Document | undefined {
  const docs = loadDocuments();
  return docs.find((d) => d.id === id);
}

export function addDocument(doc: Document): Promise<Document> {
  const docs = loadDocuments();
  docs.push(doc);
  saveDocuments(docs);
  return syncDocumentToApi(doc);
}

export async function updateDocumentInStorage(
  id: string,
  updates: Partial<Pick<Document, "title" | "content">>,
): Promise<Document | null> {
  const docs = loadDocuments();
  const index = docs.findIndex((d) => d.id === id);
  if (index === -1) return null;
  // The version we loaded — used as the optimistic-concurrency precondition.
  const baseUpdatedAt = docs[index].updatedAt;
  docs[index] = {
    ...docs[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  saveDocuments(docs);
  return await syncDocumentToApi(docs[index], baseUpdatedAt);
}

export function removeDocument(id: string): Promise<void> {
  const docs = loadDocuments();
  const current = docs.find((d) => d.id === id);
  saveDocuments(docs.filter((d) => d.id !== id));
  return current
    ? deleteDocumentFromApi(id, current.updatedAt)
    : Promise.resolve();
}
