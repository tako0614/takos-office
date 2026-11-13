// Synthetic bucket/auth fixtures only; HTTP and SDK callbacks are the real ones.
import { afterEach, expect, spyOn, test } from "bun:test";
import { createCanvas } from "canvas";
import * as canvasApi from "canvas";
import { jsPDF } from "jspdf";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpRequestHandler } from "../../../shared/mcp-factory.ts";
import type { StorageFile, TakosStorageClient } from "../../../shared/lib/takos-storage.ts";
import { createSlideMcpServer } from "../mcp.ts";
import { createPresentationStore } from "../presentation-store.ts";
import { exportPresentationToPdf } from "../lib/pdf-exporter.ts";
import { renderSlideToBuffer } from "../lib/server-renderer.ts";
import { loadImagesForExport } from "../lib/image-loader.ts";
import type { Presentation } from "../types/index.ts";

const png = new Uint8Array(createCanvas(1, 1).toBuffer("image/png"));
const reason = new DOMException("Fixture export cancelled", "AbortError");
const deck: Presentation = {
  id: "cancel-deck", title: "Cancel", createdAt: "now", updatedAt: "now",
  slides: [{ id: "slide", background: "#fff", elements: [1, 2].map((id) => ({
    id: String(id), type: "image" as const, imageUrl: `https://example.com/${id}.png`,
    x: 0, y: 0, width: 1, height: 1, rotation: 0,
  })) }],
};
const restores: Array<() => void> = [];
afterEach(() => { for (const restore of restores.splice(0)) restore(); });

function blockedImage() {
  let ready!: () => void;
  const reading = new Promise<void>((resolve) => { ready = resolve; });
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancels = 0, fetches = 0;
  let fetchSignal: AbortSignal | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    pull() { ready(); },
    cancel() { cancels++; },
  }, { highWaterMark: 0 });
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
    fetches++;
    fetchSignal = init?.signal ?? undefined;
    return new Response(fetches === 1 ? stream : png, { headers: { "content-type": "image/png" } });
  }, { preconnect: globalThis.fetch.preconnect }));
  restores.push(() => fetchMock.mockRestore());
  return {
    reading,
    releaseOldRoute() { if (!cancels) { controller.enqueue(png); controller.close(); } },
    snapshot: () => ({ cancels, fetches, fetchAborted: fetchSignal?.aborted }),
  };
}

const settled = (task: Promise<unknown>) => task.then(
  () => ({ error: undefined }), (error: unknown) => ({ error }),
);

for (const mode of ["loader", "pdf", "png"] as const) {
  test(`${mode}: cancellation during a pending image read cancels it and skips later work`, async () => {
    const controller = new AbortController();
    const fixture = blockedImage();
    const decode = spyOn(canvasApi, "loadImage");
    restores.push(() => decode.mockRestore());
    const task = settled(mode === "loader"
      ? loadImagesForExport(deck.slides[0].elements, fetch, controller.signal)
      : mode === "pdf" ? exportPresentationToPdf(deck, controller.signal)
      : renderSlideToBuffer(deck.slides[0], 8, 8, undefined, controller.signal));
    await fixture.reading;
    controller.abort(reason);
    fixture.releaseOldRoute();
    expect((await task).error).toBe(reason);
    expect(fixture.snapshot()).toEqual({ cancels: 1, fetches: 1, fetchAborted: true });
    expect(decode).not.toHaveBeenCalled();
  });
}

test("pre-aborted export performs no fetch or native decode", async () => {
  const controller = new AbortController(); controller.abort(reason);
  const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(new Response(png, { headers: { "content-type": "image/png" } }));
  restores.push(() => fetchMock.mockRestore());
  expect((await settled(exportPresentationToPdf(deck, controller.signal))).error).toBe(reason);
  expect((await settled(renderSlideToBuffer(deck.slides[0], 8, 8, undefined, controller.signal))).error).toBe(reason);
  expect(fetchMock).not.toHaveBeenCalled();
});

function readOnlyStore() {
  const folder: StorageFile = { id: "folder", name: "takos-slide", type: "folder", createdAt: "now", updatedAt: "now" };
  const file: StorageFile = { id: "file", name: `${deck.id}.takosslide`, type: "file", parentId: folder.id, createdAt: "now", updatedAt: "now" };
  const unexpected = async (): Promise<never> => { throw new Error("Unexpected storage mutation"); };
  const client: TakosStorageClient = {
    ready: async () => {}, list: async (prefix) => prefix ? [file] : [folder],
    get: async (id) => id === file.id ? file : null,
    getContent: async () => JSON.stringify(deck),
    putContent: unexpected, create: unexpected, createFolder: unexpected, rename: unexpected, delete: unexpected,
  };
  return createPresentationStore(client);
}

