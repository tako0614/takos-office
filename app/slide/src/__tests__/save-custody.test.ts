import { expect, test } from "bun:test";
import { getPresentation, loadPresentationFromApi, loadPresentations, loadPresentationsFromApi, savePresentation, capturePresentationWriter, getPresentationSaveState, retryPresentationAfterConflict, clearPresentationsCache, createPresentation, deletePresentation } from "../lib/storage.ts";
import { clientStoreFixture } from "./save-custody-fixture.ts";

test("consecutive same-writer saves use the actual server ACK revision", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");
    await loadPresentationFromApi(initial.id);
    await savePresentation({ ...initial, title: "First edit" }).remote;
    const first = await (await f.read("A", initial.id)).json();
    await savePresentation({ ...getPresentation(initial.id)!, title: "Second edit" }).remote;
    const stored = await (await f.read("A", initial.id)).json();
    expect(f.calls.filter((call) => call.method === "PUT").map((call) => call.status)).toEqual([200, 200]);
    expect(f.calls.filter((call) => call.method === "PUT")[1].revision).toBe(first.updatedAt);
    expect(stored.title).toBe("Second edit");
    expect(getPresentation(initial.id)).toEqual(stored);
  } finally { await f.close(); }
});

test("overlapping drafts serialize against ACKs and retain the newest snapshot", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadPresentationFromApi(initial.id);
    const held = f.holdNext("PUT");
    const first = savePresentation({ ...initial, title: "First draft" }).remote;
    await held.started;
    const second = savePresentation({ ...initial, title: "Newest draft" }).remote;
    expect(f.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
    expect(getPresentation(initial.id)?.title).toBe("Newest draft");
    held.release();await Promise.all([first, second]);
    expect(getPresentation(initial.id)).toEqual(await (await f.read("A", initial.id)).json());
    expect(getPresentation(initial.id)?.title).toBe("Newest draft");
  } finally { await f.close(); }
});

async function otherWrite(f: ReturnType<typeof clientStoreFixture>, id: string, title: string) {
  const current = await (await f.read("A", id)).json();
  const response = await f.app.request("/api/presentations/" + id + "?space_id=A", {
    method: "PUT", headers: { "Content-Type": "application/json", "If-Match": current.updatedAt }, body: JSON.stringify({ ...current, title }),
  });
  expect(response.status).toBe(200);
  return response.json();
}

test("true other-writer409 retains the local draft and needs explicit conditional recovery", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadPresentationFromApi(initial.id);
    await otherWrite(f, initial.id, "Other writer");
    await expect(savePresentation({ ...initial, title: "My retained draft" }).remote).rejects.toThrow("modified elsewhere");
    expect(getPresentation(initial.id)?.title).toBe("My retained draft");
    expect((await (await f.read("A", initial.id)).json()).title).toBe("Other writer");
    expect(getPresentationSaveState(initial.id)).toBe("conflict");
    const writes = f.calls.filter((call) => call.method === "PUT").length;
    await expect(savePresentation({ ...initial, title: "Newer local draft" }).remote).rejects.toThrow();
    expect(f.calls.filter((call) => call.method === "PUT")).toHaveLength(writes);
    const recovered = await retryPresentationAfterConflict(initial.id);
    expect(recovered?.title).toBe("Newer local draft");
    expect(recovered).toEqual(await (await f.read("A", initial.id)).json());
    expect(getPresentationSaveState(initial.id)).toBe("clean");
  } finally { await f.close(); }
});

test("unknown commit survives module reload without replay and retains newer typing", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadPresentationFromApi(initial.id);
    f.loseNextWrite();
    await expect(savePresentation({ ...initial, title: "Unconfirmed commit" }).remote).rejects.toThrow("500");
    const restored: typeof import("../lib/storage.ts") = await import("../lib/storage.ts?custody-reload-" + crypto.randomUUID());
    expect(restored.getPresentationSaveState(initial.id)).toBe("failed");
    const writes = f.calls.filter((call) => call.method === "PUT").length;
    await expect(restored.savePresentation({ ...initial, title: "Later retained typing" }).remote).rejects.toThrow();
    expect(f.calls.filter((call) => call.method === "PUT")).toHaveLength(writes);
    await restored.loadPresentationsFromApi();
    expect(restored.getPresentation(initial.id)?.title).toBe("Later retained typing");
    f.failNextRead();
    expect((await restored.loadPresentationFromApi(initial.id)).title).toBe("Later retained typing");
    f.failNextRead();
    await expect(restored.loadPresentationFromApi(initial.id, { discardLocal: true })).rejects.toThrow("503");
    expect((await restored.retryPresentationAfterConflict(initial.id))?.title).toBe("Later retained typing");
    expect(restored.getPresentationSaveState(initial.id)).toBe("clean");
  } finally { await f.close(); }
});

