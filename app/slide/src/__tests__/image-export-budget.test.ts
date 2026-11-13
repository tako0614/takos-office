import { expect, spyOn, test } from "bun:test";
import { createCanvas } from "canvas";
import * as canvasApi from "canvas";
import { jsPDF } from "jspdf";
import { MAX_RASTER_PIXELS } from "../../../shared/lib/office-raster.ts";
import { exportImageInfo } from "../lib/image-metadata.ts";
import { loadImageForExport, loadImagesForExport, MAX_EXPORT_IMAGE_BYTES, parseDataImageUrl } from "../lib/image-loader.ts";
import { exportPresentationToPdf } from "../lib/pdf-exporter.ts";
import { renderSlideToBuffer } from "../lib/server-renderer.ts";
import type { Presentation } from "../types/index.ts";

const png = new Uint8Array(createCanvas(1, 1).toBuffer("image/png"));
const gif = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), char => char.charCodeAt(0));
const webp = Uint8Array.from(atob("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA"), char => char.charCodeAt(0));
const jpeg = new Uint8Array(createCanvas(1, 1).toBuffer("image/jpeg"));
// jsPDF's declarations expose only API.events; its documented plugin methods
// exist at runtime and are spied without changing the production API surface.
const pdfApi = jsPDF.API as unknown as {
  addImage: jsPDF["addImage"];
  processPNG: (...args: unknown[]) => unknown;
  processGIF89A: (...args: unknown[]) => unknown;
};
const bmp = new Uint8Array(58);
bmp.set([66, 77]);
const bitmap = new DataView(bmp.buffer);
bitmap.setUint32(2, 58, true); bitmap.setUint32(10, 54, true); bitmap.setUint32(14, 40, true);
bitmap.setInt32(18, 1, true); bitmap.setInt32(22, 1, true); bitmap.setUint16(26, 1, true); bitmap.setUint16(28, 24, true);
const inline = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
const element = (id: string, imageUrl: string) => ({ id, type: "image" as const, imageUrl, x: 0, y: 0, width: 10, height: 10, rotation: 0 });
const deck = (urls: string[]): Presentation => ({ id: "budget", title: "Budget", createdAt: "now", updatedAt: "now", slides: [{ id: "slide", background: "#fff", elements: urls.map((url, i) => element(String(i), url)) }] });
function pngHeader(width: number, height: number) {
  const bytes = png.slice(); const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}

for (const [mime, bytes, format] of [
  ["image/png", png, "PNG"], ["image/jpeg", jpeg, "JPEG"], ["image/gif", gif, "GIF"],
  ["image/bmp", bmp, "BMP"], ["image/webp", webp, "WEBP"],
] as const) {
  test(`normal ${format} survives header admission and real PDF embedding`, async () => {
    const url = inline(bytes, mime);
    const info = parseDataImageUrl(url);
    expect(info?.format).toBe(format);
    expect([info?.width, info?.height]).toEqual([1, 1]);
    const remote = await loadImageForExport("https://example.com/image", async () => new Response(bytes, { headers: { "content-type": mime } }));
    expect(remote?.format).toBe(format);
    const pdf = await exportPresentationToPdf(deck([url]));
    expect(new TextDecoder("latin1").decode(pdf)).toContain("/Subtype /Image");
  });
}

test("magic and declared MIME must agree for both inline and remote images", async () => {
  expect(parseDataImageUrl(inline(gif, "image/png"))).toBeNull();
  expect(await loadImageForExport("https://example.com/image", async () => new Response(gif, { headers: { "content-type": "image/png" } }))).toBeNull();
  expect(parseDataImageUrl("data:image/png;base64,AAAA")).toBeNull();
});

test("existing remote BMP/JPEG MIME aliases retain their actual formats", async () => {
  for (const [mime, bytes, format] of [["image/x-ms-bmp", bmp, "BMP"], ["image/pjpeg", jpeg, "JPEG"]] as const) {
    const image = await loadImageForExport("https://example.com/image", async () => new Response(bytes, { headers: { "content-type": mime } }));
    expect(image?.format).toBe(format);
  }
});

