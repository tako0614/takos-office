import { DOMParser, type Node as XmlNode, type Element as XmlElement } from "@xmldom/xmldom";
import { MAX_OFFICE_EDITOR_BYTES, OfficeFileError } from "../../../shared/lib/office-file.ts";

export interface OfficeMark { type: string; attrs?: Record<string, unknown> }
export interface OfficeNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: OfficeNode[];
  marks?: OfficeMark[];
}
export interface ImportedOfficeDocument { content: string; title?: string; hasUnsupportedContent: boolean }
export const MAX_RASTER_PIXELS = 32_000_000;
export const MAX_RASTER_BYTES = Math.floor(MAX_OFFICE_EDITOR_BYTES * 3 / 4);
const encoder = new TextEncoder();

export function safeOfficeLink(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 8192 || /[\x00-\x20\x7f]/u.test(value)) return;
  if (value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    if (["http:", "https:", "mailto:"].includes(url.protocol)) return url.href;
  } catch { /* Unsupported relative or malformed URL. */ }
}

export function rasterInfo(bytes: Uint8Array, declaredMime?: string) {
  if (bytes.length > MAX_RASTER_BYTES) throw new OfficeFileError("too-large");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let type: "png" | "jpg" | "gif" | "bmp", width = 0, height = 0;
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b)) {
    type = "png"; width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes.length >= 10 && /^GIF8[79]a$/.test(new TextDecoder().decode(bytes.subarray(0, 6)))) {
    type = "gif"; width = view.getUint16(6, true); height = view.getUint16(8, true);
  } else if (bytes.length >= 26 && bytes[0] === 66 && bytes[1] === 77) {
    type = "bmp"; width = view.getInt32(18, true); height = Math.abs(view.getInt32(22, true));
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    type = "jpg";
    for (let p = 2; p + 3 < bytes.length;) {
      if (bytes[p++] !== 255) throw new OfficeFileError("invalid");
      while (bytes[p] === 255) p++;
      const marker = bytes[p++];
      if(p + 2 > bytes.length) throw new OfficeFileError("invalid");
      if (marker === 217 || marker === 218) break;
      const length = view.getUint16(p);
      if (length < 2 || p + length > bytes.length) throw new OfficeFileError("invalid");
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (length < 7) throw new OfficeFileError("invalid");
        height = view.getUint16(p + 3); width = view.getUint16(p + 5); break;
      }
      p += length;
    }
  } else throw new OfficeFileError("unsupported");
  if (!width || !height || width < 0 || width * height > MAX_RASTER_PIXELS) throw new OfficeFileError("too-large");
  const mime = type === "jpg" ? "image/jpeg" : `image/${type}`;
  if (declaredMime && declaredMime.toLowerCase() !== mime) throw new OfficeFileError("unsafe");
  return { type, width, height, mime };
}