test("an old read cannot overwrite an edit made while the read was held", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");
    const held = f.holdNext("GET"), pending = loadPresentationFromApi(initial.id);await held.started;
    await loadPresentationFromApi(initial.id);
    const acknowledged = await savePresentation({ ...initial, title: "Edited during read" }).remote;
    held.release();
    expect(await pending).toEqual(acknowledged);
    expect(getPresentation(initial.id)).toEqual(acknowledged);
  } finally { await f.close(); }
});

test("captured A writer and delayed A401 cannot write, clear or redirect B", async () => {
  const f = clientStoreFixture();
  try {
    const a = await f.seed("A"), b = await f.seed("B", "B deck");await loadPresentationFromApi(a.id);
    const writer = capturePresentationWriter(a.id);
    f.failNextRead(401);const held = f.holdNext("GET"), reading = loadPresentationFromApi(a.id);void reading.catch(() => undefined);await held.started;
    f.scope("B");await loadPresentationFromApi(b.id);
    const before = f.values.get("takos-slide-presentations:workspace:B"), href = location.href;
    await writer({ ...a, title: "Captured A edit" }).remote;
    expect(f.calls.at(-1)?.url).toContain("space_id=A");
    expect(f.values.get("takos-slide-presentations:workspace:B")).toBe(before);
    held.release();await expect(reading).rejects.toThrow("401");
    expect(f.values.get("takos-slide-presentations:workspace:A")).toBeUndefined();
    expect(f.values.get("takos-slide-presentations:workspace:B")).toBe(before);
    expect(location.href).toBe(href);
  } finally { await f.close(); }
});

test("clearing a scope retires its pending ACK without repopulating the cache", async () => {
  const f = clientStoreFixture();
  try {
    const a = await f.seed("A"), b = await f.seed("B");await loadPresentationFromApi(a.id);
    const held = f.holdNext("PUT"), writing = savePresentation({ ...a, title: "Old A" }).remote;await held.started;
    clearPresentationsCache();f.scope("B");await loadPresentationFromApi(b.id);
    const before = f.values.get("takos-slide-presentations:workspace:B");
    held.release();await writing;
    expect(f.values.get("takos-slide-presentations:workspace:A")).toBeUndefined();
    expect(f.values.get("takos-slide-presentations:workspace:B")).toBe(before);
  } finally { await f.close(); }
});

test("invalid ACK does not bless or automatically replay the retained draft", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadPresentationFromApi(initial.id);f.malformedNextAck();
    await expect(savePresentation({ ...initial, title: "Complete retained draft" }).remote).rejects.toThrow("Invalid presentation acknowledgement");
    expect(getPresentation(initial.id)?.title).toBe("Complete retained draft");
    expect(getPresentationSaveState(initial.id)).toBe("failed");
    const writes = f.calls.filter((call) => call.method === "PUT").length;
    await expect(savePresentation({ ...initial, title: "Later draft" }).remote).rejects.toThrow();
    expect(f.calls.filter((call) => call.method === "PUT")).toHaveLength(writes);
    const recovered = await loadPresentationFromApi(initial.id, { discardLocal: true });
    expect(recovered?.title).toBe("Complete retained draft");
    expect(getPresentationSaveState(initial.id)).toBe("clean");
  } finally { await f.close(); }
});

test("explicit replacement still loses a real CAS race after its fresh read", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadPresentationFromApi(initial.id);f.loseNextWrite();
    await expect(savePresentation({ ...initial, title: "Retained draft" }).remote).rejects.toThrow();
    const held = f.holdNext("GET"), retry = retryPresentationAfterConflict(initial.id);void retry.catch(() => undefined);await held.started;
    await otherWrite(f, initial.id, "Concurrent replacement");held.release();
    await expect(retry).rejects.toThrow("modified elsewhere");
    expect((await (await f.read("A", initial.id)).json()).title).toBe("Concurrent replacement");
    expect(getPresentation(initial.id)?.title).toBe("Retained draft");
    expect(getPresentationSaveState(initial.id)).toBe("conflict");
  } finally { await f.close(); }
});

