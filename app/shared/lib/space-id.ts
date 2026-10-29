/**
 * Carry the active Workspace across the office editors.
 *
 * The space id arrives as `space_id` (or camelCase `spaceId`) on the current
 * URL. Mirror it onto a path so cross-app navigation and same-origin API calls
 * stay inside the same Workspace. Returns the path unchanged when there is no
 * space id (or no `location`, e.g. under bun test / SSR).
 */
export function withCurrentSpaceId(path: string): string {
  return withWorkspaceId(path, currentWorkspaceId());
}

/** Keep an asynchronous operation tied to its captured Workspace. */
export function withWorkspaceId(
  path: string,
  workspaceId: string | null,
  origin = globalThis.location?.origin,
): string {
  if (!workspaceId) return path;
  const url = new URL(path, origin);
  url.searchParams.set("space_id", workspaceId);
  return `${url.pathname}${url.search}`;
}

export function currentWorkspaceId(): string | null {
  const query = globalThis.location
    ? new URLSearchParams(globalThis.location.search)
    : null;
  const value = query?.get("space_id") ?? query?.get("spaceId");
  return value && value.trim() ? value : null;
}

export function workspaceStorageKey(
  baseKey: string,
  workspaceId = currentWorkspaceId(),
): string {
  return workspaceId
    ? `${baseKey}:workspace:${encodeURIComponent(workspaceId)}`
    : baseKey;
}
