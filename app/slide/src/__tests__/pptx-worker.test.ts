import { expect, test } from "bun:test";
import { importPptxFile, exportPptxFile } from "../lib/pptx-worker.ts";
import { readOfficePackage } from "../../../shared/lib/office-package.ts";

async function independentFile() {
  const bytes = await Bun.file(new URL("./fixtures/pptx/shp-pos-and-size.pptx",import.meta.url)).arrayBuffer();
  return new File([bytes],"independent.pptx");
}

test("the real disposable PowerPoint Worker imports independent embedded raster and exports its exact physical page", async () => {
  const converted = await importPptxFile(await independentFile());
  expect(converted.slides).toHaveLength(3);
  expect(converted.slides[1].elements.some(element => element.type==="image")).toBe(true);
  const result = await exportPptxFile({id:"actual-worker",title:"Worker deck",slides:converted.slides,slideSize:converted.slideSize,createdAt:"2026-11-08T00:00:00.000Z",updatedAt:"2026-11-08T00:00:00.000Z"});
  const pkg = await readOfficePackage(new Uint8Array(await result.blob.arrayBuffer()));
  const size = pkg.xmlParts.get(pkg.mainPart)!.getElementsByTagNameNS("http://schemas.openxmlformats.org/presentationml/2006/main","sldSz").item(0)!;
  expect([size.getAttribute("cx"),size.getAttribute("cy")]).toEqual(["9144000","6858000"]);
});

test("a malformed PowerPoint import fails closed and a later real Worker operation still succeeds", async () => {
  await expect(importPptxFile(new File(["not a ZIP"],"broken.pptx"))).rejects.toMatchObject({code:"invalid"});
  expect((await importPptxFile(await independentFile())).slides).toHaveLength(3);
});

test("PowerPoint file cancellation before reading cannot post a late Worker operation", async () => {
  let finish!: (value: ArrayBuffer) => void;
  const bytes = new Promise<ArrayBuffer>(done => {finish=done;});
  const file = new File(["pending"],"pending.pptx");file.arrayBuffer=()=>bytes;
  const controller = new AbortController(), pending = importPptxFile(file,controller.signal);
  controller.abort("retired own file read");
  await expect(pending).rejects.toBe("retired own file read");
  finish(new ArrayBuffer(0));
});
