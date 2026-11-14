import { expect, test } from "bun:test";
import {
  addSheet, deleteSheet, getSpreadsheet, loadSpreadsheetFromApi,
  loadSpreadsheets, loadSpreadsheetsFromApi, renameSheet, updateSpreadsheet,
  getSpreadsheetSaveState, retrySpreadsheetAfterConflict, deleteSpreadsheet,
  captureSpreadsheetWriter, clearSpreadsheetsCache, createSpreadsheet,
} from "../lib/storage.ts";
import { workspaceStorageKey } from "../../../shared/lib/space-id.ts";
import { clientStoreFixture } from "./save-custody-fixture.ts";
import { setCellValue } from "../lib/formula.ts";

async function relatedWorkbook(f: ReturnType<typeof clientStoreFixture>) {
  const initial = await f.seed("A");await loadSpreadsheetFromApi(initial.id);
  await updateSpreadsheet({ ...initial, sheets: [
    { ...initial.sheets[0], name: "Sheet1", cells: { A1: { value: "10" } } },
    { id: "second", name: "Sheet2", cells: {}, colWidths: {}, rowHeights: {} },
    { id: "third", name: "Sheet3", cells: {}, colWidths: {}, rowHeights: {} },
  ] });
  const store = f.store("A");
  await store.setCell(initial.id, "second", "A1", "=Sheet1!A1+1");
  await store.setCell(initial.id, "third", "A1", "=Sheet2!A1*2");
  const book = await loadSpreadsheetFromApi(initial.id);
  expect(book.sheets[1].cells.A1.computed).toBe("11");
  expect(book.sheets[2].cells.A1.computed).toBe("22");
  return book;
}

test("an input edit refreshes cross-sheet and transitive results before ACK and after real persistence", async () => {
  const f = clientStoreFixture();let pending: Promise<unknown> | undefined;
  let release = () => {};
  try {
    const before = await relatedWorkbook(f), first = before.sheets[0];
    const cells = setCellValue(first, "A1", "20", before.sheets);
    const gate = f.holdNext("PUT");release = gate.release;
    pending = updateSpreadsheet({ ...before, sheets: [{ ...first, cells }, ...before.sheets.slice(1)] });
    await gate.started;
    expect(getSpreadsheet(before.id)!.sheets[1].cells.A1.computed).toBe("21");
    expect(getSpreadsheet(before.id)!.sheets[2].cells.A1.computed).toBe("42");
    gate.release();await pending;
    const saved = await f.store("A").getSpreadsheet(before.id);
    expect(saved.sheets[1].cells.A1.computed).toBe("21");
    expect(saved.sheets[2].cells.A1.computed).toBe("42");
    expect(await loadSpreadsheetFromApi(before.id)).toEqual(saved);
  } finally { release();await Promise.allSettled([pending]);await f.close(); }
});

test("the canonical conditional PUT recalculates dependent results without relying on the Web client", async () => {
  const f = clientStoreFixture();
  try {
    const before = await relatedWorkbook(f), draft = structuredClone(before);
    draft.sheets[0].cells = setCellValue(draft.sheets[0], "A1", "20", draft.sheets);
    const response = await f.app.request("/api/spreadsheets/" + before.id + "?space_id=A", {
      method: "PUT", headers: { "Content-Type": "application/json", "If-Match": before.updatedAt }, body: JSON.stringify(draft),
    });
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.sheets[1].cells.A1.computed).toBe("21");
    expect(saved.sheets[2].cells.A1.computed).toBe("42");
    expect(await f.store("A").getSpreadsheet(before.id)).toEqual(saved);
  } finally { await f.close(); }
});

