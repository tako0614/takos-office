import type { Document } from "../types/index.ts";

const STORAGE_KEY = "takos-docs-documents";
// Subpath base under the unified Takos Office worker (vite injects "/docs/" at
// build; falls back to "" under bun test where import.meta.env.BASE_URL is unset).
const RAW_BASE = import.meta.env.BASE_URL;
const BASE_PATH = (typeof RAW_BASE === "string" ? RAW_BASE : "/").replace(
  /\/+$/,
  "",
);
const API_DOCUMENTS_PATH = `${BASE_PATH}/api/documents`;

function redirectToLogin(): void {
  const location = globalThis.location;
  if (!location) return;
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  location.href = `${BASE_PATH}/api/auth/login?return_to=${encodeURIComponent(returnTo)}`;
}

function withCurrentSpaceId(path: string): string {
  const query = globalThis.location
    ? new URLSearchParams(globalThis.location.search)
    : null;
  const spaceId = query?.get("space_id") ?? query?.get("spaceId");
  if (!spaceId) return path;
  const url = new URL(path, globalThis.location.origin);
  url.searchParams.set("space_id", spaceId);
  return `${url.pathname}${url.search}`;
}

export function clearDocumentsCache(): void {
  localStorage.removeItem(STORAGE_KEY);
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(withCurrentSpaceId(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    credentials: "same-origin",
  });
  if (response.status === 401) {
    clearDocumentsCache();
    redirectToLogin();
  }
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return await response.json() as T;
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
        ...(baseUpdatedAt ? { "If-Match": baseUpdatedAt } : {}),
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
    const body = await response.json() as { current: Document };
    // Adopt the server's current version locally so the next save is based
    // on it, then surface the conflict to the caller to reload.
    const docs = loadDocuments();
    const index = docs.findIndex((entry) => entry.id === body.current.id);
    if (index >= 0) docs[index] = body.current;
    else docs.push(body.current);
    saveDocuments(docs);
    throw new DocumentConflictError(body.current);
  }
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return await response.json() as Document;
}

async function deleteDocumentFromApi(id: string): Promise<void> {
  const response = await fetch(
    withCurrentSpaceId(`${API_DOCUMENTS_PATH}/${encodeURIComponent(id)}`),
    {
      method: "DELETE",
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
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Document[];
  } catch {
    return [];
  }
}

export function saveDocuments(documents: Document[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(documents));
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
  saveDocuments(docs.filter((d) => d.id !== id));
  return deleteDocumentFromApi(id);
}