test("the existing 32M pixel edge is admitted from headers; limit+1 is rejected without allocation", () => {
  expect(parseDataImageUrl(inline(pngHeader(MAX_RASTER_PIXELS, 1), "image/png"))?.width).toBe(MAX_RASTER_PIXELS);
  expect(parseDataImageUrl(inline(pngHeader(MAX_RASTER_PIXELS + 1, 1), "image/png"))).toBeNull();
  expect(parseDataImageUrl(inline(pngHeader(0, 1), "image/png"))).toBeNull();
});

test("GIF frame dimensions cannot conceal an allocation larger than the logical canvas", () => {
  const bytes = gif.slice(); const marker = bytes.indexOf(0x2c, 13);
  new DataView(bytes.buffer).setUint16(marker + 5, 2, true);
  expect(parseDataImageUrl(inline(bytes, "image/gif"))).toBeNull();
});

test("oversized PNG/GIF/BMP/WebP headers reach neither addImage nor its decoder", async () => {
  const badGif = gif.slice(), badBmp = bmp.slice(), badWebp = webp.slice();
  new DataView(badGif.buffer).setUint16(6, 65535, true);
  new DataView(badGif.buffer).setUint16(8, 65535, true);
  new DataView(badBmp.buffer).setInt32(18, MAX_RASTER_PIXELS + 1, true);
  new DataView(badWebp.buffer).setUint16(26, 8192, true);
  new DataView(badWebp.buffer).setUint16(28, 4096, true);
  const add = spyOn(pdfApi, "addImage");
  const decode = spyOn(pdfApi, "processGIF89A").mockImplementation(() => { throw new Error("decoder must not run"); });
  try {
    await exportPresentationToPdf(deck([inline(pngHeader(MAX_RASTER_PIXELS + 1, 1), "image/png"), inline(badGif, "image/gif"), inline(badBmp, "image/bmp"), inline(badWebp, "image/webp")]));
    expect(add).not.toHaveBeenCalled(); expect(decode).not.toHaveBeenCalled();
  } finally { add.mockRestore(); decode.mockRestore(); }
});

test("inline and remote images share aggregate pixel admission before decode", async () => {
  const first = inline(pngHeader(4000, 4000), "image/png");
  const second = "https://example.com/second.png", last = "https://example.com/last.png";
  const images = await loadImagesForExport([element("a", first), element("b", second), element("c", last)], async url => new Response(url === second ? pngHeader(4000, 4000) : png, { headers: { "content-type": "image/png" } }));
  expect([...images.keys()]).toEqual(["a", "b"]);
});

test("distinct image bodies share the existing 5 MiB deck byte budget", async () => {
  // Only encoded padding is allocated; headers stay 1x1 and no decoder runs.
  const padded = (length: number) => {
    const bytes = new Uint8Array(length), end = png.length - 12;
    bytes.set(png.subarray(0, end));
    new DataView(bytes.buffer).setUint32(end, length - png.length - 12);
    bytes.set([110, 112, 65, 68], end + 4); // bounded private ancillary chunk
    bytes.set(png.subarray(end), length - 12);
    return bytes;
  };
  const half = padded(MAX_EXPORT_IMAGE_BYTES / 2);
  const overHalf = padded(half.length + 1);
  const urls = ["https://example.com/a", "https://example.com/b", "https://example.com/c"];
  const images = await loadImagesForExport(urls.map((url, i) => element(String(i), url)), async url => new Response(url === urls[0] ? half : url === urls[1] ? overHalf : png, { headers: { "content-type": "image/png" } }));
  expect([...images.keys()]).toEqual(["0", "2"]);
});

