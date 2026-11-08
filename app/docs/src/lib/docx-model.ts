import { DOMParser, type Node as XmlNode, type Element as XmlElement } from "@xmldom/xmldom";
import { MAX_OFFICE_EDITOR_BYTES, OfficeFileError } from "../../../shared/lib/office-file.ts";
import { MAX_RASTER_PIXELS, readRasterDataUrl } from "../../../shared/lib/office-raster.ts";
import { safeOfficeLink } from "../../../shared/lib/office-package.ts";
export { MAX_RASTER_PIXELS, MAX_RASTER_BYTES, rasterInfo, rasterDataUrl, readRasterDataUrl } from "../../../shared/lib/office-raster.ts";
export { safeOfficeLink } from "../../../shared/lib/office-package.ts";

export interface OfficeMark { type: string; attrs?: Record<string, unknown> }
export interface OfficeNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: OfficeNode[];
  marks?: OfficeMark[];
}
export interface ImportedOfficeDocument { content: string; title?: string; hasUnsupportedContent: boolean }
const encoder = new TextEncoder();

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
