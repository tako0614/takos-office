import { readFile } from "node:fs/promises";

type JsonRecord = Record<string, unknown>;

const outputs = await readCapsuleOutputs();
const baseInput =
  process.env.OFFICE_URL ??
  stringOutput(outputs, "url", "public_url", "launch_url") ??
  process.env.TAKOSUMI_CAPSULE_PUBLIC_URL ??
  "";
const mcpToken = process.env.OFFICE_MCP_AUTH_TOKEN ?? "";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function resolveBaseUrl(input: string): URL {
  if (!input) fail("OFFICE_URL or a public Capsule URL is required");
  try {
    const url = new URL(input);
    url.pathname = url.pathname.replace(/\/$/, "");
    return url;
  } catch {
    fail("OFFICE_URL must be a valid URL");
  }
}

async function readCapsuleOutputs(): Promise<JsonRecord> {
  const file = process.env.TAKOSUMI_CAPSULE_OUTPUTS_FILE;
  if (!file) return {};
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  return isRecord(parsed) ? parsed : {};
}

function stringOutput(
  values: JsonRecord,
  ...names: readonly string[]
): string | undefined {
  for (const name of names) {
    const value = values[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

async function expectResponse(
  url: URL,
  init: RequestInit = {},
  expectedStatus = 200,
): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status !== expectedStatus) {
    const body = (await response.text().catch(() => "")).slice(0, 500);
    fail(
      `${init.method ?? "GET"} ${url.pathname}${url.search} returned ${response.status}, expected ${expectedStatus}${body ? `: ${body}` : ""}`,
    );
  }
  return response;
}

async function jsonRequest(
  baseUrl: URL,
  path: string,
  init: RequestInit = {},
  expectedStatus = 200,
): Promise<JsonRecord> {
  const response = await expectResponse(
    new URL(path, baseUrl),
    {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...headersRecord(init.headers),
      },
    },
    expectedStatus,
  );
  const body = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    fail(
      `${path} did not return valid JSON (${response.headers.get("content-type") ?? "unknown content type"}): ${body.slice(0, 500)}`,
    );
  }
  if (!isRecord(parsed)) fail(`${path} did not return a JSON object`);
  return parsed;
}

function parseMcpResponse(body: string, contentType: string): JsonRecord {
  const candidates = contentType.includes("text/event-stream")
    ? body
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .filter((line) => line && line !== "[DONE]")
    : [body];
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      // A stream can contain keepalive or non-JSON events before the response.
    }
  }
  fail(`MCP response was not valid JSON or SSE JSON: ${body.slice(0, 500)}`);
}

