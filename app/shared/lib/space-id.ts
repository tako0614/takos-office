/**
 * Carry the active Workspace across the office editors.
 *
 * The space id arrives as `space_id` (or camelCase `spaceId`) on the current
 * URL. Mirror it onto a path so cross-app navigation and same-origin API calls
 * stay inside the same Workspace. Returns the path unchanged when there is no
 * space id (or no `location`, e.g. under bun test / SSR).
 */
export function withCurrentSpaceId(path: string): string {
  const spaceId = currentWorkspaceId();
  if (!spaceId) return path;
  const url = new URL(path, globalThis.location.origin);
  url.searchParams.set("space_id", spaceId);
  return `${url.pathname}${url.search}`;
}

export function currentWorkspaceId(): string | null {
  const query = globalThis.location
    ? new URLSearchParams(globalThis.location.search)
    : null;
  const value = query?.get("space_id") ?? query?.get("spaceId");
  return value && value.trim() ? value : null;
}

export function workspaceStorageKey(baseKey: string): string {
  const workspaceId = currentWorkspaceId();
  return workspaceId
    ? `${baseKey}:workspace:${encodeURIComponent(workspaceId)}`
    : baseKey;
}