for (const mutation of ["cell", "range", "clear"] as const) {
  test(`MCP ${mutation} mutation refreshes cross-sheet and transitive results`, async () => {
    const f = clientStoreFixture();
    try {
      const before = await relatedWorkbook(f), store = f.store("A"), first = before.sheets[0];
      if (mutation === "cell") await store.setCell(before.id, first.id, "A1", "20");
      else if (mutation === "range") await store.setRange(before.id, first.id, "A1", [["30"]]);
      else await store.clearRange(before.id, first.id, "A1:A1");
      const expected = mutation === "cell" ? "21" : mutation === "range" ? "31" : "1";
      const saved = await store.getSpreadsheet(before.id);
      expect(saved.sheets[1].cells.A1.computed).toBe(expected);
      expect(saved.sheets[2].cells.A1.computed).toBe(String(Number(expected) * 2));
      expect((await store.getCell(before.id, "second", "A1")).computed).toBe(expected);
    } finally { await f.close(); }
  });
}

test("the existing MCP renameTab store callee persists rewritten references and a same-name retry has effect0", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadSpreadsheetFromApi(initial.id);
    const target = { ...initial.sheets[0], name: "Sheet1", cells: { A1: { value: "10" } } };
    await updateSpreadsheet({ ...initial, sheets: [target, {
      id: "dependent", name: "Sheet2", cells: { A1: { value: "=Sheet1!A1" } }, colWidths: {}, rowHeights: {},
    }] });
    const store = f.store("A");await store.renameTab(initial.id, target.id, "Inputs");
    const saved = await store.getSpreadsheet(initial.id);
    expect(saved.sheets[1].cells.A1.value).toBe("=Inputs!A1");
    expect(saved.sheets[1].cells.A1.computed).toBe("10");
    await store.renameTab(initial.id, target.id, "Inputs");
    expect(await store.getSpreadsheet(initial.id)).toEqual(saved);
    expect(await loadSpreadsheetFromApi(initial.id)).toEqual(saved);
  } finally { await f.close(); }
});

test("renaming a sheet preserves cross-sheet references through real save ACKs and reload", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadSpreadsheetFromApi(initial.id);
    const target = { ...initial.sheets[0], name: "Sheet1", cells: { A1: { value: "10" } } };
    await updateSpreadsheet({ ...initial, sheets: [target, {
      id: "dependent", name: "Sheet2", cells: { A1: { value: "=Sheet1!A1" } }, colWidths: {}, rowHeights: {},
    }] });
    await renameSheet(initial.id, target.id, "Inputs").remote;
    const saved = await f.store("A").getSpreadsheet(initial.id);
    expect(saved.sheets[0].name).toBe("Inputs");
    expect(saved.sheets[1].cells.A1.value).toBe("=Inputs!A1");
    expect(saved.sheets[1].cells.A1.computed).toBe("10");
    const repeated = renameSheet(initial.id, target.id, "Inputs");
    expect(repeated.value).toBe(false);await repeated.remote;
    expect(getSpreadsheet(initial.id)).toEqual(saved);
    expect(await loadSpreadsheetFromApi(initial.id)).toEqual(saved);
    await updateSpreadsheet({ ...getSpreadsheet(initial.id)!, title: "After rename" });
    expect(f.calls.filter(call => call.method === "PUT").map(call => call.status)).toEqual([200, 200, 200]);
  } finally { await f.close(); }
});

test("duplicate-name and defined-name rename refusals leave the actual cache and saved workbook intact", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadSpreadsheetFromApi(initial.id);
    const added = addSheet(initial.id, "Second");await added.remote;
    const before = getSpreadsheet(initial.id)!, cacheBytes = JSON.stringify([...f.values]), writes = f.calls.filter(call => call.method === "PUT").length;
    expect(() => renameSheet(initial.id, initial.sheets[0].id, "Second")).toThrow();
    expect(JSON.stringify([...f.values])).toBe(cacheBytes);
    expect(await f.store("A").getSpreadsheet(initial.id)).toEqual(before);
    expect(f.calls.filter(call => call.method === "PUT")).toHaveLength(writes);
    const named = await updateSpreadsheet({ ...before, definedNames: [{ name: "Area", reference: "Sheet1!$A$1" }] });
    const namedBytes = JSON.stringify([...f.values]), namedWrites = f.calls.filter(call => call.method === "PUT").length;
    expect(() => renameSheet(initial.id, initial.sheets[0].id, "Renamed")).toThrow("defined names");
    expect(JSON.stringify([...f.values])).toBe(namedBytes);
    expect(await f.store("A").getSpreadsheet(initial.id)).toEqual(named!);
    expect(f.calls.filter(call => call.method === "PUT")).toHaveLength(namedWrites);
  } finally { await f.close(); }
});

