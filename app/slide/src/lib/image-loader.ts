/**
 * Server-side image loading for slide exports (PNG screenshot + PDF).
 *
 * Image elements carry an http(s) URL or a `data:image/...;base64` URL (both
 * validated at write time). Export rendering runs only where node-canvas is
 * available (Node/Bun, never workerd), so it can fetch remote images — but that
 * means an agent-supplied URL could point the server at internal hosts. The
 * fetch path therefore refuses obviously-private targets (SSRF best effort),
 * caps the body size, and requires an image content-type. Any failure returns
 * `null` so callers fall back to a placeholder rather than aborting the export.
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 5;

export interface LoadedImage {
  /** A `data:<mime>;base64,<...>` URL usable by node-canvas and jsPDF. */
  dataUrl: string;
  /** Upper-case format hint for jsPDF (`PNG` | `JPEG` | `WEBP` | `GIF`). */
  format: string;
}

/** Minimal fetch shape (so tests can pass a plain stub). */
type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal; redirect?: RequestRedirect },
) => Promise<Response>;

const DATA_IMAGE_RE =
  /^data:image\/(png|jpeg|jpg|gif|webp);base64,([a-z0-9+/=\s]+)$/i;

/** Parse a `data:image/...;base64` URL with no network access. */
export function parseDataImageUrl(url: string): LoadedImage | null {
  const match = url.trim().match(DATA_IMAGE_RE);
  if (!match) return null;
  return { dataUrl: url.trim(), format: formatHint(`image/${match[1]}`) };
}

/**
 * Best-effort SSRF guard: reject hosts that are loopback, link-local, private,
 * CGNAT, multicast or obviously-internal names. Note this is host-literal only
 * — a public hostname resolving to a private IP is not caught here, so every
 * redirect hop's target host is re-validated before that hop is followed.
 */
export function isFetchableImageHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  // WHATWG URL keeps IPv6 literals bracketed (e.g. "[::1]").
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host === "") return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;

  // IPv6 literals (URL hostnames keep the brackets off).
  if (host === "::1") return false;
  if (
    host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd")
  ) {
    return false;
  }

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 127 || a === 10) return false;
    if (a === 169 && b === 254) return false; // link-local
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast / reserved
  }
  return true;
}

/** Load an image URL into a base64 data URL, or `null` on any failure. */
export async function loadImageForExport(
  url: string,
  fetchImpl: FetchLike = fetch,
): Promise<LoadedImage | null> {
  const inline = parseDataImageUrl(url);
  if (inline) return inline;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!isFetchableImageHost(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Follow redirects manually so each hop's target host is validated BEFORE
    // the request is issued. With `redirect: "follow"` a public URL could
    // 302 to an internal host (169.254.169.254 / RFC1918) and the runtime
    // would fire that internal GET before we ever saw the final URL.
    let current = url;
    let res = await fetchImpl(current, {
      signal: controller.signal,
      redirect: "manual",
    });
    for (let hops = 0; res.status >= 300 && res.status < 400; hops++) {
      if (hops >= MAX_REDIRECTS) return null;
      const location = res.headers.get("location");
      if (!location) return null;
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return null;
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") return null;
      if (!isFetchableImageHost(next.toString())) return null;
      current = next.toString();
      res = await fetchImpl(current, {
        signal: controller.signal,
        redirect: "manual",
      });
    }
    if (!res.ok) return null;

    const mime = (res.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!mime.startsWith("image/")) return null;

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      return null;
    }
    return { dataUrl: `data:${mime};base64,${toBase64(bytes)}`, format: formatHint(mime) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function formatHint(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "JPEG";
  if (mime.includes("webp")) return "WEBP";
  if (mime.includes("gif")) return "GIF";
  return "PNG";
}

function toBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
