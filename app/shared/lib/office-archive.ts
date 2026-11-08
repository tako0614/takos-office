import { DOMParser, type Document as XmlDocument } from "@xmldom/xmldom";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";

import { MAX_OFFICE_FILE_BYTES, MAX_OFFICE_EXPANDED_BYTES, MAX_OFFICE_ENTRIES, OfficeFileError } from "./office-file.ts";
export { MAX_OFFICE_FILE_BYTES, MAX_OFFICE_EXPANDED_BYTES, MAX_OFFICE_ENTRIES, MAX_OFFICE_EDITOR_BYTES, OfficeFileError } from "./office-file.ts";

export function parseOfficeXml(bytes: Uint8Array): XmlDocument {
  try {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
    const xml = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new OfficeFileError("unsafe");
    const doc = new DOMParser({ onError() { throw new OfficeFileError("invalid"); } }).parseFromString(xml, "application/xml");
    if (!doc.documentElement) throw new OfficeFileError("invalid");
    const stack = [{ node: doc.documentElement, depth: 0 }];
    let count = 0;
    while (stack.length) {
      const { node, depth } = stack.pop()!;
      if (++count > 100_000 || depth > 128) throw new OfficeFileError("too-large");
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) stack.push({ node: child as typeof node, depth: depth + 1 });
      }
    }
    return doc;
  } catch (cause) {
    if (cause instanceof OfficeFileError) throw cause;
    throw new OfficeFileError("invalid", { cause });
  }
}

function canonicalName(name: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(name); } catch { throw new OfficeFileError("unsafe"); }
  if (!name || /[\\\x00-\x1f\x7f?#]/u.test(decoded) || decoded.startsWith("/") || /^[a-z]:/i.test(decoded)
    || decoded.split("/").some((part) => part === ".." || part === ".")) throw new OfficeFileError("unsafe");
  return decoded.normalize("NFC").toLowerCase();
}

/** Inspect all actual inflated bytes before any second parser receives the package. */
export async function readOfficeArchive(bytes: Uint8Array, signal?: AbortSignal): Promise<Map<string, Uint8Array>> {
  if (bytes.byteLength > MAX_OFFICE_FILE_BYTES) throw new OfficeFileError("too-large");
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    strictness: "strict", filenameValidation: "strict", useWebWorkers: false, useCompressionStream: false,
  });
  const parts = new Map<string, Uint8Array>();
  const names = new Set<string>();
  let entries = 0, declared = 0, actual = 0;
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      signal?.throwIfAborted();
      if (++entries > MAX_OFFICE_ENTRIES) throw new OfficeFileError("too-large");
      const name = canonicalName(entry.filename);
      if (names.has(name)) throw new OfficeFileError("unsafe");
      names.add(name);
      if (entry.encrypted || ![0, 8].includes(entry.compressionMethod)) throw new OfficeFileError("unsupported");
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) throw new OfficeFileError("invalid");
      declared += entry.uncompressedSize;
      if (declared > MAX_OFFICE_EXPANDED_BYTES) throw new OfficeFileError("too-large");
      if (entry.directory) continue;
      if (/vbaproject|(?:^|\/)(?:activex|embeddings|scripts)\/|\.(?:exe|dll|js|vbs|html?|svg)$/i.test(name)) throw new OfficeFileError("unsafe");
      let size = 0;
      const chunks: Uint8Array[] = [];
      const sink = new WritableStream<Uint8Array>({
        write(chunk) {
          signal?.throwIfAborted();
          size += chunk.byteLength;
          actual += chunk.byteLength;
          if (actual > MAX_OFFICE_EXPANDED_BYTES || size > entry.uncompressedSize) throw new OfficeFileError("too-large");
          chunks.push(chunk.slice());
        },
      });
      await entry.getData(sink, { checkCrc32: true, signal });
      if (size !== entry.uncompressedSize) throw new OfficeFileError("invalid");
      const data = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
      if (/\.(?:xml|rels)$/i.test(name)) parseOfficeXml(data);
      parts.set(entry.filename, data);
    }
    if (!parts.size) throw new OfficeFileError("invalid");
    return parts;
  } catch (cause) {
    if (signal?.aborted) throw signal.reason;
    if (cause instanceof OfficeFileError) throw cause;
    throw new OfficeFileError("invalid", { cause });
  } finally {
    await reader.close();
  }
}

/** Canonical, stored ZIP: a downstream codec never interprets the original untrusted headers. */
export async function writeOfficeArchive(parts: ReadonlyMap<string, Uint8Array>, signal?: AbortSignal): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false, useCompressionStream: false });
  for (const [name, bytes] of parts) {
    signal?.throwIfAborted();
    await writer.add(name, new Uint8ArrayReader(bytes), { level: 0, signal });
  }
  return writer.close();
}
