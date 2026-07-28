/**
 * Return an ISO timestamp that is strictly newer than the previous revision.
 *
 * Office's public document contracts use `updatedAt` as their ETag token. A
 * plain `new Date().toISOString()` can repeat within the same millisecond,
 * making two different snapshots share one precondition.
 */
export function nextEntityRevision(previous?: string): string {
  const now = Date.now();
  const previousMs = previous === undefined ? Number.NaN : Date.parse(previous);
  const next =
    Number.isFinite(previousMs) && previousMs >= now ? previousMs + 1 : now;
  return new Date(next).toISOString();
}
