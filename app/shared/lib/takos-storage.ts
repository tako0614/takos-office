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
  /** Office record revision used to detect stale derived writes. */
  revision?: string;
}

export interface TakosStorageClient {
  ready(): Promise<void>;
  list(prefix?: string): Promise<StorageFile[]>;
  get(fileId: string): Promise<StorageFile | null>;
  getContent(fileId: string): Promise<string>;
  putContent(
    fileId: string,
    content: string,
    mimeType?: string,
    options?: { expectedRevision?: string },
  ): Promise<void>;
  create(
    name: string,
    parentId?: string,
    options?: { content?: string; mimeType?: string },
  ): Promise<StorageFile>;
  createFolder(name: string, parentId?: string): Promise<StorageFile>;
  rename(fileId: string, name: string): Promise<void>;
  delete(
    fileId: string,
    options?: { expectedRevision?: string },
  ): Promise<void>;
}

type OfficeObjectRecord = {
  schema: "takos.office.object-record.v1";
  revision: string;
  file: StorageFile;
  content?: string;
};

type ObjectListing = {
  objects?: Array<{ key?: unknown }>;
  truncated?: boolean;
  cursor?: unknown;
};

const RECORD_SCHEMA = "takos.office.object-record.v1" as const;
const RECORDS_PATH = "office/v1/records";
const MAX_LIST_PAGES = 100;
const MAX_RECORDS = 10_000;
const RECORD_READ_CONCURRENCY = 8;
const MAX_RECORD_CONTENT_BYTES = 8 * 1024 * 1024;
const MAX_OBJECT_JSON_BYTES = MAX_RECORD_CONTENT_BYTES + 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 16 * 1024;

type StoredRecord = {
  record: OfficeObjectRecord;
  etag: string;
};