test("sequential saves adopt real canonical ACKs without an intervening read", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");
    await loadSpreadsheetFromApi(initial.id);
    const first = await updateSpreadsheet({ ...initial, title: "First save" });
    const second = await updateSpreadsheet({ ...first!, title: "Second save" });
    const third = await updateSpreadsheet({ ...second!, title: "Third save" });
    expect(await f.store("A").getSpreadsheet(initial.id)).toEqual(third!);
    expect(getSpreadsheet(initial.id)).toEqual(third!);
    expect(f.calls.filter((call) => call.method === "PUT").map((call) => call.status)).toEqual([200, 200, 200]);
  } finally { await f.close(); }
});

test("overlapping drafts serialize and an older ACK cannot replace newer edits", async () => {
  const f = clientStoreFixture();
  let first: Promise<unknown> | undefined, second: Promise<unknown> | undefined;
  const gate = f.holdNext("PUT");
  try {
    const initial = await f.seed("A");
    await loadSpreadsheetFromApi(initial.id);
    first = updateSpreadsheet({ ...initial, title: "First draft" });
    void first.catch(() => undefined);
    await gate.started;
    second = updateSpreadsheet({ ...initial, title: "Newest draft" });
    void second.catch(() => undefined);
    await Promise.resolve();
    expect(f.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
    expect(getSpreadsheet(initial.id)?.title).toBe("Newest draft");
    gate.release();
    await Promise.all([first, second]);
    expect(getSpreadsheet(initial.id)).toEqual(await f.store("A").getSpreadsheet(initial.id));
    expect(getSpreadsheet(initial.id)?.title).toBe("Newest draft");
  } finally {
    gate.release();await Promise.allSettled([first, second]);await f.close();
  }
});

test("an A read finishing in B returns A and never changes B cache bytes", async () => {
  const f = clientStoreFixture();
  const gate = f.holdNext("GET");
  let pending: Promise<unknown> | undefined;
  try {
    const a = await f.seed("A", "A budget"), b = await f.seed("B", "B budget");
    pending = loadSpreadsheetFromApi(a.id);await gate.started;
    f.scope("B");await loadSpreadsheetFromApi(b.id);
    const keyB = workspaceStorageKey("takos-excel-spreadsheets", "B");
    const beforeB = f.values.get(keyB);
    expect(beforeB).toBeDefined();
    gate.release();
    const returned = await pending;
    expect(returned).toEqual(a);
    expect(f.values.get(keyB)).toBe(beforeB);
    expect(loadSpreadsheets()).toEqual([b]);
    f.scope("A");expect(loadSpreadsheets()).toEqual([a]);
  } finally { gate.release();await Promise.allSettled([pending]);await f.close(); }
});

test("a genuine other-writer conflict preserves the attempted local draft", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadSpreadsheetFromApi(initial.id);
    const other = await f.app.request("/api/spreadsheets/" + initial.id + "?space_id=A", {
      method: "PUT", headers: { "Content-Type": "application/json", "If-Match": initial.updatedAt },
      body: JSON.stringify({ ...initial, title: "Other writer" }),
    });
    expect(other.status).toBe(200);
    await expect(updateSpreadsheet({ ...initial, title: "My retained draft" })).rejects.toThrow("modified elsewhere");
    expect(getSpreadsheet(initial.id)?.title).toBe("My retained draft");
    expect((await f.store("A").getSpreadsheet(initial.id)).title).toBe("Other writer");
  } finally { await f.close(); }
});

