// CANONICAL COPY (owner): takos-apps/takos-docs/src/lib/takos-storage.ts
// This file is byte-identical across takos-docs / takos-slide / takos-excel.
// The copies are deliberately vendored rather than factored into a shared
// package because each takos-app ships as a standalone git repo / OpenTofu
// module installable from a Git URL; a cross-submodule alias library would
// break that standalone build.
//
// Edit ONLY this canonical copy, then propagate to the other apps with
// `bun run check:takos-apps-dedupe --fix` (ecosystem root). Verify mode
// (`bun run check:takos-apps-dedupe`) is wired into `bun run check:all` and
// fails if any copy drifts.

/**
 * Client for the Takos product storage API.
 *
 * Provides typed access to the spaces.storage endpoints:
 *   GET    /api/spaces/:spaceId/storage              — list files
 *   POST   /api/spaces/:spaceId/storage/files         — create file
 *   GET    /api/spaces/:spaceId/storage/:fileId       — get file metadata
 *   GET    /api/spaces/:spaceId/storage/:fileId/content — get file content
 *   PUT    /api/spaces/:spaceId/storage/:fileId/content — write file content
 *   PATCH  /api/spaces/:spaceId/storage/:fileId       — rename/move
 *   DELETE /api/spaces/:spaceId/storage/:fileId       — delete file
 *   POST   /api/spaces/:spaceId/storage/folders       — create folder
 */

export interface StorageFile {
  id: string;
  name: string;
  path?: string;
  parentId?: string;
  parent_id?: string | null;
  type: "file" | "folder";
  size?: number;
  mimeType?: string | null;
  mime_type?: string | null;
  createdAt: string;
  created_at?: string;
  updatedAt: string;
  updated_at?: string;
}

export interface TakosStorageClient {
  list(prefix?: string): Promise<StorageFile[]>;
  get(fileId: string): Promise<StorageFile | null>;
  getContent(fileId: string): Promise<string>;
  putContent(fileId: string, content: string, mimeType?: string): Promise<void>;
  create(
    name: string,
    parentId?: string,
    options?: { content?: string; mimeType?: string },
  ): Promise<StorageFile>;
  createFolder(name: string, parentId?: string): Promise<StorageFile>;
  rename(fileId: string, name: string): Promise<void>;
  delete(fileId: string): Promise<void>;
}

export function createTakosStorageClient(
  apiUrl: string,
  token: string,
  spaceId: string,
): TakosStorageClient {
  const baseUrl = `${apiUrl}/api/spaces/${spaceId}/storage`;
  const filePaths = new Map<string, string>();

  function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object"
      ? value as Record<string, unknown>
      : {};
  }

  function normalizeFile(raw: unknown): StorageFile {
    const data = asRecord(raw);
    const file: StorageFile = {
      id: String(data.id),
      name: String(data.name),
      path: typeof data.path === "string" ? data.path : undefined,
      parentId: typeof data.parentId === "string"
        ? data.parentId
        : typeof data.parent_id === "string"
        ? data.parent_id
        : undefined,
      parent_id: typeof data.parent_id === "string" ? data.parent_id : null,
      type: data.type === "folder" ? "folder" : "file",
      size: typeof data.size === "number" ? data.size : undefined,
      mimeType: typeof data.mimeType === "string"
        ? data.mimeType
        : typeof data.mime_type === "string"
        ? data.mime_type
        : null,
      mime_type: typeof data.mime_type === "string"
        ? data.mime_type
        : typeof data.mimeType === "string"
        ? data.mimeType
        : null,
      createdAt: typeof data.createdAt === "string"
        ? data.createdAt
        : typeof data.created_at === "string"
        ? data.created_at
        : "",
      created_at: typeof data.created_at === "string"
        ? data.created_at
        : undefined,
      updatedAt: typeof data.updatedAt === "string"
        ? data.updatedAt
        : typeof data.updated_at === "string"
        ? data.updated_at
        : "",
      updated_at: typeof data.updated_at === "string"
        ? data.updated_at
        : undefined,
    };
    if (file.path) filePaths.set(file.id, file.path);
    return file;
  }

  function fileFromResponse(data: unknown): StorageFile {
    const record = asRecord(data);
    return normalizeFile(record.file ?? record.folder ?? data);
  }

  function pathFor(name: string, parentId?: string): string {
    const parentPath = parentId ? filePaths.get(parentId) : undefined;
    if (!parentPath || parentPath === "/") return name;
    return `${parentPath.replace(/\/$/, "")}/${name}`;
  }

  async function fetchApi(
    path: string,
    options?: RequestInit,
  ): Promise<Response> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Takos API error: ${res.status} ${res.statusText} — ${body}`,
      );
    }
    return res;
  }

  async function list(prefix?: string): Promise<StorageFile[]> {
    const query = prefix ? `?path=${encodeURIComponent(prefix)}` : "";
    const res = await fetchApi(query);
    const data: unknown = await res.json();
    const envelope = asRecord(data);
    const raw = Array.isArray(envelope.files)
      ? envelope.files
      : Array.isArray(data)
      ? data
      : [];
    return raw.map(normalizeFile);
  }

  async function get(fileId: string): Promise<StorageFile | null> {
    try {
      const res = await fetchApi(`/${fileId}`);
      return fileFromResponse(await res.json());
    } catch {
      return null;
    }
  }

  async function getContent(fileId: string): Promise<string> {
    const res = await fetchApi(`/${fileId}/content`);
    const contentType = res.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await res.json();
      if (typeof data.content === "string") return data.content;
      return JSON.stringify(data);
    }
    return res.text();
  }

  async function putContent(
    fileId: string,
    content: string,
    mimeType?: string,
  ): Promise<void> {
    await fetchApi(`/${fileId}/content`, {
      method: "PUT",
      body: JSON.stringify({ content, mime_type: mimeType }),
    });
  }

  async function create(
    name: string,
    parentId?: string,
    options?: { content?: string; mimeType?: string },
  ): Promise<StorageFile> {
    const res = await fetchApi("/files", {
      method: "POST",
      body: JSON.stringify({
        name,
        parentId,
        path: pathFor(name, parentId),
        content: options?.content ?? "",
        mime_type: options?.mimeType,
      }),
    });
    return fileFromResponse(await res.json());
  }

  async function createFolder(
    name: string,
    parentId?: string,
  ): Promise<StorageFile> {
    const res = await fetchApi("/folders", {
      method: "POST",
      body: JSON.stringify({
        name,
        parentId,
        parent_path: parentId ? filePaths.get(parentId) : undefined,
      }),
    });
    return fileFromResponse(await res.json());
  }

  async function rename(fileId: string, name: string): Promise<void> {
    await fetchApi(`/${fileId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  }

  async function del(fileId: string): Promise<void> {
    await fetchApi(`/${fileId}`, { method: "DELETE" });
  }

  return {
    list,
    get,
    getContent,
    putContent,
    create,
    createFolder,
    rename,
    delete: del,
  };
}
