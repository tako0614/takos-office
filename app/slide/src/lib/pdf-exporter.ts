/**
 * PDF export for takos-slide presentations using jsPDF.
 *
 * Renders each slide as a landscape page with text elements, shapes, and
 * image placeholders using jsPDF's built-in drawing primitives.
 */

import { jsPDF } from "jspdf";
import type { Presentation, Slide, SlideElement } from "../types/index.ts";
import { loadImagesForExport } from "./image-loader.ts";
import { logicalSlideSize } from "../../../shared/lib/slide-size.ts";

/** Slide-element id -> embeddable image (only successfully loaded ones). */
type PdfImageMap = Map<string, { dataUrl: string; format: string; failed?: boolean }>;

/**
 * Export a full presentation to a PDF document, embedding real images where
 * available (failed loads fall back to a placeholder frame).
 * Returns the raw PDF bytes.
 */
export async function exportPresentationToPdf(
  presentation: Presentation,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const logical = logicalSlideSize(presentation.slideSize);
  // Imported page dimensions are exact EMUs (36,000 per mm). Field-absent
  // decks retain the original 297 mm-wide PDF convention.
  const pageWidth = presentation.slideSize ? presentation.slideSize.widthEmu / 36_000 : 297;
  const pageHeight = presentation.slideSize ? presentation.slideSize.heightEmu / 36_000 : pageWidth * logical.height / logical.width;
  const orientation = pageWidth >= pageHeight ? "landscape" : "portrait";
  const doc = new jsPDF({ orientation, unit: "mm", format: [pageWidth, pageHeight] });

  const scaleX = pageWidth / logical.width;
  const scaleY = pageHeight / logical.height;
  const images = await loadPresentationImages(presentation, signal);

  for (let i = 0; i < presentation.slides.length; i++) {
    signal?.throwIfAborted();
    if (i > 0) doc.addPage([pageWidth, pageHeight], orientation);
    renderSlideToPdf(doc, presentation.slides[i], scaleX, scaleY, images, signal);
  }

  // Get the PDF as ArrayBuffer, then wrap as Uint8Array
  signal?.throwIfAborted();
  const arrayBuf = doc.output("arraybuffer");
  return new Uint8Array(arrayBuf);
}

async function loadPresentationImages(
  presentation: Presentation,
  signal?: AbortSignal,
): Promise<PdfImageMap> {
  return loadImagesForExport(presentation.slides.flatMap((slide) => slide.elements), fetch, signal);
}

// ---------------------------------------------------------------------------
// Slide rendering
// ---------------------------------------------------------------------------

function renderSlideToPdf(
  doc: jsPDF,
  slide: Slide,
  sx: number,
  sy: number,
  images: PdfImageMap,
  signal?: AbortSignal,
): void {
  // Background
  const bg = parseColor(slide.background) ?? { r: 255, g: 255, b: 255 };
  doc.setFillColor(bg.r, bg.g, bg.b);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight(), "F");

  // Elements (render in order so later elements are on top)
  for (const element of slide.elements) {
    signal?.throwIfAborted();
    renderElementToPdf(doc, element, sx, sy, images);
  }
}

