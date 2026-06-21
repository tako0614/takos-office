import { expect, test } from "bun:test";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../mcp.ts";
import {
  createExcelRuntimeCapabilityManifest,
  EXCEL_SCREENSHOT_TOOL_NAME,
  EXCEL_SCREENSHOT_UNAVAILABLE_MESSAGE,
  excelScreenshotUnavailableMessage,
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
  const server = createMcpServer(store as never, {
    runtimeCapabilities: createExcelRuntimeCapabilityManifest({
      nativeRendering: false,
    }),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  const body = mcpToolRequestBody(EXCEL_SCREENSHOT_TOOL_NAME, args);
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

test("excel runtime capability manifest advertises screenshot support", () => {
  const manifest = createExcelRuntimeCapabilityManifest({
    nativeRendering: true,
  });

  expect(manifest.screenshot.toolName).toEqual(EXCEL_SCREENSHOT_TOOL_NAME);
  expect(manifest.screenshot.requires).toEqual(["nativeRendering"]);
  expect(manifest.screenshot.supported).toEqual(true);
  expect(excelScreenshotUnavailableMessage(manifest.screenshot)).toEqual(null);
});

test("sheet_screenshot reports unsupported runtime before storage access", async () => {
  let storageTouched = false;
  const store = {
    getSpreadsheet() {
      storageTouched = true;
      throw new Error("storage should not be touched");
    },
  };

  const response = await callToolWithUnsupportedRuntime(store, {
    spreadsheetId: "missing",
    sheetId: "sheet-1",
  });

  expect(response.status).toEqual(200);
  expect(await mcpTextContent(response)).toEqual(EXCEL_SCREENSHOT_UNAVAILABLE_MESSAGE);
  expect(storageTouched).toEqual(false);
});
