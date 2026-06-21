import { expect, test } from "bun:test";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { createSlideMcpServer } from "../mcp.ts";
import {
  createSlideRuntimeCapabilityManifest,
  SLIDE_SCREENSHOT_TOOL_NAME,
  SLIDE_SCREENSHOT_UNAVAILABLE_MESSAGE,
  slideScreenshotUnavailableMessage,
} from "../runtime-capabilities.ts";

function mcpToolRequestBody(name: string, args: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  };
}

async function callToolWithUnsupportedRuntime(
  store: unknown,
  args: Record<string, unknown>,
): Promise<Response> {
  const server = createSlideMcpServer(store as never, {
    runtimeCapabilities: createSlideRuntimeCapabilityManifest({
      nativeRendering: false,
    }),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  const body = mcpToolRequestBody(SLIDE_SCREENSHOT_TOOL_NAME, args);
  const raw = JSON.stringify(body);
  return transport.handleRequest(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "accept": "application/json, text/event-stream",
        "content-type": "application/json",
        "content-length": String(raw.length),
      },
      body: raw,
    }),
    { parsedBody: body },
  );
}

async function mcpTextContent(response: Response): Promise<string> {
  const body = await response.text();
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  const payload = JSON.parse(dataLine!.slice("data: ".length));
  return payload.result.content[0].text;
}

test("slide runtime capability manifest advertises screenshot support", () => {
  const manifest = createSlideRuntimeCapabilityManifest({
    nativeRendering: true,
  });

  expect(manifest.screenshot.toolName).toEqual(SLIDE_SCREENSHOT_TOOL_NAME);
  expect(manifest.screenshot.requires).toEqual(["nativeRendering"]);
  expect(manifest.screenshot.supported).toEqual(true);
  expect(slideScreenshotUnavailableMessage(manifest.screenshot)).toEqual(null);
});

test("slide_screenshot reports unsupported runtime before storage access", async () => {
  let storageTouched = false;
  const store = {
    get() {
      storageTouched = true;
      throw new Error("storage should not be touched");
    },
  };

  const response = await callToolWithUnsupportedRuntime(store, {
    presentationId: "missing",
    slideIndex: 0,
  });

  expect(response.status).toEqual(200);
  expect(await mcpTextContent(response)).toEqual(SLIDE_SCREENSHOT_UNAVAILABLE_MESSAGE);
  expect(storageTouched).toEqual(false);
});
