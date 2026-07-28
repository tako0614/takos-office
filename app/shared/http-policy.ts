import type { Context } from "hono";
import type { z } from "zod";

export const MAX_API_JSON_BYTES = 8 * 1024 * 1024;

export class ApiInputError extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly code: "invalid_json" | "invalid_request" | "request_too_large",
  ) {
    super(code);
    this.name = "ApiInputError";
  }
}

export async function readApiJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_API_JSON_BYTES) {
    throw new ApiInputError(413, "request_too_large");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new ApiInputError(400, "invalid_json");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_API_JSON_BYTES) {
      await reader.cancel();
      throw new ApiInputError(413, "request_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiInputError(400, "invalid_json");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiInputError(400, "invalid_request");
  return parsed.data;
}

export function inputErrorResponse(
  error: unknown,
  c: Context,
): Response | null {
  return error instanceof ApiInputError
    ? c.json({ error: error.code }, error.status)
    : null;
}

export function entityTag(revision: string): string {
  return `"${revision.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function withEntityTag(response: Response, revision: string): Response {
  const headers = new Headers(response.headers);
  headers.set("etag", entityTag(revision));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function ifMatchRevision(request: Request): string | null {
  const value = request.headers.get("if-match")?.trim();
  if (!value) return null;
  const weakless = value.startsWith("W/") ? value.slice(2) : value;
  if (weakless.startsWith('"') && weakless.endsWith('"')) {
    return weakless
      .slice(1, -1)
      .replaceAll('\\"', '"')
      .replaceAll("\\\\", "\\");
  }
  return weakless;
}

export function preconditionRequired(c: Context): Response {
  return c.json({ error: "precondition_required" }, 428);
}
