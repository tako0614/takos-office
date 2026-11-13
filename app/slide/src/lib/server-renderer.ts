/**
 * Server-side slide renderer using node-canvas (npm:canvas).
 *
 * Re-uses the same rendering logic as canvas-renderer.ts but provides
 * a node-canvas backed implementation so it works without browser APIs.
 */

import { createCanvas, type Image, loadImage } from "canvas";
import type { Slide, SlideElement } from "../types/index.ts";
import { loadImagesForExport } from "./image-loader.ts";
import { logicalSlideSize, type SlideSize } from "../../../shared/lib/slide-size.ts";


/** A map of slide-element id -> decoded image (only successfully loaded ones). */
type ImageMap = Map<string, Image>;

/**
 * Pre-fetch and decode every image element on the slide. Failed loads are
 * simply omitted, so the renderer falls back to a placeholder for them.
 */
async function loadSlideImages(slide: Slide, signal?: AbortSignal): Promise<ImageMap> {
  const map: ImageMap = new Map();
  const loaded = await loadImagesForExport(slide.elements, fetch, signal);
  const decoded = new Map<string, Image | null>();
  for (const [id, image] of loaded) {
    signal?.throwIfAborted();
    try {
      let value = decoded.get(image.dataUrl);
      if (value === undefined) {
        value = await loadImage(image.dataUrl);
        signal?.throwIfAborted();
        decoded.set(image.dataUrl, value);
      }
      if (value) map.set(id, value);
    } catch {
      signal?.throwIfAborted();
      decoded.set(image.dataUrl, null); /* leave unset -> placeholder */
    }
  }
  return map;
}

/**
 * Render a slide to a PNG buffer, embedding real images where available.
 */
export async function renderSlideToBuffer(
  slide: Slide,
  width = 1280,
  height = 720,
  slideSize?: SlideSize,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const logical = logicalSlideSize(slideSize);
  const fit = Math.min(width / logical.width, height / logical.height);
  // Existing field-absent callers retain their rectangle convention. Imported
  // physical pages fit the requested output without stretching their content.
  const scaleX = slideSize ? fit : width / logical.width;
  const scaleY = slideSize ? fit : height / logical.height;
  const offsetX = slideSize ? (width - logical.width * fit) / 2 : 0;
  const offsetY = slideSize ? (height - logical.height * fit) / 2 : 0;
  const images = await loadSlideImages(slide, signal);
  signal?.throwIfAborted();

  // Background
  ctx.fillStyle = slide.background;
  ctx.fillRect(offsetX, offsetY, logical.width * scaleX, logical.height * scaleY);

  // Scale to fit
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scaleX, scaleY);

  for (const element of slide.elements) {
    signal?.throwIfAborted();
    renderElement(ctx, element, images);
  }

  ctx.restore();
  signal?.throwIfAborted();
  return canvas.toBuffer("image/png");
}

// ---------------------------------------------------------------------------
// Element rendering (mirrors canvas-renderer.ts logic)
// ---------------------------------------------------------------------------

function renderElement(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  element: SlideElement,
  images: ImageMap,
): void {
  ctx.save();

  // Apply rotation
  if (element.rotation !== 0) {
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate((element.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  switch (element.type) {
    case "text":
      renderTextElement(ctx, element);
      break;
    case "shape":
      renderShapeElement(ctx, element);
      break;
    case "image": {
      const img = images.get(element.id);
      if (img) {
        ctx.drawImage(img, element.x, element.y, element.width, element.height);
      } else {
        renderImagePlaceholder(ctx, element);
      }
      break;
    }
  }

  ctx.restore();
}

function renderTextElement(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  element: SlideElement,
): void {
  const fontSize = element.fontSize ?? 24;
  const fontFamily = "sans-serif";
  const bold = element.bold ? "bold " : "";
  const italic = element.italic ? "italic " : "";

  ctx.font = `${italic}${bold}${fontSize}px ${fontFamily}`;
  ctx.fillStyle = element.fontColor ?? "#333333";
  ctx.textBaseline = "top";

  const align = element.textAlign ?? "left";
  ctx.textAlign = align;

  const text = element.text ?? "";
  const lines = wrapText(ctx, text, element.width - 16);
  const lineHeight = fontSize * 1.3;

  let textX = element.x + 8;
  if (align === "center") {
    textX = element.x + element.width / 2;
  } else if (align === "right") {
    textX = element.x + element.width - 8;
  }

  for (let i = 0; i < lines.length; i++) {
    const y = element.y + 8 + i * lineHeight;
    if (y + lineHeight > element.y + element.height) break;
    ctx.fillText(lines[i], textX, y);
  }
}

function wrapText(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  text: string,
  maxWidth: number,
): string[] {
  if (maxWidth <= 0) return [text];
  const paragraphs = text.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(" ");
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);
  }

  return lines;
}

function renderShapeElement(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  element: SlideElement,
): void {
  const fillColor = element.fillColor ?? "#4f87e0";
  const strokeColor = element.strokeColor ?? "#2563eb";
  const strokeWidth = element.strokeWidth ?? 2;

  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;

  switch (element.shapeType) {
    case "rect":
      ctx.beginPath();
      ctx.rect(element.x, element.y, element.width, element.height);
      ctx.fill();
      if (strokeWidth > 0) ctx.stroke();
      break;

    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(
        element.x + element.width / 2,
        element.y + element.height / 2,
        element.width / 2,
        element.height / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      if (strokeWidth > 0) ctx.stroke();
      break;

    case "triangle":
      ctx.beginPath();
      ctx.moveTo(element.x + element.width / 2, element.y);
      ctx.lineTo(element.x + element.width, element.y + element.height);
      ctx.lineTo(element.x, element.y + element.height);
      ctx.closePath();
      ctx.fill();
      if (strokeWidth > 0) ctx.stroke();
      break;

    case "arrow": {
      const midY = element.y + element.height / 2;
      const shaftTop = element.y + element.height * 0.3;
      const shaftBottom = element.y + element.height * 0.7;
      const headStart = element.x + element.width * 0.6;

      ctx.beginPath();
      ctx.moveTo(element.x, shaftTop);
      ctx.lineTo(headStart, shaftTop);
      ctx.lineTo(headStart, element.y);
      ctx.lineTo(element.x + element.width, midY);
      ctx.lineTo(headStart, element.y + element.height);
      ctx.lineTo(headStart, shaftBottom);
      ctx.lineTo(element.x, shaftBottom);
      ctx.closePath();
      ctx.fill();
      if (strokeWidth > 0) ctx.stroke();
      break;
    }

    default:
      ctx.fillRect(element.x, element.y, element.width, element.height);
      if (strokeWidth > 0) {
        ctx.strokeRect(element.x, element.y, element.width, element.height);
      }
  }
}

function renderImagePlaceholder(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  element: SlideElement,
): void {
  // Draw a placeholder frame (server-side cannot load external images synchronously)
  ctx.fillStyle = "#374151";
  ctx.fillRect(element.x, element.y, element.width, element.height);
  ctx.strokeStyle = "#6b7280";
  ctx.lineWidth = 2;
  ctx.strokeRect(element.x, element.y, element.width, element.height);

  // Icon text
  ctx.fillStyle = "#9ca3af";
  ctx.font = "14px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const label = element.imageUrl ? "Image" : "No image";
  ctx.fillText(
    label,
    element.x + element.width / 2,
    element.y + element.height / 2,
  );
}
