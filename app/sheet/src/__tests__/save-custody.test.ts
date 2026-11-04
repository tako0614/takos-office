import { expect, test } from "bun:test";
import {
  addSheet, deleteSheet, getSpreadsheet, loadSpreadsheetFromApi,
  loadSpreadsheets, loadSpreadsheetsFromApi, renameSheet, updateSpreadsheet,
  getSpreadsheetSaveState, retrySpreadsheetAfterConflict, deleteSpreadsheet,
  captureSpreadsheetWriter, clearSpreadsheetsCache, createSpreadsheet,
} from "../lib/storage.ts";
import { workspaceStorageKey } from "../../../shared/lib/space-id.ts";
import { clientStoreFixture } from "./save-custody-fixture.ts";

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
