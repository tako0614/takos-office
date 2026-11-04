import { expect, test } from "bun:test";
import { captureCreateReceipt } from "../shared/lib/create-receipt.ts";

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  };
}

test("create uncertainty belongs to its Workspace and survives a new receiver", () => {
  const storage = memoryStorage();
  const first = captureCreateReceipt("create-test", "A", storage);
  const token = first.begin();
  expect(captureCreateReceipt("create-test", "B", storage).current()).toBeNull();
  const remounted = captureCreateReceipt("create-test", "A", storage);
  expect(remounted.current()).toBe(token);
  expect(remounted.acknowledge(token)).toBe(true);
  expect(first.current()).toBeNull();
});

test("an old ACK cannot clear a newer create receipt", () => {
  const receipt = captureCreateReceipt("create-test", "A", memoryStorage());
  const first = receipt.begin();
  const second = receipt.begin();
  expect(receipt.acknowledge(first)).toBe(false);
  expect(receipt.current()).toBe(second);
  expect(receipt.acknowledge(second)).toBe(true);
});

test("a library read started before creation cannot clear its later receipt", () => {
  const receipt = captureCreateReceipt("create-test", "A", memoryStorage());
  const snapshot = receipt.current();
  const token = receipt.begin();
  expect(receipt.acknowledge(snapshot)).toBe(false);
  expect(receipt.current()).toBe(token);
});

test("receipt storage failure surfaces before dispatch", () => {
  const storage = memoryStorage();
  const receipt = captureCreateReceipt("create-test", "A", {
    ...storage,
    setItem: () => { throw new Error("storage unavailable"); },
  });
  expect(() => receipt.begin()).toThrow("storage unavailable");
  expect(storage.getItem(receipt.key)).toBeNull();
});
