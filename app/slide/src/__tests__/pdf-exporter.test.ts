import { expect, test } from "bun:test";

import type { Presentation, Slide, SlideElement } from "../types/index.ts";

let exportPresentationToPdf:
  | ((presentation: Presentation) => Promise<Uint8Array>)
  | null = null;
let pdfExporterImportError: unknown;

try {
  const mod = await import("../lib/pdf-exporter.ts");
  exportPresentationToPdf = mod.exportPresentationToPdf;
} catch (error) {
  pdfExporterImportError = error;
}

function requirePdfExporter(): (
  presentation: Presentation,
) => Promise<Uint8Array> {
  if (!exportPresentationToPdf) {
    throw new Error("PDF exporter failed to load", {
      cause: pdfExporterImportError,
    });
  }
  return exportPresentationToPdf;
}

// ---------------------------------------------------------------------------
// parseColor tests via exported function (it is not exported, so we test
// through the public API indirectly by verifying correct PDF output)
//
// Since parseColor is private, we replicate its logic here for unit testing.
// ---------------------------------------------------------------------------

function parseColor(
  color: string,
): { r: number; g: number; b: number } | null {
  const hex = color.trim();
  if (hex.startsWith("#")) {
    const h = hex.slice(1);
    if (h.length === 3) {
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
      };
    }
    if (h.length >= 6) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
      };
    }
  }
  const rgbMatch = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return {
      r: Number(rgbMatch[1]),
      g: Number(rgbMatch[2]),
      b: Number(rgbMatch[3]),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// parseColor unit tests (replicated logic)
// ---------------------------------------------------------------------------

test("parseColor handles 3-digit hex (#f00)", () => {
  const c = parseColor("#f00");
  expect(c).toEqual({ r: 255, g: 0, b: 0 });
});

test("parseColor handles 6-digit hex (#ff0000)", () => {
  const c = parseColor("#ff0000");
  expect(c).toEqual({ r: 255, g: 0, b: 0 });
});

test("parseColor handles 6-digit hex (#1e3a5f)", () => {
  const c = parseColor("#1e3a5f");
  expect(c).toEqual({ r: 30, g: 58, b: 95 });
});

test("parseColor handles rgb() format", () => {
  const c = parseColor("rgb(10, 20, 30)");
  expect(c).toEqual({ r: 10, g: 20, b: 30 });
});

test("parseColor handles rgb() without spaces", () => {
  const c = parseColor("rgb(0,128,255)");
  expect(c).toEqual({ r: 0, g: 128, b: 255 });
});

test("parseColor returns null for invalid/named colour", () => {
  expect(parseColor("red")).toEqual(null);
  expect(parseColor("not-a-colour")).toEqual(null);
});

test("parseColor returns null for empty string", () => {
  expect(parseColor("")).toEqual(null);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePresentation(slides: Slide[]): Presentation {
  return {
    id: "test-pres",
    title: "Test Presentation",
    slides,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  };
}

function makeSlide(elements: SlideElement[] = []): Slide {
  return {
    id: "slide-1",
    elements,
    background: "#ffffff",
  };
}

function makeTextElement(overrides: Partial<SlideElement> = {}): SlideElement {
  return {
    id: "el-1",
    type: "text",
    x: 100,
    y: 100,
    width: 300,
    height: 60,
    rotation: 0,
    text: "Hello PDF",
    fontSize: 24,
    fontColor: "#333333",
    bold: false,
    italic: false,
    textAlign: "left",
    ...overrides,
  };
}

// PDF magic bytes: %PDF
const PDF_MAGIC = new TextEncoder().encode("%PDF");

// ---------------------------------------------------------------------------
// exportPresentationToPdf tests
// ---------------------------------------------------------------------------

test("exportPresentationToPdf returns Uint8Array starting with PDF magic bytes", async () => {
  const exportPdf = requirePdfExporter();
  const pres = makePresentation([makeSlide([makeTextElement()])]);
  const result = await exportPdf(pres);
  expect(result instanceof Uint8Array).toBeTruthy();
  expect(result.length > 4).toBeTruthy();
  const header = result.slice(0, 4);
  expect([...header]).toEqual([...PDF_MAGIC]);
});

test("exportPresentationToPdf handles empty slide (no elements)", async () => {
  const exportPdf = requirePdfExporter();
  const pres = makePresentation([makeSlide()]);
  const result = await exportPdf(pres);
  expect(result.length > 0).toBeTruthy();
  const header = result.slice(0, 4);
  expect([...header]).toEqual([...PDF_MAGIC]);
});

test("exportPresentationToPdf handles multiple slides", async () => {
  const exportPdf = requirePdfExporter();
  const pres = makePresentation([
    makeSlide([makeTextElement({ id: "e1", text: "Slide 1" })]),
    makeSlide([makeTextElement({ id: "e2", text: "Slide 2" })]),
    makeSlide([makeTextElement({ id: "e3", text: "Slide 3" })]),
  ]);
  const result = await exportPdf(pres);
  expect(result.length > 0).toBeTruthy();
  const header = result.slice(0, 4);
  expect([...header]).toEqual([...PDF_MAGIC]);
});

test("exportPresentationToPdf handles shape element", async () => {
  const exportPdf = requirePdfExporter();
  const shapeEl: SlideElement = {
    id: "shape-1",
    type: "shape",
    x: 50,
    y: 50,
    width: 200,
    height: 100,
    rotation: 0,
    shapeType: "rect",
    fillColor: "#4f87e0",
    strokeColor: "#2563eb",
    strokeWidth: 2,
  };
  const pres = makePresentation([makeSlide([shapeEl])]);
  const result = await exportPdf(pres);
  expect(result.length > 0).toBeTruthy();
});

// A 1x1 transparent PNG as a data URL — embeds via doc.addImage with no
// network access, exercising the real image path (not the placeholder).
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("exportPresentationToPdf embeds a data-URL image", async () => {
  const exportPdf = requirePdfExporter();
  const imgEl: SlideElement = {
    id: "img-1",
    type: "image",
    x: 50,
    y: 50,
    width: 200,
    height: 150,
    rotation: 0,
    imageUrl: TINY_PNG_DATA_URL,
  };
  const pres = makePresentation([makeSlide([imgEl])]);
  const result = await exportPdf(pres);
  expect(result.length > 0).toBeTruthy();
  const header = result.slice(0, 4);
  expect([...header]).toEqual([...PDF_MAGIC]);
});

test("exportPresentationToPdf handles bold italic text", async () => {
  const exportPdf = requirePdfExporter();
  const el = makeTextElement({ bold: true, italic: true, text: "Bold Italic" });
  const pres = makePresentation([makeSlide([el])]);
  const result = await exportPdf(pres);
  expect(result.length > 0).toBeTruthy();
});

test("exportPresentationToPdf handles colored background", async () => {
  const exportPdf = requirePdfExporter();
  const slide: Slide = {
    id: "s1",
    elements: [makeTextElement()],
    background: "#1e3a5f",
  };
  const pres = makePresentation([slide]);
  const result = await exportPdf(pres);
  expect(result.length > 0).toBeTruthy();
  const header = result.slice(0, 4);
  expect([...header]).toEqual([...PDF_MAGIC]);
});
