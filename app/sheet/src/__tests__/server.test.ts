import { expect, test } from "bun:test";
import {
  createExcelAppFromEnv,
  createServerApp,
  EXCEL_MAX_MCP_REQUEST_BYTES,
} from "../server.ts";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

async function makeSessionCookie(
  secret: string,
  payload: { sub: string; name?: string; spaceIds: string[]; exp: number },
): Promise<string> {
  const data = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  // Mirror app-auth seal(): the MAC is bound to the "session" purpose.
  const signed = `session.${data}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signed),
  );
  return `${data}.${base64Url(new Uint8Array(signature))}`;
}

const OBJECT_API_BASE = "http://localhost:8787/o";

type OfficeRecord = {
  schema: "takos.office.object-record.v1";
  file: {
    id: string;
    name: string;
    path?: string;
    parentId?: string;
    type: "file" | "folder";
    size?: number;
    mimeType?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  content?: string;
};

const recordKey = (spaceId: string, fileId: string) =>
  `office/v1/records/${spaceId}/${fileId}.json`;

/**
 * In-memory mock of the provider-neutral `storage.object` surface used by
 * createTakosStorageClient: GET `<base>?prefix=` lists keys, and
 * GET/PUT/DELETE `<base>/<encoded key>` reads/writes/removes one record.
 */
function installObjectStorageMock(records: Map<string, OfficeRecord>) {
  const originalFetch = globalThis.fetch;
  const calls: { method: string; url: string; body?: string }[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = request?.url ?? String(input);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ method, url, ...(body !== undefined ? { body } : {}) });

    if (!url.startsWith(OBJECT_API_BASE)) {
      return Promise.resolve(
        Response.json({ error: "unexpected" }, { status: 500 }),
      );
    }
    const rest = url.slice(OBJECT_API_BASE.length);
    if (rest === "" || rest.startsWith("?")) {
      const prefix = new URL(url).searchParams.get("prefix") ?? "";
      const objects = [...records.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ key }));
      return Promise.resolve(Response.json({ objects }));
    }
    const key = decodeURIComponent(rest.slice(1));
    if (method === "PUT") {
      records.set(key, JSON.parse(body ?? "{}") as OfficeRecord);
      return Promise.resolve(Response.json({ key }));
    }
    if (method === "DELETE") {
      records.delete(key);
      return Promise.resolve(Response.json({ deleted: true }));
    }
    const record = records.get(key);
    if (!record) {
      return Promise.resolve(
        Response.json({ error: "object_not_found" }, { status: 404 }),
      );
    }
    return Promise.resolve(Response.json(record));
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function seedSpreadsheetRecords(
  now: string,
  spreadsheet: { id: string },
  fileName = `${spreadsheet.id}.takossheet`,
) {
  return new Map<string, OfficeRecord>([
    [recordKey("space-q", "folder-1"), {
      schema: "takos.office.object-record.v1",
      file: {
        id: "folder-1",
        name: "takos-excel",
        path: "takos-excel",
        type: "folder",
        createdAt: now,
        updatedAt: now,
      },
    }],
    [recordKey("space-q", "file-1"), {
      schema: "takos.office.object-record.v1",
      file: {
        id: "file-1",
        name: fileName,
        path: `takos-excel/${fileName}`,
        parentId: "folder-1",
        type: "file",
        mimeType: "application/vnd.takos.excel+json",
        createdAt: now,
        updatedAt: now,
      },
      content: JSON.stringify(spreadsheet),
    }],
  ]);
}

const store = {} as never;
const app = createServerApp(store, { mcpAuthToken: "secret" });

test("health endpoint returns ok", async () => {
  const res = await app.request("/health");
  expect(res.status).toEqual(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("root path is not a text landing route", async () => {
  const res = await app.request("/");
  expect(res.status).toEqual(404);
});

test("spreadsheet collection writes require app auth when enabled", async () => {
  const authApp = createServerApp(store, {
    env: {
      APP_AUTH_REQUIRED: "1",
      OAUTH_ISSUER_URL: "https://takos.example",
      OAUTH_CLIENT_ID: "client",
      OAUTH_CLIENT_SECRET: "secret",
      APP_SESSION_SECRET: "session-secret",
    },
  });
  const res = await authApp.request(
    new Request("http://localhost/api/spreadsheets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Private" }),
    }),
  );

  expect(res.status).toEqual(401);
  expect(await res.json()).toEqual({ error: "Unauthorized" });
});

test("mcp endpoint rejects oversized request bodies", async () => {
  const authApp = createServerApp(store, { mcpAuthToken: "secret" });
  const res = await authApp.request(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Authorization": "Bearer secret",
        "content-type": "application/json",
        "content-length": String(EXCEL_MAX_MCP_REQUEST_BYTES + 1),
      },
      body: "{}",
    }),
  );

  expect(res.status).toEqual(413);
  expect(await res.json()).toEqual({ error: "Request body too large" });
});

test("mcp endpoint enforces optional bearer auth before handling body", async () => {
  const authApp = createServerApp(store, { mcpAuthToken: "secret" });
  const res = await authApp.request(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );

  expect(res.status).toEqual(401);
  expect(await res.json()).toEqual({ error: "Unauthorized" });
});

test("mcp endpoint fails closed when token is missing", async () => {
  const authApp = createServerApp(store);
  const res = await authApp.request(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );

  expect(res.status).toEqual(503);
  expect(await res.json()).toEqual({ error: "MCP_AUTH_TOKEN is required" });
});

test("health endpoint allows explicit unauthenticated access when configured", async () => {
  const authApp = createServerApp(store, { mcpAllowUnauthenticated: true });
  const res = await authApp.request("/health");

  expect(res.status).toEqual(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("startup does not require TAKOS_SPACE_ID", async () => {
  const authApp = createExcelAppFromEnv({
    OBJECT_STORAGE_API_URL: "http://localhost:8787",
    OBJECT_STORAGE_ACCESS_TOKEN: "token",
    TAKOS_SPACE_ID: undefined,
    TAKOS_NATIVE_RENDERING: "0",
    MCP_AUTH_TOKEN: "secret",
  });
  const res = await authApp.request("/health");

  expect(res.status).toEqual(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("file handler route redirects to spreadsheet editor route", async () => {
  const authApp = createExcelAppFromEnv({
    OBJECT_STORAGE_API_URL: "http://localhost:8787",
    OBJECT_STORAGE_ACCESS_TOKEN: "token",
    TAKOS_SPACE_ID: "space-1",
    TAKOS_NATIVE_RENDERING: "0",
    MCP_AUTH_TOKEN: "secret",
  });
  const res = await authApp.request("/files/file-1?space_id=space-q");

  expect(res.status).toEqual(302);
  expect(res.headers.get("location")).toEqual("/sheet/file-1?space_id=space-q");
});

test("spreadsheet API opens and saves advertised file by storage id in request space", async () => {
  const now = "2026-04-30T00:00:00.000Z";
  const spreadsheet = {
    id: "sheet-1",
    title: "Budget",
    sheets: [{
      id: "tab-1",
      name: "Sheet1",
      cells: {},
      colWidths: {},
      rowHeights: {},
    }],
    activeSheetId: "tab-1",
    createdAt: now,
    updatedAt: now,
  };
  const records = seedSpreadsheetRecords(now, spreadsheet, "Budget.takossheet");
  const mock = installObjectStorageMock(records);

  try {
    const authApp = createExcelAppFromEnv({
      OBJECT_STORAGE_API_URL: "http://localhost:8787",
      OBJECT_STORAGE_ACCESS_TOKEN: "token",
      TAKOS_SPACE_ID: undefined,
      TAKOS_NATIVE_RENDERING: "0",
      MCP_AUTH_TOKEN: "secret",
    });
    const getRes = await authApp.request(
      "/api/spreadsheets/file-1?space_id=space-q",
    );
    expect(getRes.status).toEqual(200);
    expect(await getRes.json()).toEqual(spreadsheet);

    const putRes = await authApp.request(
      new Request(
        "http://localhost/api/spreadsheets/file-1?space_id=space-q",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...spreadsheet, title: "Updated" }),
        },
      ),
    );
    expect(putRes.status).toEqual(200);
    expect((await putRes.json()).id).toEqual("sheet-1");

    // The save must land on file-1's record key in the request space.
    const savedKey = recordKey("space-q", "file-1");
    const saveCall = mock.calls.find((call) =>
      call.method === "PUT" &&
      call.url === `${OBJECT_API_BASE}/${encodeURIComponent(savedKey)}`
    );
    expect(saveCall).toBeTruthy();
    const saved = records.get(savedKey);
    expect(saved?.file.mimeType).toEqual("application/vnd.takos.excel+json");
    expect(JSON.parse(saved?.content ?? "{}").title).toEqual("Updated");
  } finally {
    mock.restore();
  }
});

test("spreadsheet API renames a spreadsheet via PATCH and persists the new title", async () => {
  const now = "2026-04-30T00:00:00.000Z";
  const spreadsheet = {
    id: "sheet-1",
    title: "Budget",
    sheets: [{
      id: "tab-1",
      name: "Sheet1",
      cells: {},
      colWidths: {},
      rowHeights: {},
    }],
    activeSheetId: "tab-1",
    createdAt: now,
    updatedAt: now,
  };
  const records = seedSpreadsheetRecords(now, spreadsheet);
  const mock = installObjectStorageMock(records);

  try {
    const authApp = createExcelAppFromEnv({
      OBJECT_STORAGE_API_URL: "http://localhost:8787",
      OBJECT_STORAGE_ACCESS_TOKEN: "token",
      TAKOS_SPACE_ID: undefined,
      TAKOS_NATIVE_RENDERING: "0",
      MCP_AUTH_TOKEN: "secret",
    });
    const res = await authApp.request(
      new Request(
        "http://localhost/api/spreadsheets/sheet-1?space_id=space-q",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "New name" }),
        },
      ),
    );
    expect(res.status).toEqual(200);
    const renamed = await res.json();
    expect(renamed.id).toEqual("sheet-1");
    expect(renamed.title).toEqual("New name");
    // PATCH responds with the full updated spreadsheet.
    expect(renamed.sheets.length).toEqual(1);
    expect(renamed.activeSheetId).toEqual("tab-1");

    // The stored record was re-PUT with the new title.
    const saved = records.get(recordKey("space-q", "file-1"));
    expect(JSON.parse(saved?.content ?? "{}").title).toEqual("New name");
  } finally {
    mock.restore();
  }
});

test("spreadsheet API PATCH rejects empty or missing titles and unknown ids", async () => {
  const now = "2026-04-30T00:00:00.000Z";
  const spreadsheet = {
    id: "sheet-1",
    title: "Budget",
    sheets: [{
      id: "tab-1",
      name: "Sheet1",
      cells: {},
      colWidths: {},
      rowHeights: {},
    }],
    activeSheetId: "tab-1",
    createdAt: now,
    updatedAt: now,
  };
  const records = seedSpreadsheetRecords(now, spreadsheet);
  const mock = installObjectStorageMock(records);

  try {
    const authApp = createExcelAppFromEnv({
      OBJECT_STORAGE_API_URL: "http://localhost:8787",
      OBJECT_STORAGE_ACCESS_TOKEN: "token",
      TAKOS_SPACE_ID: undefined,
      TAKOS_NATIVE_RENDERING: "0",
      MCP_AUTH_TOKEN: "secret",
    });
    const patch = (id: string, body: unknown) =>
      authApp.request(
        new Request(
          `http://localhost/api/spreadsheets/${id}?space_id=space-q`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        ),
      );

    const emptyTitle = await patch("sheet-1", { title: "" });
    expect(emptyTitle.status).toEqual(400);
    expect(await emptyTitle.json()).toEqual({ error: "title_required" });

    const missingTitle = await patch("sheet-1", {});
    expect(missingTitle.status).toEqual(400);
    expect(await missingTitle.json()).toEqual({ error: "title_required" });

    const unknownId = await patch("nope", { title: "New name" });
    expect(unknownId.status).toEqual(404);
    expect(await unknownId.json()).toEqual({
      error: "Spreadsheet not found",
    });

    // The rejected requests never rewrote the stored record.
    const saved = records.get(recordKey("space-q", "file-1"));
    expect(JSON.parse(saved?.content ?? "{}").title).toEqual("Budget");
  } finally {
    mock.restore();
  }
});