test("known deleted documents cannot be recreated by retry; explicit discard accepts404", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadPresentationFromApi(initial.id);f.loseNextWrite();
    await expect(savePresentation({ ...initial, title: "Retained draft" }).remote).rejects.toThrow();
    const current = await (await f.read("A", initial.id)).json();
    const deleted = await f.app.request("/api/presentations/" + initial.id + "?space_id=A", { method: "DELETE", headers: { "If-Match": current.updatedAt } });
    expect(deleted.status).toBe(200);
    expect((await loadPresentationFromApi(initial.id)).title).toBe("Retained draft");
    const writes = f.calls.filter((call) => call.method === "PUT").length;
    await expect(retryPresentationAfterConflict(initial.id)).rejects.toThrow("404");
    expect(f.calls.filter((call) => call.method === "PUT")).toHaveLength(writes);
    expect(await loadPresentationFromApi(initial.id, { discardLocal: true })).toBeNull();
    expect(getPresentation(initial.id)).toBeUndefined();
  } finally { await f.close(); }
});

test("unacknowledged create keeps its id and retries create-only after fresh404", async () => {
  const f = clientStoreFixture();
  try {
    const created = createPresentation("Unsent create");f.failNextWriteBeforeCommit();
    await expect(savePresentation(created).remote).rejects.toThrow("500");
    expect(getPresentationSaveState(created.id)).toBe("failed");
    const saved = await retryPresentationAfterConflict(created.id);
    expect(saved?.id).toBe(created.id);
    expect(f.calls.filter((call) => call.method === "PUT").every((call) => call.revision === null)).toBe(true);
    expect(saved).toEqual(await (await f.read("A", created.id)).json());
    expect(getPresentationSaveState(created.id)).toBe("clean");
  } finally { await f.close(); }
});

test("deletion preserves the row on409 or backend failure and refuses unsaved drafts", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadPresentationFromApi(initial.id);
    await otherWrite(f, initial.id, "Other writer");
    await expect(deletePresentation(initial.id)).rejects.toThrow("409");
    expect(getPresentation(initial.id)).toEqual(initial);
    expect(f.calls.at(-1)?.revision).toBe(initial.updatedAt);
    const latest = await loadPresentationFromApi(initial.id);f.loseNextWrite();
    await expect(savePresentation({ ...latest, title: "Unconfirmed" }).remote).rejects.toThrow();
    const deletes = f.calls.filter((call) => call.method === "DELETE").length;
    await expect(deletePresentation(initial.id)).rejects.toThrow("Resolve unsaved changes");
    expect(f.calls.filter((call) => call.method === "DELETE")).toHaveLength(deletes);
    await loadPresentationFromApi(initial.id, { discardLocal: true });
    f.failNextObjectDelete();await expect(deletePresentation(initial.id)).rejects.toThrow("500");
    expect(getPresentation(initial.id)?.title).toBe("Unconfirmed");
    expect((await f.read("A", initial.id)).status).toBe(200);
    await deletePresentation(initial.id);
    expect(getPresentation(initial.id)).toBeUndefined();
    expect((await f.read("A", initial.id)).status).toBe(404);
  } finally { await f.close(); }
});

test("a200 deleted:false cannot silently remove the original library row", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadPresentationFromApi(initial.id);
    await f.app.request("/api/presentations/" + initial.id + "?space_id=A", { method: "DELETE", headers: { "If-Match": initial.updatedAt } });
    await expect(deletePresentation(initial.id)).rejects.toThrow("Deletion was not confirmed");
    expect(getPresentation(initial.id)).toEqual(initial);
    expect(f.calls.at(-1)?.status).toBe(200);
    await loadPresentationsFromApi();expect(getPresentation(initial.id)).toBeUndefined();
  } finally { await f.close(); }
});