test("sheet add, rename and remove use consecutive original revisions", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadSpreadsheetFromApi(initial.id);
    const added = addSheet(initial.id, "Second tab");await added.remote;
    expect(added.value?.name).toBe("Second tab");
    await renameSheet(initial.id, added.value!.id, "Renamed tab").remote;
    expect((await f.store("A").getSpreadsheet(initial.id)).sheets[1].name).toBe("Renamed tab");
    await deleteSheet(initial.id, added.value!.id).remote;
    expect((await f.store("A").getSpreadsheet(initial.id)).sheets).toHaveLength(1);
    expect(getSpreadsheet(initial.id)).toEqual(await f.store("A").getSpreadsheet(initial.id));
  } finally { await f.close(); }
});

test("unknown ACK retains newer edits and blocks automatic retry until explicit fresh reconciliation", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadSpreadsheetFromApi(initial.id);
    f.loseNextWrite();
    await expect(updateSpreadsheet({ ...initial, title: "Committed but unconfirmed" })).rejects.toThrow("500");
    const writes = f.calls.filter((call) => call.method === "PUT").length;
    await expect(updateSpreadsheet({ ...initial, title: "Newest retained draft" })).rejects.toThrow();
    expect(f.calls.filter((call) => call.method === "PUT")).toHaveLength(writes);
    expect(getSpreadsheet(initial.id)?.title).toBe("Newest retained draft");
    expect(getSpreadsheetSaveState(initial.id)).toBe("failed");
    await loadSpreadsheetsFromApi();
    expect(getSpreadsheet(initial.id)?.title).toBe("Newest retained draft");
    f.failNextRead();
    expect((await loadSpreadsheetFromApi(initial.id)).title).toBe("Newest retained draft");
    expect(getSpreadsheetSaveState(initial.id)).toBe("failed");
    f.failNextRead();
    await expect(loadSpreadsheetFromApi(initial.id, { discardLocal: true })).rejects.toThrow("503");
    expect(getSpreadsheet(initial.id)?.title).toBe("Newest retained draft");
    const retried = await retrySpreadsheetAfterConflict(initial.id);
    expect(retried?.title).toBe("Newest retained draft");
    expect(getSpreadsheetSaveState(initial.id)).toBe("clean");
    expect(await f.store("A").getSpreadsheet(initial.id)).toEqual(retried!);
  } finally { await f.close(); }
});

test("a stale read cannot discard an edit completed while it was in flight", async () => {
  const f = clientStoreFixture();const gate = f.holdNext("GET");let read: Promise<unknown> | undefined;
  try {
    const initial = await f.seed("A");
    read = loadSpreadsheetFromApi(initial.id);await gate.started;
    // The first read has not filled cache yet; create the legitimate canonical
    // cache with a separate successful client read, then edit through the client.
    await loadSpreadsheetFromApi(initial.id);
    const changed = await updateSpreadsheet({ ...initial, title: "Edit after read began" });
    gate.release();
    expect(await read).toEqual(changed!);
    expect(getSpreadsheet(initial.id)).toEqual(changed!);
  } finally { gate.release();await Promise.allSettled([read]);await f.close(); }
});

test("an editor writer keeps its captured A request and cache after navigating to B", async () => {
  const f = clientStoreFixture();
  try {
    const a = await f.seed("A", "A budget"), b = await f.seed("B", "B budget");
    await loadSpreadsheetFromApi(a.id);
    const writeA = captureSpreadsheetWriter(a.id);
    f.scope("B");await loadSpreadsheetFromApi(b.id);
    const before = f.values.get(workspaceStorageKey("takos-excel-spreadsheets", "B"));
    await writeA({ ...a, title: "A edit while B is visible" });
    expect(f.calls.at(-1)?.url).toContain("space_id=A");
    expect(f.values.get(workspaceStorageKey("takos-excel-spreadsheets", "B"))).toBe(before);
    expect(loadSpreadsheets()).toEqual([b]);
    f.scope("A");expect(getSpreadsheet(a.id)?.title).toBe("A edit while B is visible");
  } finally { await f.close(); }
});