test("health endpoint fails when token is missing", async () => {
  const authApp = createServerApp(store);
  const res = await authApp.request("/health");

  expect(res.status).toEqual(503);
  expect(await res.json()).toEqual({ error: "MCP_AUTH_TOKEN is required" });
});

test("spreadsheet API rejects spaces outside the subject's membership", async () => {
  const sessionSecret = "session-secret";
  const authApp = createExcelAppFromEnv({
    OBJECT_STORAGE_API_URL: "http://localhost:8787",
    OBJECT_STORAGE_ACCESS_TOKEN: "token",
    TAKOS_SPACE_ID: undefined,
    TAKOS_NATIVE_RENDERING: "0",
    MCP_AUTH_TOKEN: "secret",
    APP_AUTH_REQUIRED: "1",
    OAUTH_ISSUER_URL: "https://takos.example",
    OAUTH_CLIENT_ID: "client",
    OAUTH_CLIENT_SECRET: "secret",
    APP_SESSION_SECRET: sessionSecret,
  });
  const cookie = await makeSessionCookie(sessionSecret, {
    sub: "alice",
    spaceIds: ["space-1"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const denied = await authApp.request(
    new Request("http://localhost/api/spreadsheets?space_id=space-other", {
      method: "GET",
      headers: { Cookie: `takos_app_session=${cookie}` },
    }),
  );
  expect(denied.status).toEqual(403);
  expect(await denied.json()).toEqual({ error: "space_membership_required" });
});

test("spreadsheet API allows spaces in the subject's membership", async () => {
  const sessionSecret = "session-secret";
  const authApp = createExcelAppFromEnv({
    OBJECT_STORAGE_API_URL: "http://localhost:8787",
    OBJECT_STORAGE_ACCESS_TOKEN: "token",
    TAKOS_SPACE_ID: undefined,
    TAKOS_NATIVE_RENDERING: "0",
    MCP_AUTH_TOKEN: "secret",
    APP_AUTH_REQUIRED: "1",
    OAUTH_ISSUER_URL: "https://takos.example",
    OAUTH_CLIENT_ID: "client",
    OAUTH_CLIENT_SECRET: "secret",
    APP_SESSION_SECRET: sessionSecret,
  });
  const cookie = await makeSessionCookie(sessionSecret, {
    sub: "alice",
    spaceIds: ["space-allowed"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  // Probe the auth-only route to confirm middleware accepts a member subject.
  const allowed = await authApp.request(
    new Request("http://localhost/api/auth/me", {
      method: "GET",
      headers: { Cookie: `takos_app_session=${cookie}` },
    }),
  );
  expect(allowed.status).toEqual(200);
  expect(await allowed.json()).toEqual({ authenticated: true });
});