const call = { jsonrpc: "2.0" as const, id: 1, method: "tools/call", params: { name: "slide_export_pdf", arguments: { id: deck.id } } };

for (const tool of ["slide_export_pdf", "slide_screenshot"] as const) test(`authenticated HTTP Request.signal reaches the actual ${tool} callback and stream`, async () => {
  const controller = new AbortController();
  const fixture = blockedImage();
  const store = readOnlyStore();
  const handler = createMcpRequestHandler((signal) => createSlideMcpServer(store, { signal }), { authToken: "fixture-mcp" });
  const response = await handler(new Request("https://office.example/mcp", {
    method: "POST", signal: controller.signal,
    headers: { authorization: "Bearer fixture-mcp", accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ ...call, params: { name: tool, arguments: tool === "slide_export_pdf" ? { id: deck.id } : { presentationId: deck.id, slideIndex: 0, width: 320, height: 180 } } }),
  }));
  const text = response.text();
  await fixture.reading;
  controller.abort(reason);
  fixture.releaseOldRoute();
  expect(response.status).toBe(200);
  expect(await text).toContain('"isError":true');
  expect(fixture.snapshot()).toEqual({ cancels: 1, fetches: 1, fetchAborted: true });
});

function inlineDeck(): Presentation {
  const imageUrl = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
  return { ...deck, slides: [{ ...deck.slides[0], elements: deck.slides[0].elements.map((element) => ({ ...element, imageUrl })) }] };
}

test("PDF observes cancellation between placements before embedding another image", async () => {
  const controller = new AbortController();
  const api = jsPDF.API as unknown as { addImage: (...args: unknown[]) => jsPDF };
  const original = api.addImage;
  const draw = spyOn(api, "addImage").mockImplementation(function (this: jsPDF, ...args: unknown[]) {
    const result = original.apply(this, args);
    controller.abort(reason);
    return result;
  });
  restores.push(() => draw.mockRestore());
  expect((await settled(exportPresentationToPdf(inlineDeck(), controller.signal))).error).toBe(reason);
  expect(draw).toHaveBeenCalledTimes(1);
});

test("PNG observes cancellation after a running native decode returns", async () => {
  const controller = new AbortController();
  const original = canvasApi.loadImage;
  const decode = spyOn(canvasApi, "loadImage").mockImplementation(async (...args: Parameters<typeof canvasApi.loadImage>) => {
    const result = await original(...args);
    controller.abort(reason);
    return result;
  });
  restores.push(() => decode.mockRestore());
  expect((await settled(renderSlideToBuffer(inlineDeck().slides[0], 8, 8, undefined, controller.signal))).error).toBe(reason);
  expect(decode).toHaveBeenCalledTimes(1);
});

test("an uncancelled signal preserves 65 small placements and one shared PNG decode", async () => {
  const controller = new AbortController();
  const presentation = inlineDeck();
  presentation.slides[0].elements = Array.from({ length: 65 }, (_, i) => ({ ...presentation.slides[0].elements[0], id: String(i) }));
  const decode = spyOn(canvasApi, "loadImage");
  restores.push(() => decode.mockRestore());
  const pdf = await exportPresentationToPdf(presentation, controller.signal);
  const screenshot = await renderSlideToBuffer(presentation.slides[0], 8, 8, undefined, controller.signal);
  expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
  expect([...screenshot.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(decode).toHaveBeenCalledTimes(1);
});

test("SDK notifications/cancelled aborts the actual tool extra.signal and image work", async () => {
  const fixture = blockedImage();
  const store = readOnlyStore();
  let done!: () => void;
  const completed = new Promise<void>((resolve) => { done = resolve; });
  const original = store.exportPdf.bind(store);
  const exportSpy = spyOn(store, "exportPdf").mockImplementation(async (...args) => {
    try { return await original(...args); } finally { done(); }
  });
  restores.push(() => exportSpy.mockRestore());
  const server = createSlideMcpServer(store);
  const [client, transport] = InMemoryTransport.createLinkedPair();
  await server.connect(transport);
  try {
    await client.send(call);
    await fixture.reading;
    await client.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1, reason: "Fixture cancelled" } });
    fixture.releaseOldRoute();
    await completed;
    expect(exportSpy.mock.calls[0][1]?.aborted).toBe(true);
    expect(fixture.snapshot()).toEqual({ cancels: 1, fetches: 1, fetchAborted: true });
  } finally { await server.close(); }
});