test("normal client create is create-only then updates against its actual ACK", async () => {
  const f = clientStoreFixture();
  try {
    const initial = createPresentation("New deck");
    const created = await savePresentation(initial).remote;
    expect(created.id).toBe(initial.id);
    expect(getPresentation(initial.id)).toEqual(created);
    const changed = await savePresentation({ ...created, title: "Updated new deck" }).remote;
    expect(changed.title).toBe("Updated new deck");
    expect(f.calls.filter((call) => call.method === "PUT").map((call) => call.revision)).toEqual([null, created.updatedAt]);
    expect(changed).toEqual(await (await f.read("A", initial.id)).json());
  } finally { await f.close(); }
});

test("a held explicit discard does not discard newer typing or automatically write it", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadPresentationFromApi(initial.id);f.loseNextWrite();
    await expect(savePresentation({ ...initial, title: "Unconfirmed" }).remote).rejects.toThrow();
    const held = f.holdNext("GET"), discard = loadPresentationFromApi(initial.id, { discardLocal: true });await held.started;
    const writes = f.calls.filter((call) => call.method === "PUT").length;
    await expect(savePresentation({ ...initial, title: "Typed during discard" }).remote).rejects.toThrow();
    held.release();
    expect((await discard)?.title).toBe("Typed during discard");
    expect(getPresentationSaveState(initial.id)).toBe("failed");
    expect(f.calls.filter((call) => call.method === "PUT")).toHaveLength(writes);
    expect((await (await f.read("A", initial.id)).json()).title).toBe("Unconfirmed");
  } finally { await f.close(); }
});

test("a delayed A library response cannot replace the current B library", async () => {
  const f = clientStoreFixture();
  try {
    await f.seed("A", "A deck");await f.seed("B", "B deck");
    const held = f.holdNext("GET"), reading = loadPresentationsFromApi();await held.started;
    f.scope("B");await loadPresentationsFromApi();
    const before = f.values.get("takos-slide-presentations:workspace:B");
    held.release();expect((await reading).map((item) => item.title)).toEqual(["A deck"]);
    expect(f.values.get("takos-slide-presentations:workspace:B")).toBe(before);
    expect(loadPresentations().map((item) => item.title)).toEqual(["B deck"]);
  } finally { await f.close(); }
});

test("a delayed A GET returns A while B cache stays byte-exact", async () => {
  const f = clientStoreFixture();
  try {
    const a = await f.seed("A", "A deck");await f.seed("B", "B deck");
    const held = f.holdNext("GET"), reading = loadPresentationFromApi(a.id);
    await held.started;
    f.scope("B");await loadPresentationsFromApi();
    const before = f.values.get("takos-slide-presentations:workspace:B");
    held.release();
    expect((await reading).title).toBe("A deck");
    expect(f.values.get("takos-slide-presentations:workspace:B")).toBe(before);
    expect(loadPresentations().map((record) => record.title)).toEqual(["B deck"]);
    expect(JSON.parse(f.values.get("takos-slide-presentations:workspace:A")!)[0].id).toBe(a.id);
  } finally { await f.close(); }
});


for (const status of [200, 401]) {
  test(`retired slide library read cannot restore a deleted item or clear reopened cache after ${status}`, async () => {
    const f = clientStoreFixture();
    let pending: Promise<unknown> | undefined;
    try {
      const initial = await f.seed("A");
      await loadPresentationsFromApi();
      if (status === 401) f.failNextRead(401);
      const held = f.holdNext("GET");
      let active = true;
      pending = loadPresentationsFromApi({ isActive: () => active }).catch((error) => error);
      await held.started;
      active = false;
      f.scope("B");
      await f.seed("B");
      await loadPresentationsFromApi();
      const keyB = "takos-slide-presentations:workspace:B", beforeB = f.values.get(keyB);
      f.scope("A");
      await loadPresentationsFromApi({ isActive: () => true });
      await savePresentation({ ...getPresentation(initial.id)!, title: "First save" }).remote;
      const firstAck = getPresentation(initial.id)!;
      await loadPresentationFromApi(initial.id);
      await savePresentation({ ...getPresentation(initial.id)!, title: "Second save" }).remote;
      expect(f.calls.filter((entry) => entry.method === "PUT")[1].revision).toBe(firstAck.updatedAt);
      await deletePresentation(initial.id);
      expect(getPresentation(initial.id)).toBeUndefined();
      const before = [...f.values.entries()], href = location.href;
      held.release();
      const outcome = await pending;
      expect([...f.values.entries()]).toEqual(before);
      expect(outcome).toBeInstanceOf(Error);
      expect(f.values.get(keyB)).toBe(beforeB);
      expect(location.href).toBe(href);
      expect(await loadPresentationsFromApi()).toEqual([]);
      expect(f.calls.filter((entry) => entry.method === "DELETE").map((entry) => entry.status)).toEqual([200]);
    } finally { await f.close(); await pending; }
  });
}

