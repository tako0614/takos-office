import { expect, test } from "bun:test";
import { createCanvas, Image } from "canvas";
import { observeSlideImages, renderThumbnail } from "../lib/canvas-renderer.ts";
import type { Slide } from "../types/index.ts";

// Node Canvas performs the real PNG decode and draw. Defer its src assignment
// to reproduce the browser's asynchronous image-ready event at this seam.
async function withBrowserImages(run: () => Promise<void>): Promise<void> {
  const saved = ["document", "Image"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  class DeferredImage extends Image {
    constructor() {
      super();
      const source = Object.getOwnPropertyDescriptor(Image.prototype, "src")!;
      let generation = 0;
      Object.defineProperty(this, "src", {
        get: () => source.get!.call(this),
        set: (value: string | Buffer) => {
          const pending = ++generation;
          if (!value) return;
          queueMicrotask(() => { if (pending === generation) source.set!.call(this, value); });
        },
      });
    }
  }
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => createCanvas(1, 1) } });
  Object.defineProperty(globalThis, "Image", { configurable: true, value: DeferredImage });
  try { await run(); }
  finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

function slide(color: string): Slide {
  const png = createCanvas(2, 2), context = png.getContext("2d");
  context.fillStyle = color;
  context.fillRect(0, 0, 2, 2);
  return { id: color, background: "#ffffff", elements: [{ id: "picture", type: "image", x: 0, y: 0, width: 960, height: 540, rotation: 0, imageUrl: png.toDataURL() }] };
}

test("an image-ready event repaints a live thumbnail without another interaction", () => withBrowserImages(async () => {
  const current = slide("#ff0000");
  let thumbnail: HTMLCanvasElement, repaints = 0;
  const redraw = () => { repaints++; thumbnail = renderThumbnail(current); };
  const owner = observeSlideImages(redraw);
  try {
    owner.update([current]);
    thumbnail = renderThumbnail(current);
    expect([...thumbnail.getContext("2d")!.getImageData(20, 20, 1, 1).data]).toEqual([55, 65, 81, 255]);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(repaints).toBe(1);
    expect([...thumbnail.getContext("2d")!.getImageData(20, 20, 1, 1).data]).toEqual([255, 0, 0, 255]);
  } finally { owner.close(); }
}));

test("retired owners cannot receive old decodes and another live owner keeps its shared image", () => withBrowserImages(async () => {
  const current = slide("#00ff00");
  let retiredRepaints = 0, liveRepaints = 0;
  const retired = observeSlideImages(() => retiredRepaints++);
  const live = observeSlideImages(() => liveRepaints++);
  try {
    retired.update([current]); live.update([current]);
    renderThumbnail(current);
    retired.close(); retired.close();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect([retiredRepaints, liveRepaints]).toEqual([0, 1]);
    expect([...renderThumbnail(current).getContext("2d")!.getImageData(20, 20, 1, 1).data]).toEqual([0, 255, 0, 255]);
    live.update([]);
    // Reopening after the last reference retires starts a fresh decode.
    live.update([current]);
    expect([...renderThumbnail(current).getContext("2d")!.getImageData(20, 20, 1, 1).data]).toEqual([55, 65, 81, 255]);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(liveRepaints).toBe(2);
  } finally { retired.close(); live.close(); }
}));

test("switching decks before decode cancels the old image instead of repainting the new deck", () => withBrowserImages(async () => {
  const old = slide("#0000ff"), current = slide("#ff00ff");
  let repaints = 0;
  const owner = observeSlideImages(() => repaints++);
  try {
    owner.update([old]); renderThumbnail(old);
    owner.update([current]); renderThumbnail(current);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(repaints).toBe(1);
    expect([...renderThumbnail(current).getContext("2d")!.getImageData(20, 20, 1, 1).data]).toEqual([255, 0, 255, 255]);
  } finally { owner.close(); }
}));
