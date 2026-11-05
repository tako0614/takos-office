import type { RequireAppAuthOptions } from "./app-auth.ts";
import type { ObjectStorageFetch } from "./lib/takos-storage.ts";

/** Explicit server-side HTTP dependencies; normal runtimes use native fetch. */
export type OfficeServerFetchOptions = {
  appUserInfoFetch?: RequireAppAuthOptions["fetchImpl"];
  storageFetch?: ObjectStorageFetch;
};
