/** A title is content, never a filesystem path or an installed application ID. */
export function sanitizeFilename(title: string): string {
  const base = title.trim().replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g," ").trim().slice(0,120);
  return base.length > 0 ? base : "document";
}

export function downloadOfficeBlob(blob: Blob, filename: string, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  const document = globalThis.document;
  if (!document) return;
  const url = URL.createObjectURL(blob);
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    if (anchor?.parentNode) anchor.parentNode.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url),0);
  }
}