test("current slide library401 still invalidates its unconfirmed journal", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");
    await loadPresentationFromApi(initial.id);
    f.loseNextWrite();
    await expect(savePresentation({ ...initial, title: "Unconfirmed" }).remote).rejects.toThrow();
    expect(getPresentationSaveState(initial.id)).toBe("failed");
    f.failNextRead(401);
    await expect(loadPresentationsFromApi({ isActive: () => true })).rejects.toThrow();
    expect(f.values.get("takos-slide-presentations:workspace:A")).toBeUndefined();
    expect(f.values.get("takos-slide-presentations:workspace:A:pending-writes")).toBeUndefined();
    expect(getPresentationSaveState(initial.id)).toBe("clean");
  } finally { await f.close(); }
});


test("cancelled Slides recovery refuses queued PUT and retains an explicit fresh retry", async () => {
  const f = clientStoreFixture();
  try {
    const initial = await f.seed("A");await loadPresentationFromApi(initial.id);f.loseNextWrite();
    await expect(savePresentation({...initial,title:"Retained deck draft"}).remote).rejects.toThrow();
    const draft = JSON.stringify(getPresentation(initial.id)), current = await(await f.read("A",initial.id)).json();
    const writes = f.calls.filter((call)=>call.method==="PUT").length, controller = new AbortController();
    const set = localStorage.setItem.bind(localStorage);let cancelledBeforeDispatch = false;
    localStorage.setItem = (key,value) => {
      set(key,value);
      if(key.endsWith(":pending-writes") && JSON.parse(value)[initial.id]?.state==="pending") queueMicrotask(()=>{
        cancelledBeforeDispatch = f.calls.filter((call)=>call.method==="PUT").length===writes;controller.abort();
      });
    };
    const outcome = await retryPresentationAfterConflict(initial.id,{signal:controller.signal}).catch((error)=>error);localStorage.setItem = set;
    expect(cancelledBeforeDispatch).toBe(true);expect(outcome).toMatchObject({name:"AbortError"});
    expect(f.calls.filter((call)=>call.method==="PUT")).toHaveLength(writes);expect(JSON.stringify(getPresentation(initial.id))).toBe(draft);expect(getPresentationSaveState(initial.id)).toBe("failed");
    expect(JSON.parse(f.values.get("takos-slide-presentations:workspace:A:pending-writes")!)[initial.id].revision).toBe(current.updatedAt);
    expect((await(await f.read("A",initial.id)).json()).updatedAt).toBe(current.updatedAt);
    const ack = await retryPresentationAfterConflict(initial.id);
    expect(ack?.title).toBe("Retained deck draft");expect(f.calls.filter((call)=>call.method==="PUT")).toHaveLength(writes+1);
    expect(f.calls.filter((call)=>call.method==="PUT")[writes].revision).toBe(current.updatedAt);expect(getPresentationSaveState(initial.id)).toBe("clean");
  } finally {await f.close();}
});

test("Slides recovery cancellation after committed PUT preserves actual ACK", async () => {
  const f = clientStoreFixture();let pending: ReturnType<typeof retryPresentationAfterConflict> | undefined, release = () => {};
  try {
    const initial = await f.seed("A");await loadPresentationFromApi(initial.id);f.loseNextWrite();
    await expect(savePresentation({...initial,title:"Already committed deck"}).remote).rejects.toThrow();
    const writes = f.calls.filter((call)=>call.method==="PUT").length, held = f.holdNext("PUT"), controller = new AbortController();release = held.release;
    pending = retryPresentationAfterConflict(initial.id,{signal:controller.signal});await held.started;controller.abort();held.release();const ack = await pending;
    expect(f.calls.filter((call)=>call.method==="PUT")).toHaveLength(writes+1);expect(ack?.title).toBe("Already committed deck");
    expect(getPresentation(initial.id)).toEqual(ack!);expect(await(await f.read("A",initial.id)).json()).toEqual(ack!);expect(getPresentationSaveState(initial.id)).toBe("clean");
  } finally {release();await pending?.catch(()=>undefined);await f.close();}
});