test("an A 401 cannot clear or redirect the currently visible B scope", async () => {
  const f = clientStoreFixture();const gate = f.holdNext("GET");let read: Promise<unknown> | undefined;
  try {
    const a = await f.seed("A"), b = await f.seed("B");
    f.failNextRead(401);
    read = loadSpreadsheetFromApi(a.id);void read.catch(() => undefined);await gate.started;
    f.scope("B");await loadSpreadsheetFromApi(b.id);
    const before = f.values.get(workspaceStorageKey("takos-excel-spreadsheets", "B")), href = location.href;
    gate.release();await expect(read).rejects.toThrow("401");
    expect(f.values.get(workspaceStorageKey("takos-excel-spreadsheets", "A"))).toBeUndefined();
    expect(f.values.get(workspaceStorageKey("takos-excel-spreadsheets", "B"))).toBe(before);
    expect(location.href).toBe(href);
  } finally { gate.release();await Promise.allSettled([read]);await f.close(); }
});

test("clearing A retires an old pending ACK without repopulating A or touching B", async () => {
  const f = clientStoreFixture();const gate = f.holdNext("PUT");let write: Promise<unknown> | undefined;
  try {
    const a = await f.seed("A"), b = await f.seed("B");await loadSpreadsheetFromApi(a.id);
    write = updateSpreadsheet({ ...a, title: "Old pending A" });void write.catch(() => undefined);await gate.started;
    clearSpreadsheetsCache();
    f.scope("B");await loadSpreadsheetFromApi(b.id);
    const before = f.values.get(workspaceStorageKey("takos-excel-spreadsheets", "B"));
    gate.release();await write;
    expect(f.values.get(workspaceStorageKey("takos-excel-spreadsheets", "A"))).toBeUndefined();
    expect(f.values.get(workspaceStorageKey("takos-excel-spreadsheets", "B"))).toBe(before);
  } finally { gate.release();await Promise.allSettled([write]);await f.close(); }
});

test("invalid ACK cannot bless the draft or release its recovery guard", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadSpreadsheetFromApi(initial.id);
    f.malformedNextAck();
    await expect(updateSpreadsheet({ ...initial, title: "Valid local draft" })).rejects.toThrow("Invalid spreadsheet acknowledgement");
    expect(getSpreadsheet(initial.id)?.title).toBe("Valid local draft");
    expect(getSpreadsheetSaveState(initial.id)).toBe("failed");
    const writes = f.calls.filter((call) => call.method === "PUT").length;
    await expect(updateSpreadsheet({ ...initial, title: "Later draft" })).rejects.toThrow();
    expect(f.calls.filter((call) => call.method === "PUT")).toHaveLength(writes);
    const fresh = await loadSpreadsheetFromApi(initial.id, { discardLocal: true });
    expect(fresh?.title).toBe("Valid local draft");
    expect(getSpreadsheetSaveState(initial.id)).toBe("clean");
  } finally { await f.close(); }
});

