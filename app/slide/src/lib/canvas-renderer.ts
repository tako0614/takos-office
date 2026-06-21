import type { Slide, SlideElement } from "../types/index.ts";

const SLIDE_ASPECT = 16 / 9;

/**
 * Module-level cache of decoded images keyed by their source URL.
 *
 * The renderer is synchronous: `renderSlide` / `renderThumbnail` run the full
 * draw pass and return immediately, with each element drawn inside its own
 * `save()` / `restore()` transform scope. Drawing an image from inside an
 * async `img.onload` callback would fire AFTER that scope (and the outer
 * scale) has already been restored, landing the image at the wrong
 * position/scale. To draw every image under its intended transform we must
 * have the decoded bitmap available synchronously during the draw pass, so we
 * cache decoded images here.
 *
 * A `loading` entry records an in-flight decode so we never start a second
 * load for the same URL while one is pending.
 */
type CachedImage =
  | { status: "loading"; promise: Promise<void> }
  | { status: "ready"; image: HTMLImageElement }
  | { status: "error" };

const imageCache = new Map<string, CachedImage>();

/**
 * Listeners notified whenever a previously-unloaded image finishes decoding,
 * so synchronous consumers (editor canvas, thumbnails, present view) can
 * schedule a re-render that will now draw the image from cache under the
 * correct transform.
 */
const loadListeners = new Set<() => void>();

/**
 * Subscribe to image-load notifications. Returns an unsubscribe function.
 *
 * A consumer that renders synchronously (e.g. via `renderSlide` /
 * `renderThumbnail`) can register here and re-run its draw when an image that
 * was not yet decoded becomes available.
 */
export function onImageLoad(listener: () => void): () => void {
  loadListeners.add(listener);
  return () => loadListeners.delete(listener);
}

function notifyImageLoaded(): void {
  for (const listener of loadListeners) {
    try {
      listener();
    } catch {
      // A misbehaving listener must not prevent the others from running.
    }
  }
}

/**
 * Begin decoding an image for `url`, populating the cache and notifying
 * listeners on completion. Returns a promise that resolves once the decode
 * settles (success or failure). Repeated calls for the same URL share the
 * same in-flight load.
 */
function loadImage(url: string): Promise<void> {
  const existing = imageCache.get(url);
  if (existing) {
    if (existing.status === "loading") return existing.promise;
    return Promise.resolve();
  }

  const img = new Image();
  img.crossOrigin = "anonymous";

  const promise = new Promise<void>((resolve) => {
    img.onload = () => {
      imageCache.set(url, { status: "ready", image: img });
      notifyImageLoaded();
      resolve();
    };
    img.onerror = () => {
      imageCache.set(url, { status: "error" });
      resolve();
    };
  });

  imageCache.set(url, { status: "loading", promise });
  img.src = url;
  return promise;
}

/**
 * Pre-load every image referenced by a slide before a synchronous draw pass.
 *
 * Awaiting this guarantees that a subsequent `renderSlide` / `renderThumbnail`
 * call draws each image from cache, inside the element's active transform
 * scope. Consumers that cannot await (e.g. the synchronous thumbnail path) can
 * instead subscribe via `onImageLoad` and re-render once loads settle.
 */
export async function preloadSlideImages(slide: Slide): Promise<void> {
  const urls = new Set<string>();
  for (const element of slide.elements) {
    if (element.type === "image" && element.imageUrl) {
      urls.add(element.imageUrl);
    }
  }
  await Promise.all([...urls].map((url) => loadImage(url)));
}

/**
 * Render a full slide onto a canvas context.
 */
export function renderSlide(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  width: number,
  height: number,
  options?: {
    selectedElementId?: string | null;
    showHandles?: boolean;
    scale?: number;
  },
): void {
  const scale = options?.scale ?? 1;
  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // Background
  ctx.fillStyle = slide.background;
  ctx.fillRect(0, 0, width, height);

  // Scale to fit
  ctx.scale(scale, scale);

  // Render each element
  for (const element of slide.elements) {
    renderElement(ctx, element);
  }

  // Selection indicator
  if (options?.selectedElementId && options.showHandles) {
    const selected = slide.elements.find(
      (e) => e.id === options.selectedElementId,
    );
    if (selected) {
      drawSelectionHandles(ctx, selected);
    }
  }

  ctx.restore();
}

/**
 * Render an individual element.
 */
export function renderElement(
  ctx: CanvasRenderingContext2D,
  element: SlideElement,
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
    case "image":
      renderImageElement(ctx, element);
      break;
  }

  ctx.restore();
}

function renderTextElement(
  ctx: CanvasRenderingContext2D,
  element: SlideElement,
): void {
  const fontSize = element.fontSize ?? 24;
  const fontFamily = element.fontFamily ?? "Inter, sans-serif";
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
  ctx: CanvasRenderingContext2D,
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
  ctx: CanvasRenderingContext2D,
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
      ctx.roundRect(
        element.x,
        element.y,
        element.width,
        element.height,
        4,
      );
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
      // Shaft
      ctx.moveTo(element.x, shaftTop);
      ctx.lineTo(headStart, shaftTop);
      // Arrow head
      ctx.lineTo(headStart, element.y);
      ctx.lineTo(element.x + element.width, midY);
      ctx.lineTo(headStart, element.y + element.height);
      ctx.lineTo(headStart, shaftBottom);
      // Back along bottom
      ctx.lineTo(element.x, shaftBottom);
      ctx.closePath();
      ctx.fill();
      if (strokeWidth > 0) ctx.stroke();
      break;
    }

    default:
      // Fallback rectangle
      ctx.fillRect(element.x, element.y, element.width, element.height);
      if (strokeWidth > 0) {
        ctx.strokeRect(element.x, element.y, element.width, element.height);
      }
  }
}