async function callMcp(
  baseUrl: URL,
  method: "tools/list" | "tools/call",
  params?: JsonRecord,
): Promise<JsonRecord> {
  if (!mcpToken) fail("OFFICE_MCP_AUTH_TOKEN is required");
  const response = await expectResponse(new URL("/mcp", baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${mcpToken}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${method}-${crypto.randomUUID()}`,
      method,
      ...(params ? { params } : {}),
    }),
  });
  const payload = parseMcpResponse(
    await response.text(),
    response.headers.get("content-type") ?? "",
  );
  if (isRecord(payload.error)) {
    fail(
      `MCP ${method} failed: ${String(payload.error.message ?? "unknown error")}`,
    );
  }
  if (!isRecord(payload.result)) fail(`MCP ${method} returned no result`);
  return payload.result;
}

async function callTool(
  baseUrl: URL,
  name: string,
  args: JsonRecord,
): Promise<JsonRecord> {
  const result = await callMcp(baseUrl, "tools/call", {
    name,
    arguments: args,
  });
  if (result.isError === true) fail(`MCP tool ${name} returned an error`);
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.find(
    (entry): entry is JsonRecord => isRecord(entry) && entry.type === "text",
  )?.text;
  if (typeof text !== "string") {
    fail(`MCP tool ${name} returned no text content`);
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    return { text };
  }
}

function requiredString(record: JsonRecord, name: string): string {
  const value = record[name];
  if (typeof value !== "string" || !value.trim()) {
    fail(`${name} was missing from the response`);
  }
  return value;
}

function assertTitle(
  record: JsonRecord,
  expected: string,
  label: string,
): void {
  if (record.title !== expected) {
    fail(`${label} title did not round-trip`);
  }
}

function assertArrayContainsId(
  value: unknown,
  id: string,
  label: string,
): void {
  if (
    !Array.isArray(value) ||
    !value.some((entry) => isRecord(entry) && entry.id === id)
  ) {
    fail(`${label} did not contain ${id}`);
  }
}

function assertArrayDoesNotContainId(
  value: unknown,
  id: string,
  label: string,
): void {
  if (
    Array.isArray(value) &&
    value.some((entry) => isRecord(entry) && entry.id === id)
  ) {
    fail(`${label} still contained ${id}`);
  }
}

function headersRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const baseUrl = resolveBaseUrl(baseInput);
const checks: string[] = [];
const suffix = Date.now().toString(36);
let documentId: string | undefined;
let presentationId: string | undefined;
let spreadsheetId: string | undefined;

try {
  await expectResponse(new URL("/healthz", baseUrl));
  checks.push("health");
  for (const path of ["/", "/docs", "/slide", "/sheet"] as const) {
    await expectResponse(new URL(path, baseUrl), {
      headers: { accept: "text/html,*/*" },
    });
    checks.push(path === "/" ? "shell" : `ui.${path.slice(1)}`);
  }

  const listedTools = await callMcp(baseUrl, "tools/list");
  const toolNames = Array.isArray(listedTools.tools)
    ? listedTools.tools.flatMap((tool) =>
        isRecord(tool) && typeof tool.name === "string" ? [tool.name] : [],
      )
    : [];
  for (const required of ["docs_create", "slide_create", "sheet_create"]) {
    if (!toolNames.includes(required)) fail(`MCP tool ${required} is missing`);
  }
  if (
    !toolNames.some((name) => name.startsWith("docs_")) ||
    !toolNames.some((name) => name.startsWith("slide_")) ||
    !toolNames.some((name) => name.startsWith("sheet_"))
  ) {
    fail("unified MCP does not expose all three Office namespaces");
  }
  checks.push("mcp.tools-list");

  const documentTitle = `Office E2E document ${suffix}`;
  const document = await callTool(baseUrl, "docs_create", {
    title: documentTitle,
    content: `<h1>${documentTitle}</h1><p>storage round trip</p>`,
  });
  documentId = requiredString(document, "id");
  const readDocument = await callTool(baseUrl, "docs_get", { id: documentId });
  assertTitle(readDocument, documentTitle, "document");
  await jsonRequest(
    baseUrl,
    `/docs/api/documents/${encodeURIComponent(documentId)}`,
    {},
    401,
  );
  checks.push("api.auth-gate");
  const renamedDocument = `${documentTitle} updated`;
  await callTool(baseUrl, "docs_set_title", {
    id: documentId,
    title: renamedDocument,
  });
  const updatedDocument = await callTool(baseUrl, "docs_get", {
    id: documentId,
  });
  assertTitle(updatedDocument, renamedDocument, "updated document");
  checks.push("docs.mcp-crud");

  const presentationTitle = `Office E2E slide ${suffix}`;
  const presentation = await callTool(baseUrl, "slide_create", {
    title: presentationTitle,
  });
  presentationId = requiredString(presentation, "id");
  const readPresentation = await callTool(baseUrl, "slide_get", {
    id: presentationId,
  });
  assertTitle(readPresentation, presentationTitle, "presentation");
  const renamedPresentation = `${presentationTitle} updated`;
  await callTool(baseUrl, "slide_set_title", {
    id: presentationId,
    title: renamedPresentation,
  });
  const updatedPresentation = await callTool(baseUrl, "slide_get", {
    id: presentationId,
  });
  assertTitle(updatedPresentation, renamedPresentation, "updated presentation");
  checks.push("slide.mcp-crud");

  const spreadsheetTitle = `Office E2E sheet ${suffix}`;
  const spreadsheet = await callTool(baseUrl, "sheet_create", {
    title: spreadsheetTitle,
  });
  spreadsheetId = requiredString(spreadsheet, "id");
  const readSpreadsheet = await callTool(baseUrl, "sheet_get", {
    id: spreadsheetId,
  });
  assertTitle(readSpreadsheet, spreadsheetTitle, "spreadsheet");
  const renamedSpreadsheet = `${spreadsheetTitle} updated`;
  await callTool(baseUrl, "sheet_set_title", {
    id: spreadsheetId,
    title: renamedSpreadsheet,
  });
  const updatedSpreadsheet = await callTool(baseUrl, "sheet_get", {
    id: spreadsheetId,
  });
  assertTitle(updatedSpreadsheet, renamedSpreadsheet, "updated spreadsheet");
  checks.push("sheet.mcp-crud");

  const documentSearch = await callTool(baseUrl, "docs_search", {
    query: suffix,
  });
  assertArrayContainsId(documentSearch.results, documentId, "Document search");
  const presentationList = await callTool(baseUrl, "slide_list", {});
  assertArrayContainsId(
    presentationList.value,
    presentationId,
    "Presentation list",
  );
  const spreadsheetList = await callTool(baseUrl, "sheet_list", {});
  assertArrayContainsId(
    spreadsheetList.value,
    spreadsheetId,
    "Spreadsheet list",
  );
  checks.push("office.mcp-search");

  await expectResponse(
    new URL(`/docs/files/${encodeURIComponent(documentId)}`, baseUrl),
    { redirect: "manual" },
    302,
  );
  await expectResponse(
    new URL(`/slide/files/${encodeURIComponent(presentationId)}`, baseUrl),
    { redirect: "manual" },
    302,
  );
  await expectResponse(
    new URL(`/sheet/files/${encodeURIComponent(spreadsheetId)}`, baseUrl),
    { redirect: "manual" },
    302,
  );
  checks.push("file-handlers");
} finally {
  if (documentId) {
    await callTool(baseUrl, "docs_delete", { id: documentId });
    const documents = await callTool(baseUrl, "docs_list", {});
    assertArrayDoesNotContainId(
      documents.documents,
      documentId,
      "Document list",
    );
    checks.push("docs.cleanup");
  }
  if (presentationId) {
    await callTool(baseUrl, "slide_delete", { id: presentationId });
    const presentations = await callTool(baseUrl, "slide_list", {});
    assertArrayDoesNotContainId(
      presentations.value,
      presentationId,
      "Presentation list",
    );
    checks.push("slide.cleanup");
  }
  if (spreadsheetId) {
    await callTool(baseUrl, "sheet_delete", { id: spreadsheetId });
    const spreadsheets = await callTool(baseUrl, "sheet_list", {});
    assertArrayDoesNotContainId(
      spreadsheets.value,
      spreadsheetId,
      "Spreadsheet list",
    );
    checks.push("sheet.cleanup");
  }
}

console.log(
  JSON.stringify({
    kind: "takosumi.capsule-functional-probe@v1",
    status: "passed",
    product: "takos-office",
    checks: checks.map((name) => ({ name, status: "passed" })),
    cleanupVerified: true,
    ok: true,
    service: "takos-office",
  }),
);