test("explicit replacement still loses a genuine CAS race after its fresh read", async () => {
  const f = clientStoreFixture();let retried: Promise<unknown> | undefined;
  try {
    const initial = await f.seed("A");await loadSpreadsheetFromApi(initial.id);
    f.loseNextWrite();await expect(updateSpreadsheet({ ...initial, title: "Retained" })).rejects.toThrow();
    const gate = f.holdNext("GET");
    retried = retrySpreadsheetAfterConflict(initial.id);void retried.catch(() => undefined);await gate.started;
    const current = await f.store("A").getSpreadsheet(initial.id);
    const other = await f.app.request("/api/spreadsheets/" + initial.id + "?space_id=A", {
      method: "PUT", headers: { "Content-Type": "application/json", "If-Match": current.updatedAt },
      body: JSON.stringify({ ...current, title: "Concurrent replacement" }),
    });
    expect(other.status).toBe(200);gate.release();await expect(retried).rejects.toThrow("modified elsewhere");
    expect(getSpreadsheet(initial.id)?.title).toBe("Retained");
    expect(getSpreadsheetSaveState(initial.id)).toBe("conflict");
    expect((await f.store("A").getSpreadsheet(initial.id)).title).toBe("Concurrent replacement");
  } finally { await f.close(); }
});

test("a known deleted record cannot be recreated by replacement; explicit discard adopts fresh404", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadSpreadsheetFromApi(initial.id);
    f.loseNextWrite();await expect(updateSpreadsheet({ ...initial, title: "Retained" })).rejects.toThrow();
    const current = await f.store("A").getSpreadsheet(initial.id);
    const removed = await f.app.request("/api/spreadsheets/" + initial.id + "?space_id=A", {
      method: "DELETE", headers: { "If-Match": current.updatedAt },
    });
    expect(removed.status).toBe(200);
    expect((await loadSpreadsheetFromApi(initial.id)).title).toBe("Retained");
    const writes = f.calls.filter((call) => call.method === "PUT").length;
    await expect(retrySpreadsheetAfterConflict(initial.id)).rejects.toThrow("404");
    expect(f.calls.filter((call) => call.method === "PUT")).toHaveLength(writes);
    expect(await loadSpreadsheetFromApi(initial.id, { discardLocal: true })).toBeNull();
    expect(getSpreadsheet(initial.id)).toBeUndefined();
  } finally { await f.close(); }
});

test("a never-acknowledged create is retried with the same id and create-only condition after fresh404", async () => {
  const f = clientStoreFixture();
  try {
    f.failNextWriteBeforeCommit();
    const created = createSpreadsheet("Unsent create");
    await expect(created.remote).rejects.toThrow("500");
    expect(getSpreadsheetSaveState(created.value.id)).toBe("failed");
    const retried = await retrySpreadsheetAfterConflict(created.value.id);
    expect(retried?.id).toBe(created.value.id);
    expect((await f.store("A").listSpreadsheets()).map((record) => record.id)).toEqual([created.value.id]);
    expect(getSpreadsheetSaveState(created.value.id)).toBe("clean");
  } finally { await f.close(); }
});

test("deletion uses the original revision, retains cache on conflict, and refuses pending drafts", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadSpreadsheetFromApi(initial.id);
    const other = await f.app.request("/api/spreadsheets/" + initial.id + "?space_id=A", {
      method: "PUT", headers: { "Content-Type": "application/json", "If-Match": initial.updatedAt },
      body: JSON.stringify({ ...initial, title: "Other writer" }),
    });
    expect(other.status).toBe(200);
    await expect(deleteSpreadsheet(initial.id)).rejects.toThrow("409");
    expect(getSpreadsheet(initial.id)).toEqual(initial);
    expect(f.calls.at(-1)?.revision).toBe(initial.updatedAt);
    await loadSpreadsheetFromApi(initial.id);
    f.loseNextWrite();await expect(updateSpreadsheet({ ...getSpreadsheet(initial.id)!, title: "Unconfirmed" })).rejects.toThrow();
    const deletes = f.calls.filter((call) => call.method === "DELETE").length;
    await expect(deleteSpreadsheet(initial.id)).rejects.toThrow("Resolve unsaved changes");
    expect(f.calls.filter((call) => call.method === "DELETE")).toHaveLength(deletes);
    await loadSpreadsheetFromApi(initial.id, { discardLocal: true });
    await deleteSpreadsheet(initial.id);
    expect(getSpreadsheet(initial.id)).toBeUndefined();
    expect(await f.store("A").listSpreadsheets()).toEqual([]);
  } finally { await f.close(); }
});