test("65 normal small images remain admitted; requests are sequential and failed URLs are cached", async () => {
  let active = 0, peak = 0, requests = 0;
  const fetchImage = async (url: string) => {
    requests++; active++; peak = Math.max(peak, active);
    await Promise.resolve(); active--;
    return url.endsWith("bad") ? new Response("bad", { status: 404 }) : new Response(png, { headers: { "content-type": "image/png" } });
  };
  const elements = Array.from({ length: 65 }, (_, i) => element(String(i), `https://example.com/${i}`));
  elements.push(element("bad1", "https://example.com/bad"), element("bad2", "https://example.com/bad"), element("duplicate", "https://example.com/0"));
  const images = await loadImagesForExport(elements, fetchImage);
  expect(images.size).toBe(66); expect(requests).toBe(66); expect(peak).toBe(1);
});

test("a 65-image PDF reuses its admitted raster decode and retains all placements", async () => {
  const decode = spyOn(pdfApi, "processPNG");
  const add = spyOn(pdfApi, "addImage");
  try {
    const pdf = await exportPresentationToPdf(deck(Array(65).fill(inline(png, "image/png"))));
    expect(add).toHaveBeenCalledTimes(65); expect(decode).toHaveBeenCalledTimes(1);
    expect(new TextDecoder("latin1").decode(pdf)).toContain("/Subtype /Image");
  } finally { add.mockRestore(); decode.mockRestore(); }
});

test("failed PDF and PNG decoders are not retried for repeated placements", async () => {
  const url = inline(png, "image/png"), presentation = deck([url, url, url]);
  const pdfDecode = spyOn(pdfApi, "processPNG").mockImplementation(() => { throw new Error("bounded decoder failure"); });
  const canvasDecode = spyOn(canvasApi, "loadImage").mockRejectedValue(new Error("bounded decoder failure"));
  try {
    await exportPresentationToPdf(presentation);
    await renderSlideToBuffer(presentation.slides[0], 2, 2);
    expect(pdfDecode).toHaveBeenCalledTimes(1); expect(canvasDecode).toHaveBeenCalledTimes(1);
  } finally { pdfDecode.mockRestore(); canvasDecode.mockRestore(); }
});

test("a streamed body over 5 MiB is cancelled before header admission or decode", async () => {
  let cancelled = false, emitted = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      emitted += 1024;
      controller.enqueue(new Uint8Array(1024));
    },
    cancel() { cancelled = true; },
  });
  const image = await loadImageForExport("https://example.com/large", async () => new Response(body, { headers: { "content-type": "image/png" } }));
  expect(image).toBeNull(); expect(cancelled).toBe(true); expect(emitted).toBeLessThanOrEqual(MAX_EXPORT_IMAGE_BYTES + 2048);
});

test("rejected unfinished response bodies are cancelled and their fetch signal is aborted", async () => {
  for (const [status, mime] of [[404, "image/png"], [200, "image/svg+xml"]] as const) {
    let cancelled = false, signal: AbortSignal | undefined;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const result = await loadImageForExport("https://example.com/rejected", async (_url, init) => {
      signal = init?.signal;
      return new Response(stream, { status, headers: { "content-type": mime } });
    });
    expect(result).toBeNull(); expect(cancelled).toBe(true); expect(signal?.aborted).toBe(true);
  }
});

test("redirect body cleanup precedes the next fetch and success retires the shared signal", async () => {
  let discarded = false, signal: AbortSignal | undefined;
  const stream = new ReadableStream<Uint8Array>({ cancel() { discarded = true; } });
  const image = await loadImageForExport("https://example.com/start", async (url, init) => {
    signal = init?.signal;
    if (url.endsWith("start")) return new Response(stream, { status: 302, headers: { location: "/image" } });
    expect(discarded).toBe(true);
    return new Response(png, { headers: { "content-type": "image/png" } });
  });
  expect(image?.format).toBe("PNG"); expect(signal?.aborted).toBe(true);
});

