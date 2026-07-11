// Shared object-storage client for the unified Takos Office Worker.

/**
 * Office stores typed records on the provider-neutral `storage.object` HTTP
 * surface. The service exposes raw objects (`/o`); this adapter owns Office's
 * file/folder model without requiring a Takos product API.
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

type OfficeObjectRecord = {
  schema: "takos.office.object-record.v1";
  file: StorageFile;
  content?: string;
};

type ObjectListing = {
  objects?: Array<{ key?: unknown }>;
  truncated?: boolean;
};

const RECORD_SCHEMA = "takos.office.object-record.v1" as const;
const RECORDS_PATH = "office/v1/records";

export function createTakosStorageClient(
  apiUrl: string,
  token: string,
  spaceId: string,
  keyPrefix = "",
): TakosStorageClient {
  const objectApiUrl = normalizeObjectApiUrl(apiUrl);
  const recordsPrefix = [
    normalizeKeyPrefix(keyPrefix),
    RECORDS_PATH,
    encodeKeyPart(spaceId),
    "",
  ].join("/").replace(/^\/+/, "");

  function recordKey(fileId: string): string {
    return `${recordsPrefix}${encodeKeyPart(fileId)}.json`;
  }

  async function objectRequest(
    path: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(`${objectApiUrl}${path}`, {
      ...options,
      headers,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ObjectStorageError(response.status, body);
    }
    return response;
  }

  async function readRecord(fileId: string): Promise<OfficeObjectRecord | null> {
    try {
      const response = await objectRequest(
        `/${encodeURIComponent(recordKey(fileId))}`,
      );
      return parseRecord(await response.json());
    } catch (error) {
      if (error instanceof ObjectStorageError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async function writeRecord(record: OfficeObjectRecord): Promise<void> {
    await objectRequest(`/${encodeURIComponent(recordKey(record.file.id))}`, {
      method: "PUT",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(record),
    });
  }

  async function deleteRecord(fileId: string): Promise<void> {
    try {
      await objectRequest(`/${encodeURIComponent(recordKey(fileId))}`, {
        method: "DELETE",
      });
    } catch (error) {
      if (!(error instanceof ObjectStorageError) || error.status !== 404) {
        throw error;
      }
    }
  }

  async function allRecords(): Promise<OfficeObjectRecord[]> {
    const response = await objectRequest(
      `?prefix=${encodeURIComponent(recordsPrefix)}`,
    );
    const listing = (await response.json()) as ObjectListing;
    if (listing.truncated === true) {
      throw new Error(
        "Object storage listing was truncated; pagination is required before Office can continue.",
      );
    }
    const keys = (listing.objects ?? []).flatMap((entry) =>
      typeof entry.key === "string" && entry.key.startsWith(recordsPrefix)
        ? [entry.key]
        : []
    );
    return (
      await Promise.all(
        keys.map(async (key) => {
          const response = await objectRequest(`/${encodeURIComponent(key)}`);
          return parseRecord(await response.json());
        }),
      )
    ).filter((record): record is OfficeObjectRecord => record !== null);
  }

  async function list(prefix?: string): Promise<StorageFile[]> {
    const records = await allRecords();
    if (!prefix) {
      return records
        .filter((record) => !record.file.parentId)
        .map((record) => record.file);
    }
    const folder = records.find(
      (record) =>
        record.file.type === "folder" &&
        (record.file.path === prefix || record.file.name === prefix),
    );
    if (!folder) return [];
    return records
      .filter((record) => record.file.parentId === folder.file.id)
      .map((record) => record.file);
  }

  async function get(fileId: string): Promise<StorageFile | null> {
    return (await readRecord(fileId))?.file ?? null;
  }

  async function getContent(fileId: string): Promise<string> {
    const record = await readRecord(fileId);
    if (!record) throw new ObjectStorageError(404, "record not found");
    if (record.file.type !== "file") {
      throw new Error(`Office record ${fileId} is a folder, not a file.`);
    }
    return record.content ?? "";
  }

  async function putContent(
    fileId: string,
    content: string,
    mimeType?: string,
  ): Promise<void> {
    const record = await readRecord(fileId);
    if (!record) throw new ObjectStorageError(404, "record not found");
    if (record.file.type !== "file") {
      throw new Error(`Office record ${fileId} is a folder, not a file.`);
    }
    const now = new Date().toISOString();
    await writeRecord({
      ...record,
      content,
      file: normalizeFile({
        ...record.file,
        size: new TextEncoder().encode(content).byteLength,
        mimeType: mimeType ?? record.file.mimeType,
        updatedAt: now,
      }),
    });
  }

  async function create(
    name: string,
    parentId?: string,
    options?: { content?: string; mimeType?: string },
  ): Promise<StorageFile> {
    const parent = parentId ? await readRecord(parentId) : null;
    if (parentId && (!parent || parent.file.type !== "folder")) {
      throw new Error(`Office parent folder ${parentId} was not found.`);
    }
    const content = options?.content ?? "";
    const now = new Date().toISOString();
    const file = normalizeFile({
      id: crypto.randomUUID(),
      name,
      path: pathFor(parent?.file, name),
      parentId,
      type: "file",
      size: new TextEncoder().encode(content).byteLength,
      mimeType: options?.mimeType ?? null,
      createdAt: now,
      updatedAt: now,
    });
    await writeRecord({ schema: RECORD_SCHEMA, file, content });
    return file;
  }

  async function createFolder(
    name: string,
    parentId?: string,
  ): Promise<StorageFile> {
    const parent = parentId ? await readRecord(parentId) : null;
    if (parentId && (!parent || parent.file.type !== "folder")) {
      throw new Error(`Office parent folder ${parentId} was not found.`);
    }
    const now = new Date().toISOString();
    const file = normalizeFile({
      id: crypto.randomUUID(),
      name,
      path: pathFor(parent?.file, name),
      parentId,
      type: "folder",
      createdAt: now,
      updatedAt: now,
    });
    await writeRecord({ schema: RECORD_SCHEMA, file });
    return file;
  }

  async function rename(fileId: string, name: string): Promise<void> {
    const records = await allRecords();
    const record = records.find((entry) => entry.file.id === fileId);
    if (!record) throw new ObjectStorageError(404, "record not found");
    const previousPath = record.file.path ?? record.file.name;
    const parent = record.file.parentId
      ? records.find((entry) => entry.file.id === record.file.parentId)?.file
      : undefined;
    const nextPath = pathFor(parent, name);
    const now = new Date().toISOString();
    const changed = records.filter(
      (entry) =>
        entry.file.id === fileId ||
        (record.file.type === "folder" &&
          typeof entry.file.path === "string" &&
          entry.file.path.startsWith(`${previousPath}/`)),
    );
    await Promise.all(
      changed.map((entry) => {
        const own = entry.file.id === fileId;
        const path = own
          ? nextPath
          : `${nextPath}${entry.file.path!.slice(previousPath.length)}`;
        return writeRecord({
          ...entry,
          file: normalizeFile({
            ...entry.file,
            ...(own ? { name } : {}),
            path,
            updatedAt: now,
          }),
        });
      }),
    );
  }

  async function del(fileId: string): Promise<void> {
    const records = await allRecords();
    const record = records.find((entry) => entry.file.id === fileId);
    if (!record) return;
    const path = record.file.path ?? record.file.name;
    const ids = records.flatMap((entry) =>
      entry.file.id === fileId ||
        (record.file.type === "folder" &&
          typeof entry.file.path === "string" &&
          entry.file.path.startsWith(`${path}/`))
        ? [entry.file.id]
        : []
    );
    await Promise.all(ids.map(deleteRecord));
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

class ObjectStorageError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`Object storage API error: ${status}${body ? ` - ${body}` : ""}`);
    this.name = "ObjectStorageError";
  }
}

function normalizeObjectApiUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/o") ? trimmed : `${trimmed}/o`;
}

function normalizeKeyPrefix(value: string): string {
  // Bare segment only — the records-prefix join() supplies the separators, so
  // a trailing slash here would produce a double-slash key prefix.
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "~");
}

function pathFor(parent: StorageFile | undefined, name: string): string {
  const parentPath = parent?.path?.replace(/\/+$/, "");
  return parentPath ? `${parentPath}/${name}` : name;
}

function parseRecord(value: unknown): OfficeObjectRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<OfficeObjectRecord>;
  if (record.schema !== RECORD_SCHEMA || !record.file) return null;
  return {
    schema: RECORD_SCHEMA,
    file: normalizeFile(record.file),
    ...(typeof record.content === "string" ? { content: record.content } : {}),
  };
}

function normalizeFile(value: Partial<StorageFile>): StorageFile {
  const createdAt = value.createdAt ?? value.created_at ?? "";
  const updatedAt = value.updatedAt ?? value.updated_at ?? createdAt;
  const parentId = value.parentId ?? value.parent_id ?? undefined;
  const mimeType = value.mimeType ?? value.mime_type ?? null;
  return {
    id: String(value.id ?? ""),
    name: String(value.name ?? ""),
    ...(value.path ? { path: value.path } : {}),
    ...(parentId ? { parentId } : {}),
    parent_id: parentId ?? null,
    type: value.type === "folder" ? "folder" : "file",
    ...(typeof value.size === "number" ? { size: value.size } : {}),
    mimeType,
    mime_type: mimeType,
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
  };
}
