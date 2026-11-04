import { currentWorkspaceId, workspaceStorageKey } from "./space-id.ts";

type ReceiptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Browser-only create uncertainty; never an authorization or server revision. */
export function captureCreateReceipt(
  namespace: string,
  workspaceId = currentWorkspaceId(),
  storage?: ReceiptStorage,
) {
  const key = workspaceStorageKey(namespace, workspaceId);
  const currentStorage = () => storage ?? globalThis.localStorage;
  return Object.freeze({
    key,
    current: () => currentStorage().getItem(key),
    begin: () => {
      const token = crypto.randomUUID();
      currentStorage().setItem(key, token);
      return token;
    },
    acknowledge: (expected: string | null) => {
      const target = currentStorage();
      if (target.getItem(key) !== expected) return false;
      target.removeItem(key);
      return true;
    },
  });
}