test("a matching id and timestamp cannot bless malformed nested ACK data", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadSpreadsheetFromApi(initial.id);
    f.malformedNestedAck();
    await expect(updateSpreadsheet({ ...initial, title: "Retained complete sheet" })).rejects.toThrow("Invalid spreadsheet acknowledgement");
    expect(getSpreadsheet(initial.id)?.sheets).toEqual(initial.sheets);
    expect(getSpreadsheetSaveState(initial.id)).toBe("failed");
  } finally { await f.close(); }
});

test("a canonical deleted:false response cannot remove the local row", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadSpreadsheetFromApi(initial.id);
    f.failNextObjectDelete();
    await expect(deleteSpreadsheet(initial.id)).rejects.toThrow("Deletion was not confirmed");
    expect(getSpreadsheet(initial.id)).toEqual(initial);
    expect(await f.store("A").getSpreadsheet(initial.id)).toEqual(initial);
    expect(f.calls.at(-1)?.status).toBe(200);
    await deleteSpreadsheet(initial.id);
    expect(getSpreadsheet(initial.id)).toBeUndefined();
    expect(await f.store("A").listSpreadsheets()).toEqual([]);
  } finally { await f.close(); }
});


for (const status of [200, 401]) {
  test(`retired sheet library read cannot restore a deleted item or clear reopened cache after ${status}`, async () => {
    const f = clientStoreFixture();
    let pending: Promise<unknown> | undefined;
    try {
      const initial = await f.seed("A");
      await loadSpreadsheetsFromApi();
      if (status === 401) f.failNextRead(401);
      const held = f.holdNext("GET");
      let active = true;
      pending = loadSpreadsheetsFromApi({ isActive: () => active }).catch((error) => error);
      await held.started;
      active = false;
      f.scope("B");
      await f.seed("B");
      await loadSpreadsheetsFromApi();
      const keyB = "takos-excel-spreadsheets:workspace:B", beforeB = f.values.get(keyB);
      f.scope("A");
      await loadSpreadsheetsFromApi({ isActive: () => true });
      await updateSpreadsheet({ ...getSpreadsheet(initial.id)!, title: "First save" });
      const firstAck = getSpreadsheet(initial.id)!;
      await loadSpreadsheetFromApi(initial.id);
      await updateSpreadsheet({ ...getSpreadsheet(initial.id)!, title: "Second save" });
      expect(f.calls.filter((entry) => entry.method === "PUT")[1].revision).toBe(firstAck.updatedAt);
      await deleteSpreadsheet(initial.id);
      expect(getSpreadsheet(initial.id)).toBeUndefined();
      const before = [...f.values.entries()], href = location.href;
      held.release();
      const outcome = await pending;
      expect([...f.values.entries()]).toEqual(before);
      expect(outcome).toBeInstanceOf(Error);
      expect(f.values.get(keyB)).toBe(beforeB);
      expect(location.href).toBe(href);
      expect(await loadSpreadsheetsFromApi()).toEqual([]);
      expect(f.calls.filter((entry) => entry.method === "DELETE").map((entry) => entry.status)).toEqual([200]);
    } finally { await f.close(); await pending; }
  });
}

test("current sheet library401 still invalidates its unconfirmed journal", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");
    await loadSpreadsheetFromApi(initial.id);
    f.loseNextWrite();
    await expect(updateSpreadsheet({ ...initial, title: "Unconfirmed" })).rejects.toThrow();
    expect(getSpreadsheetSaveState(initial.id)).toBe("failed");
    f.failNextRead(401);
    await expect(loadSpreadsheetsFromApi({ isActive: () => true })).rejects.toThrow();
    expect(f.values.get("takos-excel-spreadsheets:workspace:A")).toBeUndefined();
    expect(f.values.get("takos-excel-spreadsheets:workspace:A:pending-writes")).toBeUndefined();
    expect(getSpreadsheetSaveState(initial.id)).toBe("clean");
  } finally { await f.close(); }
});