export function rasterDataUrl(bytes: Uint8Array, mime: string): string {
  rasterInfo(bytes, mime);
  let binary = "";
  for (let p = 0; p < bytes.length; p += 0x8000) binary += String.fromCharCode(...bytes.subarray(p, p + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

export function readRasterDataUrl(value: unknown) {
  if (typeof value !== "string" || value.length > MAX_OFFICE_EDITOR_BYTES) throw new OfficeFileError("unsupported");
  const match = /^data:(image\/(?:png|jpeg|gif|bmp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match) throw new OfficeFileError("unsupported");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0)); }
  catch (cause) { throw new OfficeFileError("invalid", { cause }); }
  return { bytes, ...rasterInfo(bytes, match[1]) };
}

export function checkedEditorModel(model: OfficeNode): string {
  const stack = [{ node: model, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (!node || typeof node !== "object" || typeof node.type !== "string") throw new OfficeFileError("invalid");
    if (++count > 100_000 || depth > 128) throw new OfficeFileError("too-large");
    if (node.content !== undefined && !Array.isArray(node.content)) throw new OfficeFileError("invalid");
    for (const child of node.content ?? []) stack.push({ node: child, depth: depth + 1 });
  }
  if (model.type !== "doc") throw new OfficeFileError("invalid");
  const content = JSON.stringify(model);
  if (encoder.encode(content).byteLength > MAX_OFFICE_EDITOR_BYTES) throw new OfficeFileError("too-large");
  return content;
}

const inlineTypes = new Set(["text", "hardBreak"]);
const marks: Record<string, string> = { strong:"bold", b:"bold", em:"italic", i:"italic", u:"underline", s:"strike", strike:"strike", del:"strike", code:"code", sub:"subscript", sup:"superscript", mark:"highlight" };

/** Project an inert parser tree into editor nodes; source HTML is never attached to the page. */
export function htmlToOfficeDocument(html: string): ImportedOfficeDocument {
  if (encoder.encode(html).byteLength > MAX_OFFICE_EDITOR_BYTES * 2) throw new OfficeFileError("too-large");
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(html)) throw new OfficeFileError("unsafe");
  let unsupported = false, count = 0, imagePixels = 0;
  const doc = new DOMParser({ onError() { throw new OfficeFileError("invalid"); } }).parseFromString(`<html><body>${html}</body></html>`, "text/html");
  function blocks(nodes: OfficeNode[]): OfficeNode[] {
    const result: OfficeNode[] = []; let pending: OfficeNode[] = [];
    const flush = () => { if (pending.some((n) => n.type !== "text" || n.text?.trim())) result.push({ type:"paragraph", content:pending }); pending=[]; };
    for (const n of nodes) { if (inlineTypes.has(n.type)) pending.push(n); else { flush(); result.push(n); } }
    flush(); return result;
  }
  function children(node: XmlNode, active: OfficeMark[], depth: number): OfficeNode[] {
    const result: OfficeNode[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling) result.push(...convert(child, active, depth + 1));
    return result;
  }
  function convert(node: XmlNode, active: OfficeMark[], depth: number): OfficeNode[] {
    if (++count > 100_000 || depth > 128) throw new OfficeFileError("too-large");
    if (node.nodeType === 3) return node.nodeValue ? [{ type:"text", text:node.nodeValue, ...(active.length ? { marks:active } : {}) }] : [];
    if (node.nodeType !== 1) return [];
    const el = node as XmlElement, tag = (el.localName ?? el.nodeName).toLowerCase();
    if (["script","style","iframe","object","embed","svg","math","form","link","meta","base"].includes(tag)) { unsupported=true; return []; }
    if (marks[tag]) return children(node, [...active, { type:marks[tag] }], depth);
    if (tag === "a") {
      const href = safeOfficeLink(el.getAttribute("href"));
      if (!href) unsupported=true;
      return children(node, href ? [...active, { type:"link", attrs:{href} }] : active, depth);
    }
    if (tag === "img") {
      const src = el.getAttribute("src") ?? ""; const image = readRasterDataUrl(src);
      imagePixels += image.width * image.height;
      if (imagePixels > MAX_RASTER_PIXELS) throw new OfficeFileError("too-large");
      return [{ type:"image", attrs:{ src, alt:(el.getAttribute("alt") ?? "").slice(0,2000), width:image.width, height:image.height } }];
    }
    if (tag === "br") return [{ type:"hardBreak" }];
    if (tag === "hr") return [{ type:"horizontalRule" }];
    const inner = children(node, active, depth);
    if (tag === "p" || /^h[1-6]$/.test(tag)) {
      const type = tag === "p" ? "paragraph" : "heading";
      const attrs = type === "heading" ? { level:Number(tag[1]) } : undefined;
      // Images are block nodes in the actual editor schema, including when Word wraps them in a paragraph.
      const result: OfficeNode[] = []; let pending: OfficeNode[] = [];
      const flush = () => { if (pending.length) result.push({type, ...(attrs ? {attrs} : {}), content:pending}); pending=[]; };
      for (const item of inner) { if (inlineTypes.has(item.type)) pending.push(item); else { flush(); result.push(item); } }
      flush(); return result.length ? result : [{type, ...(attrs ? {attrs} : {}), content:[]}];
    }
    if (tag === "ul" || tag === "ol") return [{ type:tag === "ul" ? "bulletList" : "orderedList", ...(tag === "ol" ? {attrs:{start:Math.max(1, Math.min(100_000, Number(el.getAttribute("start")) || 1))}} : {}), content:inner.filter(n=>n.type === "listItem") }];
    if (tag === "li") return [{ type:"listItem", content:blocks(inner).length ? blocks(inner) : [{type:"paragraph",content:[]}] }];
    if (tag === "table") return [{ type:"table", content:inner.filter(n=>n.type === "tableRow") }];
    if (tag === "tr") return [{ type:"tableRow", content:inner.filter(n=>n.type === "tableCell" || n.type === "tableHeader") }];
    if (tag === "td" || tag === "th") {
      const span = (name: string) => Math.max(1, Math.min(100, Math.trunc(Number(el.getAttribute(name))) || 1));
      return [{ type:tag === "td" ? "tableCell" : "tableHeader", attrs:{colspan:span("colspan"),rowspan:span("rowspan")}, content:blocks(inner).length ? blocks(inner) : [{type:"paragraph",content:[]}] }];
    }
    if (tag === "blockquote") return [{type:"blockquote",content:blocks(inner)}];
    if (tag === "pre") return [{type:"codeBlock",content:node.textContent ? [{type:"text",text:node.textContent}] : []}];
    if (!["html","body","div","span","thead","tbody","tfoot"].includes(tag)) unsupported=true;
    return inner;
  }
  const body = doc.getElementsByTagName("body").item(0);
  if (!body) throw new OfficeFileError("invalid");
  const content = blocks(children(body, [], 0));
  return { content:checkedEditorModel({type:"doc",content:content.length ? content : [{type:"paragraph",content:[]}]}), hasUnsupportedContent:unsupported };
}

export function editorDocument(content: string): OfficeNode {
  if (encoder.encode(content).byteLength > MAX_OFFICE_EDITOR_BYTES) throw new OfficeFileError("too-large");
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    let model: OfficeNode;
    try { model=JSON.parse(trimmed); } catch (cause) { throw new OfficeFileError("invalid",{cause}); }
    checkedEditorModel(model); return model;
  }
  return JSON.parse(htmlToOfficeDocument(trimmed.startsWith("<") ? trimmed : `<p>${trimmed.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>`).content) as OfficeNode;
}
