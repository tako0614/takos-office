import { MAX_RASTER_PIXELS, rasterInfo } from "../../../shared/lib/office-raster.ts";

type Dimensions = { width: number; height: number };
const text = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end));

/** Header inspection only: never invoke an image decoder to obtain its size. */
export function exportImageInfo(bytes: Uint8Array, mime: string) {
  const aliases: Record<string, string> = {
    "image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg", "image/x-png": "image/png",
    "image/x-bmp": "image/bmp", "image/x-ms-bmp": "image/bmp",
  };
  const normalized = aliases[mime] ?? mime;
  const info = normalized === "image/webp"
    ? { ...webpDimensions(bytes), mime: normalized, type: "webp" }
    : rasterInfo(bytes, normalized);
  if (info.width <= 0 || info.height <= 0 || info.width * info.height > MAX_RASTER_PIXELS) {
    throw new Error("Image pixel budget exceeded");
  }
  // The decoder must not find a later header that replaces the inspected size.
  if (info.type === "png") validatePngChunks(bytes);
  // A small logical GIF canvas must not conceal a larger frame allocation.
  if (info.type === "gif") validateGifFrames(bytes, info);
  return { ...info, format: info.type === "jpg" ? "JPEG" : info.type.toUpperCase() };
}

function validatePngChunks(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let header = false, data = false, dataEnded = false;
  for (let p = 8; p + 12 <= bytes.length;) {
    const length = view.getUint32(p), kind = text(bytes, p + 4, p + 8);
    const end = p + 12 + length;
    if (end > bytes.length) throw new Error("Truncated PNG chunk");
    if (!header && (kind !== "IHDR" || length !== 13)) throw new Error("Missing first PNG header");
    if (kind === "IHDR") {
      if (header || p !== 8 || length !== 13) throw new Error("Duplicate PNG header");
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[bytes[p + 17]]?.includes(bytes[p + 16]) || bytes[p + 18] !== 0 || bytes[p + 19] !== 0 || bytes[p + 20] > 1) {
        throw new Error("Invalid PNG header");
      }
      header = true;
    } else if (kind === "IDAT") {
      if (dataEnded) throw new Error("Nonconsecutive PNG data");
      data = true;
    } else if (kind === "IEND") {
      if (!data || length !== 0 || end !== bytes.length) throw new Error("Invalid PNG end");
      return;
    } else if (data) dataEnded = true;
    p = end;
  }
  throw new Error("Truncated PNG");
}

function validateGifFrames(bytes: Uint8Array, canvas: Dimensions) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 13) throw new Error("Truncated GIF");
  let p = 13 + ((bytes[10] & 0x80) ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0);
  let frames = 0;
  const blocks = () => {
    while (p < bytes.length) {
      const size = bytes[p++];
      if (!size) return;
      p += size;
      if (p > bytes.length) break;
    }
    throw new Error("Truncated GIF block");
  };
  while (p < bytes.length) {
    const marker = bytes[p++];
    if (marker === 0x3b && frames) return;
    if (marker === 0x21) { p++; blocks(); continue; }
    if (marker !== 0x2c || p + 9 > bytes.length) throw new Error("Invalid GIF frame");
    const x = view.getUint16(p, true), y = view.getUint16(p + 2, true);
    const width = view.getUint16(p + 4, true), height = view.getUint16(p + 6, true);
    const packed = bytes[p + 8];
    if (!width || !height || x + width > canvas.width || y + height > canvas.height) {
      throw new Error("GIF frame exceeds its canvas");
    }
    p += 9 + ((packed & 0x80) ? 3 * (1 << ((packed & 7) + 1)) : 0);
    p++; // LZW code size; the following data is skipped, never decompressed.
    blocks();
    frames++;
  }
  throw new Error("Truncated GIF");
}