function renderImageElement(
  ctx: CanvasRenderingContext2D,
  element: SlideElement,
): void {
  // If we already have the decoded bitmap, draw it synchronously here, while
  // this element's transform scope (rotation + outer scale) is still active.
  if (element.imageUrl) {
    const cached = imageCache.get(element.imageUrl);
    if (cached?.status === "ready") {
      ctx.drawImage(
        cached.image,
        element.x,
        element.y,
        element.width,
        element.height,
      );
      return;
    }

    // Not decoded yet: kick off a background load. When it settles, listeners
    // are notified so the consumer can re-render and draw from cache under the
    // correct transform. We never draw from inside the onload callback, since
    // that fires after this transform scope has been restored.
    if (cached?.status !== "error") {
      loadImage(element.imageUrl);
    }
  }

  // Placeholder frame shown until the image is available (or on load failure).
  ctx.fillStyle = "#374151";
  ctx.fillRect(element.x, element.y, element.width, element.height);
  ctx.strokeStyle = "#6b7280";
  ctx.lineWidth = 2;
  ctx.strokeRect(element.x, element.y, element.width, element.height);

  // Image icon placeholder
  ctx.fillStyle = "#9ca3af";
  ctx.font = "14px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    "Image",
    element.x + element.width / 2,
    element.y + element.height / 2,
  );
}

function drawSelectionHandles(
  ctx: CanvasRenderingContext2D,
  element: SlideElement,
): void {
  const { x, y, width, height } = element;
  const handleSize = 8;

  // Selection border
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeRect(x - 1, y - 1, width + 2, height + 2);

  // Corner handles
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 2;

  const handles = [
    { hx: x, hy: y },
    { hx: x + width, hy: y },
    { hx: x, hy: y + height },
    { hx: x + width, hy: y + height },
    // Edge midpoints
    { hx: x + width / 2, hy: y },
    { hx: x + width / 2, hy: y + height },
    { hx: x, hy: y + height / 2 },
    { hx: x + width, hy: y + height / 2 },
  ];

  for (const h of handles) {
    ctx.fillRect(
      h.hx - handleSize / 2,
      h.hy - handleSize / 2,
      handleSize,
      handleSize,
    );
    ctx.strokeRect(
      h.hx - handleSize / 2,
      h.hy - handleSize / 2,
      handleSize,
      handleSize,
    );
  }
}

/**
 * Generate a thumbnail canvas for a slide.
 */
export function renderThumbnail(
  slide: Slide,
  thumbWidth = 192,
): HTMLCanvasElement {
  const thumbHeight = thumbWidth / SLIDE_ASPECT;
  const canvas = document.createElement("canvas");
  canvas.width = thumbWidth;
  canvas.height = thumbHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // The slide coordinates are in a 960x540 space
  const scaleX = thumbWidth / 960;
  const scaleY = thumbHeight / 540;

  ctx.save();
  ctx.clearRect(0, 0, thumbWidth, thumbHeight);
  ctx.fillStyle = slide.background;
  ctx.fillRect(0, 0, thumbWidth, thumbHeight);
  ctx.scale(scaleX, scaleY);

  for (const element of slide.elements) {
    renderElement(ctx, element);
  }

  ctx.restore();
  return canvas;
}

/**
 * Hit-test: find which element is at (px, py) in slide coordinates.
 * Returns the top-most element or null.
 */
export function hitTestElements(
  elements: SlideElement[],
  px: number,
  py: number,
): SlideElement | null {
  // Iterate in reverse (top-most first)
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (
      px >= el.x &&
      px <= el.x + el.width &&
      py >= el.y &&
      py <= el.y + el.height
    ) {
      return el;
    }
  }
  return null;
}

/**
 * Determine which resize handle is at the given position.
 * Returns handle id or null.
 */
export type ResizeHandle =
  | "nw"
  | "ne"
  | "sw"
  | "se"
  | "n"
  | "s"
  | "w"
  | "e";

export function hitTestHandles(
  element: SlideElement,
  px: number,
  py: number,
  handleSize = 10,
): ResizeHandle | null {
  const { x, y, width, height } = element;
  const hs = handleSize;

  const handles: { id: ResizeHandle; hx: number; hy: number }[] = [
    { id: "nw", hx: x, hy: y },
    { id: "ne", hx: x + width, hy: y },
    { id: "sw", hx: x, hy: y + height },
    { id: "se", hx: x + width, hy: y + height },
    { id: "n", hx: x + width / 2, hy: y },
    { id: "s", hx: x + width / 2, hy: y + height },
    { id: "w", hx: x, hy: y + height / 2 },
    { id: "e", hx: x + width, hy: y + height / 2 },
  ];

  for (const h of handles) {
    if (
      px >= h.hx - hs / 2 &&
      px <= h.hx + hs / 2 &&
      py >= h.hy - hs / 2 &&
      py <= h.hy + hs / 2
    ) {
      return h.id;
    }
  }
  return null;
}
