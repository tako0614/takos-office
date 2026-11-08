import { expect, test } from "bun:test";
import { clientStoreFixture } from "./save-custody-fixture.ts";
import { createPresentationImporter } from "../lib/presentation-import.ts";
import { getPresentation, getPresentationSaveState } from "../lib/storage.ts";
import type { ImportedPresentation } from "../lib/pptx-import.ts";

const converted: ImportedPresentation = {
  slideSize:{widthEmu:9144000,heightEmu:6858000},hasUnsupportedContent:false,
  slides:[{id:"file-slide",background:"#ffffff",elements:[]}],
};
function deferred<T>() {let resolve!: (value: T) => void;const promise = new Promise<T>(done => {resolve=done;});return {promise,resolve};}
const input = () => new File(["file boundary"],"Imported deck.pptx");

test("PowerPoint import uses actual create ACK and captured Workspace without manual revision reseeding", async () => {
  const f = clientStoreFixture();
  const importer = createPresentationImporter(async () => converted);
  try {
    const result = await importer.importFile(input());
    expect(result?.presentation.title).toBe("Imported deck");
    expect(result?.presentation.slideSize).toEqual({widthEmu:9144000,heightEmu:6858000});
    expect(getPresentation(result!.presentation.id)).toEqual(result!.presentation);
    expect(getPresentationSaveState(result!.presentation.id)).toBe("clean");
    expect(result!.presentation).toEqual(await (await f.read("A",result!.presentation.id)).json());
    expect(f.calls.filter(call => call.method === "PUT")).toHaveLength(1);
  } finally {importer.retire();await f.close();}
});

import { loadPresentations, loadPresentationFromApi } from "../lib/storage.ts";
import { captureCreateReceipt } from "../../../shared/lib/create-receipt.ts";

test("retired A to B to A conversion cannot create a row or overwrite another Workspace cache", async () => {
  const f = clientStoreFixture(), conversion = deferred<ImportedPresentation>();
  const importer = createPresentationImporter(async () => conversion.promise);
  try {
    const pending = importer.importFile(input());
    f.scope("B");importer.retire();
    const existing = await f.seed("B","B original");await loadPresentationFromApi(existing.id);
    const beforeB = [...f.values.entries()].filter(([key]) => key.includes(":workspace:B"));
    f.scope("A");conversion.resolve(converted);
    expect(await pending).toBeNull();
    expect(f.calls.filter(call => call.method==="PUT")).toHaveLength(0);
    expect(loadPresentations()).toEqual([]);
    expect([...f.values.entries()].filter(([key]) => key.includes(":workspace:B"))).toEqual(beforeB);
  } finally {importer.retire();await f.close();}
});

test("an uncertain imported create stays retained and is never automatically replayed", async () => {
  const f = clientStoreFixture(), importer = createPresentationImporter(async () => converted);
  try {
    f.loseNextWrite();
    await expect(importer.importFile(input())).rejects.toThrow("500");
    const local = loadPresentations()[0];
    expect(getPresentationSaveState(local.id)).toBe("failed");
    expect((await f.read("A",local.id)).status).toBe(200); // the real store committed before losing its ACK
    const token = captureCreateReceipt("takos-slide-create-receipt").current();
    expect(token).not.toBeNull();
    await expect(importer.importFile(input())).rejects.toThrow("fresh library read");
    expect(captureCreateReceipt("takos-slide-create-receipt").current()).toBe(token);
    expect(f.calls.filter(call => call.method==="PUT")).toHaveLength(1);
  } finally {importer.retire();await f.close();}
});

test("another create started during file conversion keeps its original uncertainty receipt", async () => {
  const f = clientStoreFixture(), conversion = deferred<ImportedPresentation>();
  const importer = createPresentationImporter(async () => conversion.promise);
  try {
    const pending = importer.importFile(input());
    const receipt = captureCreateReceipt("takos-slide-create-receipt"), token = receipt.begin();
    conversion.resolve(converted);
    await expect(pending).rejects.toThrow("fresh library read");
    expect(receipt.current()).toBe(token);
    expect(f.calls.filter(call => call.method==="PUT")).toHaveLength(0);
  } finally {importer.retire();await f.close();}
});

test("a retired in-flight import settles its original ACK and receipt without adopting into B", async () => {
  const f = clientStoreFixture(), importer = createPresentationImporter(async () => converted);
  try {
    const held = f.holdNext("PUT"), pending = importer.importFile(input());
    await held.started;
    const original = loadPresentations()[0];
    f.scope("B");importer.retire();const beforeB=[...f.values.entries()].filter(([key]) => key.includes(":workspace:B"));
    held.release();expect(await pending).toBeNull();
    expect([...f.values.entries()].filter(([key]) => key.includes(":workspace:B"))).toEqual(beforeB);
    f.scope("A");
    expect(getPresentation(original.id)).toEqual(await (await f.read("A",original.id)).json());
    expect(getPresentationSaveState(original.id)).toBe("clean");
    expect(captureCreateReceipt("takos-slide-create-receipt").current()).toBeNull();
    expect(f.calls.filter(call => call.method==="PUT")).toHaveLength(1);
  } finally {importer.retire();await f.close();}
});
