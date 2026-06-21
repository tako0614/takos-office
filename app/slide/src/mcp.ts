/**
 * MCP Server for takos-slide presentation editing.
 *
 * Exposes:
 * - slide_list / slide_create / slide_get / slide_delete / slide_set_title
 * - slide_add / slide_remove / slide_reorder / slide_set_background / slide_duplicate
 * - slide_add_text / slide_add_shape / slide_add_image
 * - slide_remove_element / slide_update_element / slide_move_element / slide_resize_element
 * - slide_screenshot
 * - slide_export_json / slide_export_pdf / slide_get_slide_count
 * - slide_set_transition
 * - slide_list_templates / slide_create_from_template / slide_add_from_template
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PresentationStore } from "./presentation-store.ts";
import {
  createSlideRuntimeCapabilityManifest,
  type SlideRuntimeCapabilityManifest,
  slideScreenshotUnavailableMessage,
} from "./runtime-capabilities.ts";
import {
  bytesToBase64,
  createAppMcpServer,
  mcpError,
  mcpJson,
  mcpText,
} from "../../shared/mcp-factory.ts";

export type SlideMcpServerOptions = {
  nativeRendering?: boolean;
  runtimeCapabilities?: SlideRuntimeCapabilityManifest;
};

export function createSlideMcpServer(
  store: PresentationStore,
  options: SlideMcpServerOptions = {},
): McpServer {
  const runtimeCapabilities = options.runtimeCapabilities ??
    createSlideRuntimeCapabilityManifest({
      nativeRendering: options.nativeRendering ?? true,
    });
  return createAppMcpServer({
    name: "takos-slide",
    version: "1.0.0",
    registerTools: (server) =>
      registerSlideTools(server, store, runtimeCapabilities),
  });
}

export function registerSlideTools(
  server: McpServer,
  store: PresentationStore,
  runtimeCapabilities: SlideRuntimeCapabilityManifest,
): void {
  const text = mcpText;
  const json = mcpJson;
  const error = mcpError;

  const MAX_ID_LENGTH = 128;
  const MAX_TITLE_LENGTH = 200;
  const MAX_TEXT_LENGTH = 10_000;
  const MAX_CSS_VALUE_LENGTH = 200;
  const MAX_URL_LENGTH = 2_048;
  const MIN_COORDINATE = -5_000;
  const MAX_COORDINATE = 5_000;
  const MIN_SIZE = 1;
  const MAX_SIZE = 5_000;
  const MAX_SLIDES = 500;
  const MIN_SCREENSHOT_WIDTH = 320;
  const MAX_SCREENSHOT_WIDTH = 2_400;
  const MIN_SCREENSHOT_HEIGHT = 180;
  const MAX_SCREENSHOT_HEIGHT = 1_600;

  const idSchema = z.string().trim().min(1).max(MAX_ID_LENGTH);
  const titleSchema = z.string().max(MAX_TITLE_LENGTH);
  const slideIndexSchema = z.number().int().min(0).max(MAX_SLIDES);
  const coordinateSchema = z.number().min(MIN_COORDINATE).max(MAX_COORDINATE);
  const sizeSchema = z.number().min(MIN_SIZE).max(MAX_SIZE);
  const cssValueSchema = z
    .string()
    .trim()
    .min(1)
    .max(MAX_CSS_VALUE_LENGTH)
    .refine((value) => !/[<>{};]/.test(value) && !/\burl\s*\(/i.test(value), {
      message: "Must be a safe CSS color or gradient",
    });
  const imageUrlSchema = z
    .string()
    .trim()
    .min(1)
    .max(MAX_URL_LENGTH)
    .refine((value) => {
      if (
        /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=\s]+$/i
          .test(value)
      ) {
        return value.length <= 100_000;
      }
      try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    }, { message: "Must be an http(s) URL or supported data image" });
  const elementUpdateSchema = z
    .object({
      x: coordinateSchema.optional(),
      y: coordinateSchema.optional(),
      width: sizeSchema.optional(),
      height: sizeSchema.optional(),
      rotation: z.number().min(-360).max(360).optional(),
      text: z.string().max(MAX_TEXT_LENGTH).optional(),
      fontSize: z.number().int().min(1).max(200).optional(),
      fontFamily: z.string().trim().min(1).max(120).refine(
        (value) => !/[<>{};]/.test(value),
        { message: "Must be a safe font family string" },
      ).optional(),
      fontColor: cssValueSchema.optional(),
      textAlign: z.enum(["left", "center", "right"]).optional(),
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      shapeType: z.enum(["rect", "ellipse", "triangle", "arrow"]).optional(),
      fillColor: cssValueSchema.optional(),
      strokeColor: cssValueSchema.optional(),
      strokeWidth: z.number().min(0).max(100).optional(),
      imageUrl: imageUrlSchema.optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one property is required",
    });

  // =========================================================================
  // Presentation Management
  // =========================================================================

  server.tool(
    "slide_list",
    "List all presentations. Returns id, title, slideCount and updatedAt for each.",
    {},
    async () => json(await store.list()),
  );

  server.tool(
    "slide_create",
    "Create a new presentation with one blank slide.",
    { title: titleSchema.describe("Presentation title") },
    async ({ title }: { title: string }) => json(await store.create(title)),
  );

  server.tool(
    "slide_get",
    "Get full presentation data including all slides and elements.",
    { id: idSchema.describe("Presentation ID") },
    async ({ id }: { id: string }) => {
      const p = await store.get(id);
      if (!p) return error(`Presentation not found: ${id}`);
      return json(p);
    },
  );

  server.tool(
    "slide_delete",
    "Delete a presentation.",
    { id: idSchema.describe("Presentation ID") },
    async ({ id }: { id: string }) => {
      const ok = await store.delete(id);
      if (!ok) return error(`Presentation not found: ${id}`);
      return text("Deleted");
    },
  );

  server.tool(
    "slide_set_title",
    "Rename a presentation.",
    {
      id: idSchema.describe("Presentation ID"),
      title: titleSchema.describe("New title"),
    },
    async ({ id, title }: { id: string; title: string }) => {
      try {
        return json(await store.setTitle(id, title));
      } catch (e) {
        return error(String(e));
      }
    },
  );

  // =========================================================================
  // Slide Operations
  // =========================================================================

  server.tool(
    "slide_add",
    "Add a new blank slide to a presentation.",
    {
      presentationId: idSchema.describe("Presentation ID"),
      index: z
        .number()
        .int()
        .min(0)
        .max(MAX_SLIDES)
        .optional()
        .describe("Insert position (0-based). Appended if omitted."),
      background: cssValueSchema
        .optional()
        .describe('CSS color or gradient (default: "#ffffff")'),
    },
    async ({
      presentationId,
      index,
      background,
    }: {
      presentationId: string;
      index?: number;
      background?: string;
    }) => {
      try {
        return json(await store.addSlide(presentationId, index, background));
      } catch (e) {
        return error(String(e));
      }
    },
  );

  server.tool(
    "slide_remove",
    "Remove a slide from a presentation.",
    {
      presentationId: idSchema.describe("Presentation ID"),
      slideIndex: slideIndexSchema.describe("0-based slide index"),
    },
    async ({
      presentationId,
      slideIndex,
    }: {
      presentationId: string;
      slideIndex: number;
    }) => {
      try {
        await store.removeSlide(presentationId, slideIndex);
        return text("Removed");
      } catch (e) {
        return error(String(e));
      }
    },
  );

  server.tool(
    "slide_reorder",
    "Move a slide from one position to another.",
    {
      presentationId: idSchema.describe("Presentation ID"),
      fromIndex: slideIndexSchema.describe("Current 0-based index"),
      toIndex: slideIndexSchema.describe("Target 0-based index"),
    },
    async ({
      presentationId,
      fromIndex,
      toIndex,
    }: {
      presentationId: string;
      fromIndex: number;
      toIndex: number;
    }) => {
      try {
        await store.reorderSlide(presentationId, fromIndex, toIndex);
        return text("Reordered");
      } catch (e) {
        return error(String(e));
      }
    },
  );

  server.tool(
    "slide_set_background",
    "Set the background of a slide (CSS color or gradient).",
    {
      presentationId: idSchema.describe("Presentation ID"),
      slideIndex: slideIndexSchema.describe("0-based slide index"),
      background: cssValueSchema.describe("CSS color or gradient value"),
    },
    async ({
      presentationId,
      slideIndex,
      background,
    }: {
      presentationId: string;
      slideIndex: number;
      background: string;
    }) => {
      try {
        await store.setSlideBackground(presentationId, slideIndex, background);
        return text("Background updated");
      } catch (e) {
        return error(String(e));
      }
    },
  );

  server.tool(
    "slide_duplicate",
    "Duplicate a slide (inserted immediately after the original).",
    {
      presentationId: idSchema.describe("Presentation ID"),
      slideIndex: slideIndexSchema.describe("0-based slide index to duplicate"),
    },
    async ({
      presentationId,
      slideIndex,
    }: {
      presentationId: string;
      slideIndex: number;
    }) => {
      try {
        return json(await store.duplicateSlide(presentationId, slideIndex));
      } catch (e) {
        return error(String(e));
      }
    },
  );

  // =========================================================================
  // Element Operations
  // =========================================================================

  server.tool(
    "slide_add_text",
    "Add a text box element to a slide.",
    {
      presentationId: idSchema.describe("Presentation ID"),
      slideIndex: slideIndexSchema.describe("0-based slide index"),
      text: z.string().max(MAX_TEXT_LENGTH).describe("Text content"),
      x: coordinateSchema.describe("X position in pixels"),
      y: coordinateSchema.describe("Y position in pixels"),
      width: sizeSchema.optional().describe("Width in pixels (default: 300)"),
      height: sizeSchema.optional().describe("Height in pixels (default: 60)"),
      fontSize: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Font size in pixels (default: 24)"),
      fontColor: cssValueSchema
        .optional()
        .describe('Font color CSS value (default: "#333333")'),
      bold: z.boolean().optional().describe("Bold text (default: false)"),
      italic: z.boolean().optional().describe("Italic text (default: false)"),
    },
    async (args: {
      presentationId: string;
      slideIndex: number;
      text: string;
      x: number;
      y: number;
      width?: number;
      height?: number;
      fontSize?: number;
      fontColor?: string;
      bold?: boolean;
      italic?: boolean;
    }) => {
      try {
        return json(
          await store.addTextElement(args.presentationId, args.slideIndex, {
            text: args.text,
            x: args.x,
            y: args.y,
            width: args.width,
            height: args.height,
            fontSize: args.fontSize,
            fontColor: args.fontColor,
            bold: args.bold,
            italic: args.italic,
          }),
        );
      } catch (e) {
        return error(String(e));
      }
    },
  );

  server.tool(
    "slide_add_shape",
    "Add a shape element to a slide.",
    {
      presentationId: idSchema.describe("Presentation ID"),
      slideIndex: slideIndexSchema.describe("0-based slide index"),
      shapeType: z
        .enum(["rect", "ellipse", "triangle", "arrow"])
        .describe("Shape type"),
      x: coordinateSchema.describe("X position in pixels"),
      y: coordinateSchema.describe("Y position in pixels"),
      width: sizeSchema.describe("Width in pixels"),
      height: sizeSchema.describe("Height in pixels"),
      fillColor: cssValueSchema
        .optional()
        .describe('Fill color (default: "#4f87e0")'),
      strokeColor: cssValueSchema
        .optional()
        .describe('Stroke color (default: "#2563eb")'),
    },
    async (args: {
      presentationId: string;
      slideIndex: number;
      shapeType: "rect" | "ellipse" | "triangle" | "arrow";
      x: number;
      y: number;
      width: number;
      height: number;
      fillColor?: string;
      strokeColor?: string;
    }) => {
      try {
        return json(
          await store.addShapeElement(args.presentationId, args.slideIndex, {
            shapeType: args.shapeType,
            x: args.x,
            y: args.y,
            width: args.width,
            height: args.height,
            fillColor: args.fillColor,
            strokeColor: args.strokeColor,
          }),
        );
      } catch (e) {
        return error(String(e));
      }
    },
  );

  server.tool(
    "slide_add_image",
    "Add an image element to a slide.",
    {
      presentationId: idSchema.describe("Presentation ID"),
      slideIndex: slideIndexSchema.describe("0-based slide index"),
      imageUrl: imageUrlSchema.describe("Image URL"),
      x: coordinateSchema.describe("X position in pixels"),
      y: coordinateSchema.describe("Y position in pixels"),
      width: sizeSchema.optional().describe("Width in pixels (default: 300)"),
      height: sizeSchema.optional().describe("Height in pixels (default: 200)"),
    },
    async (args: {
      presentationId: string;
      slideIndex: number;
      imageUrl: string;
      x: number;
      y: number;
      width?: number;
      height?: number;
    }) => {
      try {
        return json(
          await store.addImageElement(args.presentationId, args.slideIndex, {
            imageUrl: args.imageUrl,
            x: args.x,
            y: args.y,
            width: args.width,
            height: args.height,
          }),
        );
      } catch (e) {
        return error(String(e));
      }
    },
  );

  server.tool(
    "slide_remove_element",
    "Remove an element from a slide.",
    {
      presentationId: idSchema.describe("Presentation ID"),
      slideIndex: slideIndexSchema.describe("0-based slide index"),
      elementId: idSchema.describe("Element ID"),
    },
    async ({
      presentationId,
      slideIndex,
      elementId,
    }: {
      presentationId: string;
      slideIndex: number;
      elementId: string;
    }) => {
      try {
        await store.removeElement(presentationId, slideIndex, elementId);
        return text("Removed");
      } catch (e) {
        return error(String(e));
      }
    },
  );

  server.tool(
    "slide_update_element",
    "Update properties of an existing element.",
    {
      presentationId: idSchema.describe("Presentation ID"),
      slideIndex: slideIndexSchema.describe("0-based slide index"),
      elementId: idSchema.describe("Element ID"),
      properties: elementUpdateSchema.describe(
        "Whitelisted element properties to update",
      ),
    },
    async ({
      presentationId,
      slideIndex,
      elementId,
      properties,
    }: {
      presentationId: string;
      slideIndex: number;
      elementId: string;
      properties: Record<string, unknown>;
    }) => {
      try {
        return json(
          await store.updateElement(
            presentationId,
            slideIndex,
            elementId,
            properties,
          ),
        );
      } catch (e) {
        return error(String(e));
      }
    },
  );

  server.tool(
    "slide_move_element",
    "Move an element to a new position.",
    {
      presentationId: idSchema.describe("Presentation ID"),
      slideIndex: slideIndexSchema.describe("0-based slide index"),
      elementId: idSchema.describe("Element ID"),
      x: coordinateSchema.describe("New X position in pixels"),
      y: coordinateSchema.describe("New Y position in pixels"),
    },
    async ({
      presentationId,
      slideIndex,
      elementId,
      x,
      y,
    }: {
      presentationId: string;
      slideIndex: number;
      elementId: string;
      x: number;
      y: number;
    }) => {
      try {
        return json(
          await store.moveElement(presentationId, slideIndex, elementId, x, y),
        );
      } catch (e) {
        return error(String(e));
      }
    },
  );

  server.tool(
    "slide_resize_element",
    "Resize an element.",
    {
      presentationId: idSchema.describe("Presentation ID"),
      slideIndex: slideIndexSchema.describe("0-based slide index"),
      elementId: idSchema.describe("Element ID"),
      width: sizeSchema.describe("New width in pixels"),
      height: sizeSchema.describe("New height in pixels"),
    },
    async ({
      presentationId,
      slideIndex,
      elementId,
      width,
      height,
    }: {
      presentationId: string;
      slideIndex: number;
      elementId: string;
      width: number;
      height: number;
    }) => {
      try {
        return json(
          await store.resizeElement(
            presentationId,
            slideIndex,
            elementId,
            width,
            height,
          ),
        );
      } catch (e) {
        return error(String(e));
      }
    },
  );

  // =========================================================================
  // Screenshot
  // =========================================================================

  server.tool(
    "slide_screenshot",
    "Take a screenshot of a slide as a PNG image for visual inspection.",
    {
      presentationId: idSchema.describe("Presentation ID"),
      slideIndex: slideIndexSchema.describe("Slide index (0-based)"),
      width: z
        .number()
        .int()
        .min(MIN_SCREENSHOT_WIDTH)
        .max(MAX_SCREENSHOT_WIDTH)
        .optional()
        .describe("Image width in pixels (default: 1280)"),
      height: z
        .number()
        .int()
        .min(MIN_SCREENSHOT_HEIGHT)
        .max(MAX_SCREENSHOT_HEIGHT)
        .optional()
        .describe("Image height in pixels (default: 720)"),
    },
    async ({
      presentationId,
      slideIndex,
      width,
      height,
    }: {
      presentationId: string;
      slideIndex: number;
      width?: number;
      height?: number;
    }) => {
      const unavailable = slideScreenshotUnavailableMessage(
        runtimeCapabilities.screenshot,
      );
      if (unavailable) return error(unavailable);

      const p = await store.get(presentationId);
      if (!p) return error(`Presentation not found: ${presentationId}`);
      const slide = p.slides[slideIndex];
      if (!slide) {
        return error(
          `Slide index ${slideIndex} out of range (0..${p.slides.length - 1})`,
        );
      }

      try {
        const safeWidth = Math.min(
          MAX_SCREENSHOT_WIDTH,
          Math.max(MIN_SCREENSHOT_WIDTH, Math.trunc(width ?? 1280)),
        );
        const safeHeight = Math.min(
          MAX_SCREENSHOT_HEIGHT,
          Math.max(MIN_SCREENSHOT_HEIGHT, Math.trunc(height ?? 720)),
        );
        const rendererModule = "./lib/server-renderer.ts";
        const { renderSlideToBuffer } = await import(
          rendererModule
        ) as typeof import("./lib/server-renderer.ts");
        const buf = renderSlideToBuffer(slide, safeWidth, safeHeight);
        const base64 = bytesToBase64(buf);
        return {
          content: [
            {
              type: "image" as const,
              data: base64,
              mimeType: "image/png",
            },
          ],
        };
      } catch (e) {
        return error(`Failed to render slide: ${String(e)}`);
      }
    },
  );

  // =========================================================================
  // Export
  // =========================================================================

  server.tool(
    "slide_export_json",
    "Export a presentation as JSON.",
    { id: idSchema.describe("Presentation ID") },
    async ({ id }: { id: string }) => {
      try {
        return json(await store.exportJson(id));
      } catch (e) {
        return error(String(e));
      }
    },
  );

  server.tool(
    "slide_export_pdf",
    "Export a presentation as a PDF file. Returns base64-encoded PDF data.",
    { id: idSchema.describe("Presentation ID") },
    async ({ id }: { id: string }) => {
      try {
        const pdfBytes = await store.exportPdf(id);
        const base64 = bytesToBase64(pdfBytes);
        return text(base64);
      } catch (e) {
        return error(`Failed to export PDF: ${String(e)}`);
      }
    },
  );

  server.tool(
    "slide_get_slide_count",
    "Get the number of slides in a presentation.",
    { id: idSchema.describe("Presentation ID") },
    async ({ id }: { id: string }) => {
      try {
        return json({ slideCount: await store.getSlideCount(id) });
      } catch (e) {
        return error(String(e));
      }
    },
  );

  // =========================================================================
  // Transitions
  // =========================================================================

  server.tool(
    "slide_set_transition",
    "Set a transition effect for a slide. The transition plays when navigating to this slide during presentation.",
    {
      presentationId: idSchema.describe("Presentation ID"),
      slideIndex: slideIndexSchema.describe("0-based slide index"),
      type: z
        .enum(["none", "fade", "slide-left", "slide-right", "slide-up", "zoom"])
        .describe("Transition type"),
      duration: z
        .number()
        .int()
        .min(0)
        .max(10_000)
        .optional()
        .describe("Transition duration in milliseconds (default: 500)"),
    },
    async ({
      presentationId,
      slideIndex,
      type,
      duration,
    }: {
      presentationId: string;
      slideIndex: number;
      type:
        | "none"
        | "fade"
        | "slide-left"
        | "slide-right"
        | "slide-up"
        | "zoom";
      duration?: number;
    }) => {
      try {
        await store.setSlideTransition(presentationId, slideIndex, {
          type,
          duration: duration ?? 500,
        });
        return text("Transition updated");
      } catch (e) {
        return error(String(e));
      }
    },
  );

  // =========================================================================
  // Templates
  // =========================================================================

  server.tool(
    "slide_list_templates",
    "List all available built-in slide templates.",
    {},
    () => json(store.listTemplates()),
  );

  server.tool(
    "slide_create_from_template",
    "Create a new presentation from a built-in template.",
    {
      title: titleSchema.describe("Presentation title"),
      templateId: z.string().trim().min(1).max(80).describe(
        "Template ID (e.g. 'title-slide', 'two-column')",
      ),
    },
    async ({ title, templateId }: { title: string; templateId: string }) => {
      try {
        return json(await store.createFromTemplate(title, templateId));
      } catch (e) {
        return error(String(e));
      }
    },
  );

  server.tool(
    "slide_add_from_template",
    "Add a slide from a built-in template to an existing presentation.",
    {
      presentationId: idSchema.describe("Presentation ID"),
      templateId: z.string().trim().min(1).max(80).describe("Template ID"),
      index: z
        .number()
        .int()
        .min(0)
        .max(MAX_SLIDES)
        .optional()
        .describe("Insert position (0-based). Appended if omitted."),
    },
    async ({
      presentationId,
      templateId,
      index,
    }: {
      presentationId: string;
      templateId: string;
      index?: number;
    }) => {
      try {
        return json(
          await store.addSlideFromTemplate(presentationId, templateId, index),
        );
      } catch (e) {
        return error(String(e));
      }
    },
  );
}