test("fetch exceptions retire the existing signal without waiting for a body cancellation promise", async () => {
  let signal: AbortSignal | undefined;
  const image = await loadImageForExport("https://example.com/error", async (_url, init) => {
    signal = init?.signal;
    throw new Error("bounded fixture exception");
  });
  expect(image).toBeNull(); expect(signal?.aborted).toBe(true);
  const pendingCancel = new ReadableStream<Uint8Array>({ cancel() { return new Promise(() => {}); } });
  expect(await loadImageForExport("https://example.com/pending-cancel", async () => new Response(pendingCancel, { status: 404 }))).toBeNull();
});

test("WebP RIFF size and compressed-frame dimensions must agree", () => {
  const badLength = webp.slice(); badLength[4] ^= 1;
  expect(() => exportImageInfo(badLength, "image/webp")).toThrow();
  expect(() => exportImageInfo(webp, "image/jpeg")).toThrow();
});

test("duplicate PNG headers and WebP coded chunks never reach addImage", async () => {
  // Both PNG headers are the same harmless 1x1 IHDR, including its valid CRC.
  const duplicatePng = new Uint8Array(png.length + 25);
  duplicatePng.set(png.subarray(0, 33)); duplicatePng.set(png.subarray(8, 33), 33); duplicatePng.set(png.subarray(33), 58);
  const duplicateWebp = new Uint8Array(webp.length * 2 - 12);
  duplicateWebp.set(webp); duplicateWebp.set(webp.subarray(12), webp.length);
  new DataView(duplicateWebp.buffer).setUint32(4, duplicateWebp.length - 8, true);
  const add = spyOn(pdfApi, "addImage");
  try {
    expect(parseDataImageUrl(inline(duplicatePng, "image/png"))).toBeNull();
    expect(parseDataImageUrl(inline(duplicateWebp, "image/webp"))).toBeNull();
    await exportPresentationToPdf(deck([inline(duplicatePng, "image/png"), inline(duplicateWebp, "image/webp")]));
    expect(add).not.toHaveBeenCalled();
  } finally { add.mockRestore(); }
});

test("WebP animation frames admit one coded image and reject duplicate or nested images", async () => {
  const chunk = (kind: string, data: Uint8Array) => {
    const bytes = new Uint8Array(8 + data.length + (data.length & 1));
    bytes.set([...kind].map(char => char.charCodeAt(0)));
    new DataView(bytes.buffer).setUint32(4, data.length, true); bytes.set(data, 8);
    return bytes;
  };
  const extended = new Uint8Array(10); extended[0] = 2; // 1x1 animation canvas
  const animated = (copies: number, nested = false, metadata = false) => {
    const inner = new Uint8Array(16 + webp.length - 12); inner.set(webp.subarray(12), 16);
    const parts = nested ? [chunk("ANMF", inner), webp.subarray(12)] : Array(copies).fill(webp.subarray(12)) as Uint8Array[];
    if (metadata) parts.push(chunk("ZZZZ", new Uint8Array([1, 2])));
    const frame = new Uint8Array(16 + parts.reduce((sum, value) => sum + value.length, 0));
    let position = 16; for (const value of parts) { frame.set(value, position); position += value.length; }
    const chunks = [chunk("VP8X", extended), chunk("ANIM", new Uint8Array(6)), chunk("ANMF", frame)];
    const bytes = new Uint8Array(12 + chunks.reduce((sum, value) => sum + value.length, 0));
    bytes.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
    new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
    let offset = 12; for (const value of chunks) { bytes.set(value, offset); offset += value.length; }
    return bytes;
  };
  expect(parseDataImageUrl(inline(animated(1), "image/webp"))?.width).toBe(1);
  expect(parseDataImageUrl(inline(animated(1, false, true), "image/webp"))?.width).toBe(1);
  expect(parseDataImageUrl(inline(animated(2), "image/webp"))).toBeNull();
  const nested = inline(animated(1, true), "image/webp");
  const add = spyOn(pdfApi, "addImage");
  try {
    expect(parseDataImageUrl(nested)).toBeNull();
    await exportPresentationToPdf(deck([nested]));
    expect(add).not.toHaveBeenCalled();
  } finally { add.mockRestore(); }
});
