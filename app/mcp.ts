/**
 * Unified Takos Office MCP server.
 *
 * Registers the docs, slide, and sheet tool sets onto a single MCP server so
 * an agent can drive the whole office suite through one `/mcp` endpoint. Tool
 * names are already namespaced (`docs_*` / `slide_*` / `sheet_*`), so there are
 * no collisions.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createAppMcpServer } from "./shared/mcp-factory.ts";

import { registerDocsTools } from "./docs/src/mcp.ts";
import { registerSlideTools } from "./slide/src/mcp.ts";
import { registerExcelTools } from "./sheet/src/mcp.ts";

import { createDocsRuntimeCapabilityManifest } from "./docs/src/runtime-capabilities.ts";
import { createSlideRuntimeCapabilityManifest } from "./slide/src/runtime-capabilities.ts";
import { createExcelRuntimeCapabilityManifest } from "./sheet/src/runtime-capabilities.ts";

import type { DocumentStore } from "./docs/src/document-store.ts";
import type { PresentationStore } from "./slide/src/presentation-store.ts";
import type { SpreadsheetStore } from "./sheet/src/spreadsheet-store.ts";

export interface OfficeMcpServerDeps {
  docsStore: DocumentStore;
  slideStore: PresentationStore;
  sheetStore: SpreadsheetStore;
  /** Whether the runtime can render screenshots/PDF natively (Bun container). */
  nativeRendering?: boolean;
}

export function createOfficeMcpServer(deps: OfficeMcpServerDeps): McpServer {
  const nativeRendering = deps.nativeRendering ?? true;
  return createAppMcpServer({
    name: "takos-office",
    version: "0.1.0",
    registerTools: (server) => {
      registerDocsTools(
        server,
        deps.docsStore,
        createDocsRuntimeCapabilityManifest({ nativeRendering }),
      );
      registerSlideTools(
        server,
        deps.slideStore,
        createSlideRuntimeCapabilityManifest({ nativeRendering }),
      );
      registerExcelTools(
        server,
        deps.sheetStore,
        createExcelRuntimeCapabilityManifest({ nativeRendering }),
      );
    },
  });
}
