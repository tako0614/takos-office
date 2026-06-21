import { expect, test } from "bun:test";

import { createDocsMcpServer, createMcpRequestHandler } from "../mcp.ts";
import {
  createDocsRuntimeCapabilityManifest,
  DOCS_SCREENSHOT_TOOL_NAME,
  DOCS_SCREENSHOT_UNAVAILABLE_MESSAGE,
  docsScreenshotUnavailableMessage,
} from "../runtime-capabilities.ts";

function mcpToolRequest(name: string, args: Record<string, unknown>): Request {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "accept": "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

async function mcpTextContent(response: Response): Promise<string> {
  const body = await response.text();
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  const payload = JSON.parse(dataLine!.slice("data: ".length));
  return payload.result.content[0].text;
}

test("docs runtime capability manifest advertises screenshot support", () => {
  const manifest = createDocsRuntimeCapabilityManifest({
    nativeRendering: true,
  });

  expect(manifest.screenshot.toolName).toEqual(DOCS_SCREENSHOT_TOOL_NAME);
  expect(manifest.screenshot.requires).toEqual(["nativeRendering"]);
  expect(manifest.screenshot.supported).toEqual(true);
  expect(docsScreenshotUnavailableMessage(manifest.screenshot)).toEqual(null);
});

test("docs_screenshot reports unsupported runtime before storage access", async () => {
  let storageTouched = false;
  const store = {
    get() {
      storageTouched = true;
      throw new Error("storage should not be touched");
    },
  };
  const handler = createMcpRequestHandler(
    () =>
      createDocsMcpServer({
        store: store as never,
        runtimeCapabilities: createDocsRuntimeCapabilityManifest({
          nativeRendering: false,
        }),
      }),
    { allowUnauthenticated: true },
  );

  const response = await handler(
    mcpToolRequest(DOCS_SCREENSHOT_TOOL_NAME, { id: "missing" }),
  );

  expect(response.status).toEqual(200);
  expect(await mcpTextContent(response)).toEqual(DOCS_SCREENSHOT_UNAVAILABLE_MESSAGE);
  expect(storageTouched).toEqual(false);
});
