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

/** True for an IPv4 address in a loopback/private/CGNAT/multicast/reserved range. */
function isPrivateIpv4(a: number, b: number): boolean {
  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

/**
 * Parse an IPv6 literal (already bracket-stripped) into its 8 16-bit hextets,
 * expanding `::` and any embedded dotted IPv4 tail (`::ffff:127.0.0.1`).
 * Returns null for anything that is not a well-formed IPv6 literal.
 */
function parseIpv6(input: string): number[] | null {
  let s = input;
  // Fold an embedded dotted IPv4 tail (`...:a.b.c.d`) into two hextets so the
  // generic parser below sees a pure-hex address.
  const lastColon = s.lastIndexOf(":");
  if (lastColon !== -1 && s.slice(lastColon + 1).includes(".")) {
    const m = s.slice(lastColon + 1).match(
      /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
    );
    if (!m) return null;
    const p = m.slice(1, 5).map(Number);
    if (p.some((n) => n > 255)) return null;
    s = s.slice(0, lastColon + 1) +
      (((p[0] << 8) | p[1]).toString(16)) + ":" +
      (((p[2] << 8) | p[3]).toString(16));
  }

  const parts = s.split("::");
  if (parts.length > 2) return null; // at most one "::"
  const head = parts[0] === "" ? [] : parts[0].split(":");
  const tail = parts.length === 2 ? (parts[1] === "" ? [] : parts[1].split(":"))
    : [];
  const groupStrs = parts.length === 2
    ? [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail]
    : head;
  if (groupStrs.length !== 8) return null;
  const groups: number[] = [];
  for (const g of groupStrs) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    groups.push(parseInt(g, 16));
  }
  return groups;
}

/**
 * True for an IPv6 literal that is loopback, unspecified, link-local, ULA,
 * multicast, or an IPv4-mapped/compatible form whose embedded IPv4 is private.
 * Fails closed (blocks) on any literal we cannot parse.
 */
function isPrivateIpv6(host: string): boolean {
  const g = parseIpv6(host);
  if (!g) return true; // unparseable IPv6 literal -> block
  if (g.every((h) => h === 0)) return true; // :: unspecified
  if (g.slice(0, 7).every((h) => h === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d: re-run the v4
  // policy on the embedded address so the mapped form can't tunnel a private
  // IPv4 (the documented `http://[::ffff:127.0.0.1]/` bypass).
  const mapped = g.slice(0, 5).every((h) => h === 0) && g[5] === 0xffff;
  const compat = g.slice(0, 6).every((h) => h === 0) && !(g[6] === 0 && g[7] <= 1);
  if (mapped || compat) {
    return isPrivateIpv4((g[6] >> 8) & 0xff, g[6] & 0xff);
  }
  return false;
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

  // IPv6 literals are the only hostnames containing a colon (URL.hostname has
  // already stripped any port), so this reliably routes them through the full
  // IPv6 range check instead of the dotted-IPv4 path below.
  if (host.includes(":")) return !isPrivateIpv6(host);

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    if (isPrivateIpv4(Number(v4[1]), Number(v4[2]))) return false;
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