function renderElementToPdf(
  doc: jsPDF,
  element: SlideElement,
  sx: number,
  sy: number,
  images: PdfImageMap,
): void {
  switch (element.type) {
    case "text":
      renderTextToPdf(doc, element, sx, sy);
      break;
    case "shape":
      renderShapeToPdf(doc, element, sx, sy);
      break;
    case "image":
      renderImageToPdf(doc, element, sx, sy, images.get(element.id));
      break;
  }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function renderTextToPdf(
  doc: jsPDF,
  el: SlideElement,
  sx: number,
  sy: number,
): void {
  const fontSize = el.fontSize ?? 24;
  const bold = el.bold ?? false;
  const italic = el.italic ?? false;

  let style = "normal";
  if (bold && italic) style = "bolditalic";
  else if (bold) style = "bold";
  else if (italic) style = "italic";

  // jsPDF font size is in points
  const fontSizePt = fontSize * sy * 2.835; // mm -> pt conversion ≈ 2.835
  doc.setFontSize(fontSizePt);
  doc.setFont("helvetica", style);

  const color = parseColor(el.fontColor ?? "#333333") ?? {
    r: 51,
    g: 51,
    b: 51,
  };
  doc.setTextColor(color.r, color.g, color.b);

  const x = el.x * sx;
  const y = el.y * sy;
  const width = el.width * sx;
  const lineHeightMm = fontSize * 1.3 * sy;

  let align: "left" | "center" | "right" = "left";
  if (el.textAlign === "center") align = "center";
  else if (el.textAlign === "right") align = "right";

  let textX = x + 8 * sx;
  if (align === "center") textX = x + width / 2;
  else if (align === "right") textX = x + width - 8 * sx;

  const maxWidth = width - 16 * sx;

  // Flatten explicit line breaks AND word-wrap into one ordered list of visual
  // lines, then advance a single cursor by one line-height per line (mirrors
  // the canvas renderer). The previous code advanced only once per explicit
  // line, so wrapped lines overlapped the following explicit line.
  const visualLines: string[] = [];
  for (const line of (el.text ?? "").split("\n")) {
    const wrapped = doc.splitTextToSize(line, maxWidth) as string[];
    if (wrapped.length === 0) visualLines.push("");
    else visualLines.push(...wrapped);
  }

  const bottom = (el.y + el.height) * sy;
  const baselineOffsetMm = fontSizePt / 2.835; // = fontSize * sy (line top → baseline)
  for (let i = 0; i < visualLines.length; i++) {
    const drawY = y + 8 * sy + baselineOffsetMm + i * lineHeightMm;
    if (drawY > bottom) break;
    if (visualLines[i] !== "") doc.text(visualLines[i], textX, drawY, { align });
  }
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

function renderShapeToPdf(
  doc: jsPDF,
  el: SlideElement,
  sx: number,
  sy: number,
): void {
  const fill = parseColor(el.fillColor ?? "#4f87e0") ?? {
    r: 79,
    g: 135,
    b: 224,
  };
  const stroke = parseColor(el.strokeColor ?? "#2563eb") ?? {
    r: 37,
    g: 99,
    b: 235,
  };
  const strokeWidth = (el.strokeWidth ?? 2) * sx;

  doc.setFillColor(fill.r, fill.g, fill.b);
  doc.setDrawColor(stroke.r, stroke.g, stroke.b);
  doc.setLineWidth(strokeWidth);

  const x = el.x * sx;
  const y = el.y * sy;
  const w = el.width * sx;
  const h = el.height * sy;

  const drawStyle = strokeWidth > 0 ? "FD" : "F";

  switch (el.shapeType) {
    case "rect":
      doc.rect(x, y, w, h, drawStyle);
      break;

    case "ellipse":
      doc.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, drawStyle);
      break;

    case "triangle":
      doc.triangle(
        x + w / 2,
        y,
        x + w,
        y + h,
        x,
        y + h,
        drawStyle,
      );
      break;

    case "arrow": {
      // Simplified arrow as a polygon
      const midY = y + h / 2;
      const shaftTop = y + h * 0.3;
      const shaftBottom = y + h * 0.7;
      const headStart = x + w * 0.6;

      const points = [
        x,
        shaftTop,
        headStart,
        shaftTop,
        headStart,
        y,
        x + w,
        midY,
        headStart,
        y + h,
        headStart,
        shaftBottom,
        x,
        shaftBottom,
      ];

      // Use lines to draw the polygon
      doc.setFillColor(fill.r, fill.g, fill.b);
      drawPolygon(doc, points, drawStyle);
      break;
    }

    default:
      doc.rect(x, y, w, h, drawStyle);
  }
}

function drawPolygon(doc: jsPDF, points: number[], style: string): void {
  if (points.length < 4) return;

  // Build an array of coordinate pairs for jsPDF lines method
  const lines: [number, number][] = [];
  for (let i = 2; i < points.length; i += 2) {
    lines.push([points[i] - points[i - 2], points[i + 1] - points[i - 1]]);
  }

  doc.lines(lines, points[0], points[1], [1, 1], style, true);
}

// ---------------------------------------------------------------------------
// Image placeholder
// ---------------------------------------------------------------------------

function renderImageToPdf(
  doc: jsPDF,
  el: SlideElement,
  sx: number,
  sy: number,
  image?: { dataUrl: string; format: string; failed?: boolean },
): void {
  const x = el.x * sx;
  const y = el.y * sy;
  const w = el.width * sx;
  const h = el.height * sy;

  if (image && !image.failed) {
    try {
      doc.addImage(image.dataUrl, image.format, x, y, w, h);
      return;
    } catch {
      // Repeated placements share this admitted image; never retry a failed
      // decoder for each copy of the same URL in the same export.
      image.failed = true;
      // fall through to the placeholder on decode/embed failure
    }
  }

  doc.setFillColor(55, 65, 81);
  doc.rect(x, y, w, h, "F");
  doc.setDrawColor(107, 114, 128);
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, h, "S");

  doc.setFontSize(10);
  doc.setTextColor(156, 163, 175);
  doc.setFont("helvetica", "normal");
  const label = el.imageUrl ? "Image" : "No image";
  doc.text(label, x + w / 2, y + h / 2, { align: "center" });
}

// ---------------------------------------------------------------------------
// Colour helper
// ---------------------------------------------------------------------------

function parseColor(color: string): { r: number; g: number; b: number } | null {
  // Handle hex colours (#rgb, #rrggbb)
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

  // Handle rgb(r, g, b)
  const rgbMatch = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return {
      r: Number(rgbMatch[1]),
      g: Number(rgbMatch[2]),
      b: Number(rgbMatch[3]),
    };
  }

  // Fallback for named colours or gradients: return white
  return null;
}
