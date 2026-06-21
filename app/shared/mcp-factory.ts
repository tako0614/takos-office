/**
 * Shared MCP-server factory for the takos-office editors (docs / slide / sheet).
 *
 * The three editors were folded into one `takos-office` worker, so this is the
 * single shared copy they all import (`app/docs`, `app/slide`, `app/sheet` →
 * `../../shared/mcp-factory.ts`); there are no longer vendored per-app copies to
 * keep in sync.
 *
 * The factory lifts genuinely-shared boilerplate that previously lived in
 * each app's mcp.ts / server.ts:
 *   - bytesToBase64 / mcpText / mcpJson result helpers
 *   - constant-time bearer auth (`authorizeMcpRequest` / `mcpAuthMisconfigured`)
 *   - bounded JSON request reader
 *   - `createAppMcpServer({ name, version, registerTools })`: shell that
 *     constructs an `McpServer` and lets the caller wire app-specific tools
 *   - `createMcpRequestHandler(createServer, options)`: HTTP entry point for
 *     the MCP Streamable HTTP transport
 *
 * App-specific tool schemas / handlers and any export / sanitisation logic
 * stay in each app's mcp.ts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export const MAX_MCP_REQUEST_BYTES = 1_000_000;

export type McpAuthOptions = {
  authToken?: string;
  allowUnauthenticated?: boolean;
};

export type McpTextContent = {
  content: [{ type: "text"; text: string }];
  isError?: boolean;
};

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

export function mcpText(s: string): McpTextContent {
  return { content: [{ type: "text" as const, text: s }] };
}

export function mcpJson(v: unknown): McpTextContent {
  return mcpText(JSON.stringify(v, null, 2));
}

/**
 * A failure result. Sets MCP's `isError: true` so an agent can tell a failed
 * tool call apart from a successful one that happens to return text. Use this
 * for not-found, validation and caught-exception paths instead of `mcpText`.
 */
export function mcpError(message: string): McpTextContent {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export async function constantTimeEqual(
  left: string,
  right: string,
): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let diff = leftBytes.length ^ rightBytes.length;
  for (
    let index = 0;
    index < leftBytes.length && index < rightBytes.length;
    index++
  ) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }
  return diff === 0;
}

export function mcpAuthMisconfigured(
  authToken?: string,
  allowUnauthenticated = false,
): Response | null {
  if (authToken || allowUnauthenticated) return null;
  return new Response(JSON.stringify({ error: "MCP_AUTH_TOKEN is required" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

export async function authorizeMcpRequest(
  request: Request,
  authToken?: string,
  allowUnauthenticated = false,
): Promise<Response | null> {
  const configError = mcpAuthMisconfigured(authToken, allowUnauthenticated);
  if (configError) return configError;
  if (!authToken) return null;

  const header = request.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || !(await constantTimeEqual(token, authToken))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return null;
}

export async function readBoundedJsonRequest(
  request: Request,
): Promise<{ request: Request; body: unknown } | Response> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_MCP_REQUEST_BYTES) {
    return new Response(JSON.stringify({ error: "Request body too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }

  const raw = await request.text();
  const byteLength = new TextEncoder().encode(raw).byteLength;
  if (byteLength > MAX_MCP_REQUEST_BYTES) {
    return new Response(JSON.stringify({ error: "Request body too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = new Headers(request.headers);
  headers.set("content-length", String(byteLength));
  return {
    request: new Request(request.url, {
      method: request.method,
      headers,
      body: raw,
    }),
    body,
  };
}

export type AppMcpServerConfig = {
  name: string;
  version: string;
  registerTools: (server: McpServer) => void;
};

/**
 * Construct an MCP server shell and let the caller register app-specific
 * tools through the `registerTools` callback. Returns the connected
 * `McpServer` instance ready to bind to a transport.
 */
export function createAppMcpServer(config: AppMcpServerConfig): McpServer {
  const server = new McpServer({
    name: config.name,
    version: config.version,
  });
  config.registerTools(server);
  return server;
}

/**
 * Wrap an `McpServer` factory in a `Request -> Response` handler that
 * implements bearer auth, bounded JSON reads and the MCP Streamable HTTP
 * transport.
 */
export function createMcpRequestHandler(
  createServer: () => McpServer,
  options: McpAuthOptions = {},
) {
  return async (request: Request): Promise<Response> => {
    const authResponse = await authorizeMcpRequest(
      request,
      options.authToken,
      options.allowUnauthenticated,
    );
    if (authResponse) return authResponse;

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const mcpServer = createServer();
    await mcpServer.connect(transport);

    if (request.method !== "POST") {
      return transport.handleRequest(request);
    }

    const bounded = await readBoundedJsonRequest(request);
    if (bounded instanceof Response) return bounded;
    return transport.handleRequest(bounded.request, {
      parsedBody: bounded.body,
    });
  };
}
