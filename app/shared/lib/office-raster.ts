import { MAX_OFFICE_EDITOR_BYTES, OfficeFileError } from "./office-file.ts";

export const MAX_RASTER_PIXELS = 32_000_000;
export const MAX_RASTER_BYTES = Math.floor(MAX_OFFICE_EDITOR_BYTES * 3 / 4);

export function rasterInfo(bytes: Uint8Array, declaredMime?: string) {
  if (bytes.length > MAX_RASTER_BYTES) throw new OfficeFileError("too-large");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let type: "png" | "jpg" | "gif" | "bmp", width = 0, height = 0;
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b)) {
    type = "png"; width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes.length >= 10 && /^GIF8[79]a$/.test(new TextDecoder().decode(bytes.subarray(0, 6)))) {
    type = "gif"; width = view.getUint16(6, true); height = view.getUint16(8, true);
  } else if (bytes.length >= 26 && bytes[0] === 66 && bytes[1] === 77) {
    type = "bmp"; width = view.getInt32(18, true); height = Math.abs(view.getInt32(22, true));
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    type = "jpg";
    for (let p = 2; p + 3 < bytes.length;) {
      if (bytes[p++] !== 255) throw new OfficeFileError("invalid");
      while (bytes[p] === 255) p++;
      const marker = bytes[p++];
      if(p + 2 > bytes.length) throw new OfficeFileError("invalid");
      if (marker === 217 || marker === 218) break;
      const length = view.getUint16(p);
      if (length < 2 || p + length > bytes.length) throw new OfficeFileError("invalid");
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (length < 7) throw new OfficeFileError("invalid");
        height = view.getUint16(p + 3); width = view.getUint16(p + 5); break;
      }
      p += length;
    }
  } else throw new OfficeFileError("unsupported");
  if (!width || !height || width < 0 || width * height > MAX_RASTER_PIXELS) throw new OfficeFileError("too-large");
  const mime = type === "jpg" ? "image/jpeg" : `image/${type}`;
  if (declaredMime && declaredMime.toLowerCase() !== mime) throw new OfficeFileError("unsafe");
  return { type, width, height, mime };
}

export function rasterDataUrl(bytes: Uint8Array, mime: string): string {
  rasterInfo(bytes, mime);
  let binary = "";
  for (let p = 0; p < bytes.length; p += 0x8000) binary += String.fromCharCode(...bytes.subarray(p, p + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

export function readRasterDataUrl(value: unknown) {
  if (typeof value !== "string" || value.length > MAX_OFFICE_EDITOR_BYTES) throw new OfficeFileError("unsupported");
  const match = /^data:(image\/(?:png|jpeg|gif|bmp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match) throw new OfficeFileError("unsupported");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0)); }
  catch (cause) { throw new OfficeFileError("invalid", { cause }); }
  return { bytes, ...rasterInfo(bytes, match[1]) };
}