test("cancelled sheet recovery refuses its queued PUT and retains a fresh explicit retry", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");
    await loadSpreadsheetFromApi(initial.id);
    f.loseNextWrite();
    await expect(updateSpreadsheet({ ...initial, title: "Retained replacement" })).rejects.toThrow();
    const draft = JSON.stringify(getSpreadsheet(initial.id));
    const current = await f.store("A").getSpreadsheet(initial.id);
    const writes = f.calls.filter((call) => call.method === "PUT").length;
    const controller = new AbortController();
    const set = localStorage.setItem.bind(localStorage);
    let cancelledBeforeDispatch = false;
    // Select one legal microtask interleaving after recovery queues intent,
    // before its deferred write callback. This hook is not an auth event.
    localStorage.setItem = (key, value) => {
      set(key, value);
      if (key.endsWith(":pending-writes") && JSON.parse(value)[initial.id]?.state === "pending") {
        queueMicrotask(() => {
          cancelledBeforeDispatch = f.calls.filter((call) => call.method === "PUT").length === writes;
          controller.abort();
        });
      }
    };
    const outcome = await retrySpreadsheetAfterConflict(initial.id, { signal: controller.signal }).catch((error) => error);
    localStorage.setItem = set;
    expect(cancelledBeforeDispatch).toBe(true);
    expect(outcome).toMatchObject({ name: "AbortError" });
    expect(f.calls.filter((call) => call.method === "PUT")).toHaveLength(writes);
    expect(JSON.stringify(getSpreadsheet(initial.id))).toBe(draft);
    expect(getSpreadsheetSaveState(initial.id)).toBe("failed");
    const pending = JSON.parse(f.values.get("takos-excel-spreadsheets:workspace:A:pending-writes")!)[initial.id];
    expect(pending.revision).toBe(current?.updatedAt);
    expect((await f.store("A").getSpreadsheet(initial.id))?.updatedAt).toBe(current?.updatedAt);
    const ack = await retrySpreadsheetAfterConflict(initial.id);
    expect(ack?.title).toBe("Retained replacement");
    expect(f.calls.filter((call) => call.method === "PUT")).toHaveLength(writes + 1);
    expect(f.calls.filter((call) => call.method === "PUT")[writes].revision).toBe(current?.updatedAt);
    expect(getSpreadsheetSaveState(initial.id)).toBe("clean");
  } finally { await f.close(); }
});

test("sheet recovery cancellation after committed PUT retains the actual ACK", async () => {
  const f = clientStoreFixture();
  let pending: Promise<unknown> | undefined;
  try {
    const initial = await f.seed("A");
    await loadSpreadsheetFromApi(initial.id);
    f.loseNextWrite();
    await expect(updateSpreadsheet({ ...initial, title: "Already dispatched" })).rejects.toThrow();
    const writes = f.calls.filter((call) => call.method === "PUT").length;
    const held = f.holdNext("PUT"), controller = new AbortController();
    pending = retrySpreadsheetAfterConflict(initial.id, { signal: controller.signal });
    await held.started;
    // The fixture's route/store has already committed; only the ACK is held.
    controller.abort();
    held.release();
    const ack = await pending as Awaited<ReturnType<typeof retrySpreadsheetAfterConflict>>;
    expect(f.calls.filter((call) => call.method === "PUT")).toHaveLength(writes + 1);
    expect(ack?.title).toBe("Already dispatched");
    expect(getSpreadsheet(initial.id)).toEqual(ack!);
    expect(await f.store("A").getSpreadsheet(initial.id)).toEqual(ack!);
    expect(getSpreadsheetSaveState(initial.id)).toBe("clean");
  } finally { await f.close(); await pending; }
});