export type ObjectStorageFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createTakosStorageClient(
  apiUrl: string,
  token: string,
  spaceId: string,
  keyPrefix = "",
  options: { fetchImpl?: ObjectStorageFetch } = {},
): TakosStorageClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const objectApiUrl = normalizeObjectApiUrl(apiUrl);
  const recordsPrefix = [
    normalizeKeyPrefix(keyPrefix),
    RECORDS_PATH,
    encodeKeyPart(spaceId),
    "",
  ]
    .join("/")
    .replace(/^\/+/, "");

  function recordKey(fileId: string): string {
    return `${recordsPrefix}${encodeKeyPart(fileId)}.json`;
  }

  async function objectRequest(
    path: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set("authorization", `Bearer ${token}`);
    const response = await fetchImpl(`${objectApiUrl}${path}`, {
      ...options,
      headers,
    });
    if (!response.ok) {
      const body = await readBoundedText(response, MAX_ERROR_BODY_BYTES).catch(
        () => "",
      );
      throw new ObjectStorageError(response.status, body);
    }
    return response;
  }

  async function readStoredRecord(
    fileId: string,
  ): Promise<StoredRecord | null> {
    try {
      const response = await objectRequest(
        `/${encodeURIComponent(recordKey(fileId))}`,
      );
      const record = parseRecord(await readBoundedJson(response), fileId);
      const etag = response.headers.get("etag");
      if (!etag) {
        throw new Error(
          "Object storage read did not return the ETag required for conditional writes.",
        );
      }
      return { record, etag };
    } catch (error) {
      if (error instanceof ObjectStorageError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async function readRecord(
    fileId: string,
  ): Promise<OfficeObjectRecord | null> {
    return (await readStoredRecord(fileId))?.record ?? null;
  }

  async function writeRecord(
    record: OfficeObjectRecord,
    condition: { createOnly?: boolean; etag?: string },
  ): Promise<void> {
    const headers = new Headers({
      "content-type": "application/json; charset=utf-8",
    });
    if (condition.createOnly) headers.set("if-none-match", "*");
    if (condition.etag) headers.set("if-match", condition.etag);
    await objectRequest(`/${encodeURIComponent(recordKey(record.file.id))}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(record),
    });
  }

  async function deleteRecord(stored: StoredRecord): Promise<void> {
    try {
      await objectRequest(
        `/${encodeURIComponent(recordKey(stored.record.file.id))}`,
        {
          method: "DELETE",
          headers: { "if-match": stored.etag },
        },
      );
    } catch (error) {
      if (error instanceof ObjectStorageError) {
        if (error.status === 404) return;
        if (error.status === 412) {
          throw new ObjectStorageConflictError(stored.record.file);
        }
      }
      throw error;
    }
  }

  async function ready(): Promise<void> {
    await objectRequest(`?prefix=${encodeURIComponent(recordsPrefix)}`);
  }

  async function allRecords(): Promise<StoredRecord[]> {
    const keys: string[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const query = new URLSearchParams({ prefix: recordsPrefix });
      if (cursor) query.set("cursor", cursor);
      const response = await objectRequest(`?${query.toString()}`);
      const listing = parseListing(await readBoundedJson(response));
      for (const entry of listing.objects ?? []) {
        if (
          typeof entry.key === "string" &&
          entry.key.startsWith(recordsPrefix)
        ) {
          keys.push(entry.key);
          if (keys.length > MAX_RECORDS) {
            throw new Error(
              `Office storage record limit exceeded (${MAX_RECORDS}).`,
            );
          }
        }
      }
      if (listing.truncated !== true) break;
      const nextCursor = listing.cursor;
      if (
        typeof nextCursor !== "string" ||
        nextCursor.length === 0 ||
        cursors.has(nextCursor)
      ) {
        throw new Error(
          "Object storage returned a truncated listing without a usable continuation cursor.",
        );
      }
      if (page === MAX_LIST_PAGES - 1) {
        throw new Error(
          `Office storage listing exceeded ${MAX_LIST_PAGES} pages.`,
        );
      }
      cursors.add(nextCursor);
      cursor = nextCursor;
    }

    const stored = await boundedMap(
      keys,
      RECORD_READ_CONCURRENCY,
      async (key): Promise<StoredRecord | null> => {
        const response = await objectRequest(`/${encodeURIComponent(key)}`);
        const record = parseRecord(await readBoundedJson(response));
        if (recordKey(record.file.id) !== key) {
          throw new Error(
            `Office record ${record.file.id} does not match its object key.`,
          );
        }
        const etag = response.headers.get("etag");
        if (!etag) {
          throw new Error(
            "Object storage read did not return the ETag required for conditional writes.",
          );
        }
        return { record, etag };
      },
    );
    return stored.filter((entry): entry is StoredRecord => entry !== null);
  }

  async function list(prefix?: string): Promise<StorageFile[]> {
    const records = (await allRecords()).map((entry) => entry.record);
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
    options?: { expectedRevision?: string },
  ): Promise<void> {
    const stored = await readStoredRecord(fileId);
    if (!stored) throw new ObjectStorageError(404, "record not found");
    if (stored.record.file.type !== "file") {
      throw new Error(`Office record ${fileId} is a folder, not a file.`);
    }
    if (
      options?.expectedRevision !== undefined &&
      stored.record.revision !== options.expectedRevision
    ) {
      throw new ObjectStorageConflictError(stored.record.file);
    }
    const now = new Date().toISOString();
    await writeRecord(
      {
        ...stored.record,
        revision: crypto.randomUUID(),
        content,
        file: normalizeFile({
          ...stored.record.file,
          size: new TextEncoder().encode(content).byteLength,
          mimeType: mimeType ?? stored.record.file.mimeType,
          updatedAt: now,
        }),
      },
      { etag: stored.etag },
    );
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
    await writeRecord(
      {
        schema: RECORD_SCHEMA,
        revision: crypto.randomUUID(),
        file,
        content,
      },
      { createOnly: true },
    );
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
    const deterministicId = await folderIdFor(parentId, name);
    const existing = await readStoredRecord(deterministicId);
    if (existing) {
      const file = existing.record.file;
      if (
        file.type === "folder" &&
        file.name === name &&
        file.parentId === parentId
      ) {
        return file;
      }
      throw new Error(`Deterministic Office folder id collision for ${name}.`);
    }
    const now = new Date().toISOString();
    const file = normalizeFile({
      id: deterministicId,
      name,
      path: pathFor(parent?.file, name),
      parentId,
      type: "folder",
      createdAt: now,
      updatedAt: now,
    });
    try {
      await writeRecord(
        {
          schema: RECORD_SCHEMA,
          revision: crypto.randomUUID(),
          file,
        },
        { createOnly: true },
      );
      return file;
    } catch (error) {
      if (!(error instanceof ObjectStorageError) || error.status !== 412) {
        throw error;
      }
      const winner = await readRecord(deterministicId);
      if (
        !winner ||
        winner.file.type !== "folder" ||
        winner.file.name !== name ||
        winner.file.parentId !== parentId
      ) {
        throw error;
      }
      return winner.file;
    }
  }

  async function rename(fileId: string, name: string): Promise<void> {
    const records = await allRecords();
    const stored = records.find((entry) => entry.record.file.id === fileId);
    if (!stored) throw new ObjectStorageError(404, "record not found");
    const previousPath = stored.record.file.path ?? stored.record.file.name;
    const parent = stored.record.file.parentId
      ? records.find(
          (entry) => entry.record.file.id === stored.record.file.parentId,
        )?.record.file
      : undefined;
    const nextPath = pathFor(parent, name);
    const now = new Date().toISOString();
    const changed = records.filter(
      (entry) =>
        entry.record.file.id === fileId ||
        (stored.record.file.type === "folder" &&
          typeof entry.record.file.path === "string" &&
          entry.record.file.path.startsWith(`${previousPath}/`)),
    );
    await Promise.all(
      changed.map((entry) => {
        const own = entry.record.file.id === fileId;
        const path = own
          ? nextPath
          : `${nextPath}${entry.record.file.path!.slice(previousPath.length)}`;
        return writeRecord(
          {
            ...entry.record,
            revision: crypto.randomUUID(),
            file: normalizeFile({
              ...entry.record.file,
              ...(own ? { name } : {}),
              path,
              updatedAt: now,
            }),
          },
          { etag: entry.etag },
        );
      }),
    );
  }

  async function del(
    fileId: string,
    options?: { expectedRevision?: string },
  ): Promise<void> {
    const records = await allRecords();
    const stored = records.find((entry) => entry.record.file.id === fileId);
    if (!stored) return;
    if (
      options?.expectedRevision !== undefined &&
      stored.record.revision !== options.expectedRevision
    ) {
      throw new ObjectStorageConflictError(stored.record.file);
    }
    const path = stored.record.file.path ?? stored.record.file.name;
    const doomed = records.flatMap((entry) =>
      entry.record.file.id === fileId ||
      (stored.record.file.type === "folder" &&
        typeof entry.record.file.path === "string" &&
        entry.record.file.path.startsWith(`${path}/`))
        ? [entry]
        : [],
    );
    await boundedMap(doomed, RECORD_READ_CONCURRENCY, deleteRecord);
  }

  return {
    ready,
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

export class ObjectStorageConflictError extends Error {
  constructor(readonly current: StorageFile) {
    super("Office object was modified by another writer.");
    this.name = "ObjectStorageConflictError";
  }
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
  // Keep percent escapes intact. Replacing "%" with "~" made "/" collide
  // with the literal string "~2F", because encodeURIComponent deliberately
  // leaves "~" unescaped.
  return encodeURIComponent(value);
}

async function folderIdFor(
  parentId: string | undefined,
  name: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${parentId ?? ""}\u0000${name}`),
  );
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `folder-${btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")}`;
}

async function boundedMap<T, U>(
  values: readonly T[],
  concurrency: number,
  fn: (value: T, index: number) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        output[index] = await fn(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return output;
}

function pathFor(parent: StorageFile | undefined, name: string): string {
  const parentPath = parent?.path?.replace(/\/+$/, "");
  return parentPath ? `${parentPath}/${name}` : name;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const bytes = await readBoundedBytes(
    response,
    MAX_OBJECT_JSON_BYTES,
    "Object storage JSON response",
  );
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Object storage returned invalid JSON.");
  }
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const bytes = await readBoundedBytes(
    response,
    maxBytes,
    "Object storage error response",
  );
  return new TextDecoder().decode(bytes);
}

async function readBoundedBytes(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared) {
    const declaredBytes = Number(declared);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`${label} exceeded ${maxBytes} bytes.`);
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`${label} had no body.`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`${label} exceeded ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseListing(value: unknown): ObjectListing {
  if (!isPlainObject(value)) {
    throw new Error("Object storage returned an invalid listing.");
  }
  const rawObjects = value.objects ?? [];
  if (!Array.isArray(rawObjects) || rawObjects.length > MAX_RECORDS) {
    throw new Error("Object storage returned an invalid listing.");
  }
  const objects = rawObjects.map((entry) => {
    if (
      !isPlainObject(entry) ||
      typeof entry.key !== "string" ||
      entry.key.length === 0 ||
      entry.key.length > 4096
    ) {
      throw new Error("Object storage returned an invalid listing entry.");
    }
    return { key: entry.key };
  });
  if (value.truncated !== undefined && typeof value.truncated !== "boolean") {
    throw new Error("Object storage returned an invalid listing.");
  }
  if (
    value.cursor !== undefined &&
    (typeof value.cursor !== "string" || value.cursor.length > 4096)
  ) {
    throw new Error("Object storage returned an invalid listing cursor.");
  }
  return {
    objects,
    ...(value.truncated !== undefined ? { truncated: value.truncated } : {}),
    ...(value.cursor !== undefined ? { cursor: value.cursor } : {}),
  };
}

function parseRecord(
  value: unknown,
  expectedFileId?: string,
): OfficeObjectRecord {
  if (!isPlainObject(value) || value.schema !== RECORD_SCHEMA) {
    throw new Error("Object storage returned an invalid Office record.");
  }
  if (!isPlainObject(value.file)) {
    throw new Error("Object storage returned an invalid Office record file.");
  }
  const file = value.file;
  const id = boundedString(file.id, "file id", 1, 256);
  if (expectedFileId !== undefined && id !== expectedFileId) {
    throw new Error(`Office record ${id} does not match its object key.`);
  }
  const name = boundedString(file.name, "file name", 1, 1024);
  if (file.type !== "file" && file.type !== "folder") {
    throw new Error("Object storage returned an invalid Office record type.");
  }
  const createdAt = boundedString(
    file.createdAt ?? file.created_at,
    "createdAt",
    1,
    64,
  );
  const updatedAt = boundedString(
    file.updatedAt ?? file.updated_at ?? createdAt,
    "updatedAt",
    1,
    64,
  );
  const path = optionalBoundedString(file.path, "path", 4096);
  const parentId = optionalBoundedString(
    file.parentId ?? file.parent_id,
    "parent id",
    256,
  );
  const mimeType = optionalBoundedString(
    file.mimeType ?? file.mime_type,
    "MIME type",
    512,
  );
  if (
    file.size !== undefined &&
    (typeof file.size !== "number" ||
      !Number.isFinite(file.size) ||
      file.size < 0)
  ) {
    throw new Error("Object storage returned an invalid Office record size.");
  }
  const revision =
    value.revision === undefined
      ? `legacy:${updatedAt}`
      : boundedString(value.revision, "revision", 1, 256);
  if (
    value.content !== undefined &&
    (typeof value.content !== "string" ||
      new TextEncoder().encode(value.content).byteLength >
        MAX_RECORD_CONTENT_BYTES)
  ) {
    throw new Error("Object storage returned invalid Office record content.");
  }
  return {
    schema: RECORD_SCHEMA,
    revision,
    file: normalizeFile({
      id,
      name,
      type: file.type,
      createdAt,
      updatedAt,
      ...(path !== undefined ? { path } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
      ...(mimeType !== undefined ? { mimeType } : {}),
      ...(typeof file.size === "number" ? { size: file.size } : {}),
      revision,
    }),
    ...(typeof value.content === "string" ? { content: value.content } : {}),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedString(
  value: unknown,
  label: string,
  minLength: number,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < minLength ||
    value.length > maxLength
  ) {
    throw new Error(`Object storage returned an invalid Office ${label}.`);
  }
  return value;
}

function optionalBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return boundedString(value, label, 1, maxLength);
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
    ...(typeof value.revision === "string" ? { revision: value.revision } : {}),
  };
}