function webpDimensions(bytes: Uint8Array): Dimensions {
  if (bytes.length < 20 || text(bytes, 0, 4) !== "RIFF" || text(bytes, 8, 12) !== "WEBP") {
    throw new Error("Invalid WebP magic");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error("Invalid WebP length");
  const uint24 = (p: number) => bytes[p] + bytes[p + 1] * 256 + bytes[p + 2] * 65536;
  const codedSize = (kind: string, p: number, size: number): Dimensions | null => {
    if (kind === "VP8 " && size >= 10 && text(bytes, p + 3, p + 6) === "\x9d\x01\x2a") {
      return { width: view.getUint16(p + 6, true) & 0x3fff, height: view.getUint16(p + 8, true) & 0x3fff };
    }
    if (kind === "VP8L" && size >= 5 && bytes[p] === 0x2f) {
      const bits = view.getUint32(p + 1, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    return null;
  };
  let canvas: Dimensions | null = null, image: Dimensions | null = null;
  let frames = 0;
  let p = 12;
  for (; p + 8 <= bytes.length;) {
    const kind = text(bytes, p, p + 4), size = view.getUint32(p + 4, true);
    const data = p + 8, end = data + size;
    if (end > bytes.length) throw new Error("Truncated WebP chunk");
    if (kind === "VP8X") {
      if (canvas || p !== 12 || size !== 10) throw new Error("Invalid WebP extended header");
      canvas = { width: uint24(data + 4) + 1, height: uint24(data + 7) + 1 };
    } else if (kind === "ANMF") {
      if (!canvas || image || size < 16) throw new Error("Invalid WebP animation frame");
      const x = uint24(data) * 2, y = uint24(data + 3) * 2;
      const width = uint24(data + 6) + 1, height = uint24(data + 9) + 1;
      if (x + width > canvas.width || y + height > canvas.height) throw new Error("WebP frame exceeds its canvas");
      let coded: Dimensions | null = null;
      let alpha = false;
      let q = data + 16;
      for (; q + 8 <= end;) {
        const length = view.getUint32(q + 4, true);
        if (q + 8 + length > end) throw new Error("Truncated WebP frame");
        const codedKind = text(bytes, q, q + 4);
        // ANMF permits ALPH + VP8, or one VP8L, plus unknown metadata chunks.
        // The downstream parser flattens known control containers, so these
        // must not be skipped as if they were opaque unknown metadata.
        if (codedKind === "ALPH") {
          if (alpha || coded) throw new Error("Invalid WebP frame alpha placement");
          alpha = true;
        } else if (["ANMF", "VP8X", "ANIM", "ICCP", "EXIF", "XMP "].includes(codedKind)) {
          throw new Error("Invalid WebP frame chunk");
        }
        if (codedKind === "VP8L" && alpha) throw new Error("Invalid WebP lossless alpha chunk");
        const dimensions = codedSize(codedKind, q + 8, length);
        if (!dimensions && (codedKind === "VP8 " || codedKind === "VP8L")) throw new Error("Invalid WebP coded frame");
        if (dimensions && coded) throw new Error("Duplicate WebP frame image");
        coded = dimensions ?? coded;
        q += 8 + length + (length & 1);
      }
      if (q !== end) throw new Error("Invalid WebP frame boundary");
      if (!coded || coded.width !== width || coded.height !== height) throw new Error("WebP frame size mismatch");
      frames++;
    } else {
      const dimensions = codedSize(kind, data, size);
      if (!dimensions && (kind === "VP8 " || kind === "VP8L")) throw new Error("Invalid WebP coded image");
      if (dimensions && (image || frames)) throw new Error("Duplicate WebP image");
      image = dimensions ?? image;
    }
    p = end + (size & 1);
  }
  if (p !== bytes.length) throw new Error("Invalid WebP chunk boundary");
  if (canvas && image && (canvas.width !== image.width || canvas.height !== image.height)) {
    throw new Error("WebP canvas size mismatch");
  }
  const result = canvas ?? image;
  if (!result || (!image && !frames)) throw new Error("Missing WebP image");
  return result;
}
