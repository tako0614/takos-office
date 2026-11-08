import { expect, test } from "bun:test";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { readOfficeArchive } from "../shared/lib/office-archive.ts";

async function zip(files: Record<string, string>) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false, useCompressionStream: false });
  for (const [name, content] of Object.entries(files)) {
    await writer.add(name, new Uint8ArrayReader(new TextEncoder().encode(content)), { level: 0 });
  }
  return writer.close();
}

test("Office archive admission returns the exact bounded document parts", async () => {
  const bytes = await zip({ "word/document.xml": "<document>Hello</document>" });
  const parts = await readOfficeArchive(bytes);
  expect([...parts.keys()]).toEqual(["word/document.xml"]);
  expect(new TextDecoder().decode(parts.get("word/document.xml"))).toBe("<document>Hello</document>");
});

import { MAX_OFFICE_FILE_BYTES, MAX_OFFICE_EXPANDED_BYTES, OfficeFileError, parseOfficeXml } from "../shared/lib/office-archive.ts";

function mutateSize(bytes: Uint8Array, size: number) {
  const output = bytes.slice(), view = new DataView(output.buffer);
  for(let i=0;i+46<output.length;i++) {
    const signature = view.getUint32(i,true);
    if(signature === 0x04034b50) view.setUint32(i+22,size,true);
    if(signature === 0x02014b50) view.setUint32(i+24,size,true);
    if(signature === 0x08074b50) view.setUint32(i+12,size,true);
  }
  return output;
}

test("malformed, oversized and forged expanded-size ZIPs fail closed", async () => {
  await expect(readOfficeArchive(new Uint8Array([0,1,2,3]))).rejects.toBeInstanceOf(OfficeFileError);
  await expect(readOfficeArchive(new Uint8Array(MAX_OFFICE_FILE_BYTES+1))).rejects.toMatchObject({code:"too-large"});
  const input = await zip({"word/data.bin":"actual payload"});
  await expect(readOfficeArchive(mutateSize(input,MAX_OFFICE_EXPANDED_BYTES+1))).rejects.toBeInstanceOf(OfficeFileError);
  await expect(readOfficeArchive(mutateSize(input,1))).rejects.toBeInstanceOf(OfficeFileError);
});

test("ZIP part aliases, active content and XML entities are refused", async () => {
  await expect(readOfficeArchive(await zip({"word/A.xml":"<a/>","word/a.xml":"<a/>"}))).rejects.toMatchObject({code:"unsafe"});
  await expect(readOfficeArchive(await zip({"word/a.xml":"<a/>","word/%61.xml":"<a/>"}))).rejects.toMatchObject({code:"unsafe"});
  await expect(readOfficeArchive(await zip({"word/%2e%2e/payload.xml":"<a/>"}))).rejects.toBeInstanceOf(OfficeFileError);
  await expect(readOfficeArchive(await zip({"word/vbaProject.bin":"active"}))).rejects.toMatchObject({code:"unsafe"});
  await expect(readOfficeArchive(await zip({"word/document.xml":'<!DOCTYPE root [<!ENTITY x SYSTEM "https://not-allowed.invalid/secret">]><root>&x;</root>'}))).rejects.toMatchObject({code:"unsafe"});
});

test("corrupted ZIP CRC and deeply nested XML cannot reach a downstream codec", async () => {
  const input = await zip({"word/data.bin":"unique CRC payload"});
  const at = Buffer.from(input).indexOf("unique CRC payload");
  expect(at).toBeGreaterThan(0);
  input[at] ^= 1;
  await expect(readOfficeArchive(input)).rejects.toMatchObject({code:"invalid"});
  expect(() => parseOfficeXml(new TextEncoder().encode("<a>".repeat(131)+"</a>".repeat(131)))).toThrow(OfficeFileError);
});

test("an already aborted archive read preserves the cancellation reason", async () => {
  const controller = new AbortController();
  controller.abort("own archive cancelled");
  await expect(readOfficeArchive(await zip({"word/document.xml":"<a/>"}),controller.signal)).rejects.toBe("own archive cancelled");
});

test("encrypted archives are refused without requesting or accepting a password", async () => {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {useWebWorkers:false,useCompressionStream:false});
  await writer.add("word/document.xml",new Uint8ArrayReader(new TextEncoder().encode("<document/>")),{level:0,password:"synthetic-file-password"});
  await expect(readOfficeArchive(await writer.close())).rejects.toMatchObject({code:"unsupported"});
});
