/**
 * PDF export for takos-slide presentations using jsPDF.
 *
 * Renders each slide as a landscape page with text elements, shapes, and
 * image placeholders using jsPDF's built-in drawing primitives.
 */

import { jsPDF } from "jspdf";
import type { Presentation, Slide, SlideElement } from "../types/index.ts";

/** The canonical slide coordinate space. */
const SLIDE_WIDTH = 960;
const SLIDE_HEIGHT = 540;

/** PDF page dimensions in mm (landscape, matching 16:9 ratio). */
const PAGE_W = 297; // A4 landscape width
const PAGE_H = PAGE_W * (SLIDE_HEIGHT / SLIDE_WIDTH); // ~167mm

/**
 * Export a full presentation to a PDF document.
 * Returns the raw PDF bytes.
 */
export function exportPresentationToPdf(
  presentation: Presentation,
): Uint8Array {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: [PAGE_W, PAGE_H],
  });

  const scaleX = PAGE_W / SLIDE_WIDTH;
  const scaleY = PAGE_H / SLIDE_HEIGHT;

  for (let i = 0; i < presentation.slides.length; i++) {
    if (i > 0) doc.addPage([PAGE_W, PAGE_H], "landscape");
    renderSlideToPdf(doc, presentation.slides[i], scaleX, scaleY);
  }

  // Get the PDF as ArrayBuffer, then wrap as Uint8Array
  const arrayBuf = doc.output("arraybuffer");
  return new Uint8Array(arrayBuf);
}

// ---------------------------------------------------------------------------
// Slide rendering
// ---------------------------------------------------------------------------

function renderSlideToPdf(
  doc: jsPDF,
  slide: Slide,
  sx: number,
  sy: number,
): void {
  // Background
  const bg = parseColor(slide.background) ?? { r: 255, g: 255, b: 255 };
  doc.setFillColor(bg.r, bg.g, bg.b);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");

  // Elements (render in order so later elements are on top)
  for (const element of slide.elements) {
    renderElementToPdf(doc, element, sx, sy);
  }
}

function renderElementToPdf(
  doc: jsPDF,
  element: SlideElement,
  sx: number,
  sy: number,
): void {
  switch (element.type) {
    case "text":
      renderTextToPdf(doc, element, sx, sy);
      break;
    case "shape":
      renderShapeToPdf(doc, element, sx, sy);
      break;
    case "image":
      renderImagePlaceholderToPdf(doc, element, sx, sy);
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

  const text = el.text ?? "";
  const lines = text.split("\n");

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

  for (let i = 0; i < lines.length; i++) {
    const lineY = y + 8 * sy + i * lineHeightMm + fontSizePt / 2.835;
    if (lineY > (el.y + el.height) * sy) break;

    const splitLines = doc.splitTextToSize(lines[i], maxWidth);
    for (let j = 0; j < splitLines.length; j++) {
      const drawY = lineY + j * lineHeightMm;
      if (drawY > (el.y + el.height) * sy) break;
      doc.text(splitLines[j], textX, drawY, { align });
    }
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

function renderImagePlaceholderToPdf(
  doc: jsPDF,
  el: SlideElement,
  sx: number,
  sy: number,
): void {
  const x = el.x * sx;
  const y = el.y * sy;
  const w = el.width * sx;
  const h = el.height * sy;

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
