import type { Document as XmlDocument } from "@xmldom/xmldom";
import { readOfficeArchive, parseOfficeXml } from "./office-archive.ts";
import { OfficeFileError } from "./office-file.ts";

const relationshipNamespaces = new Set([
  "http://schemas.openxmlformats.org/package/2006/relationships",
  "http://purl.oclc.org/ooxml/package/relationships",
]);
const officeRelationshipPrefixes = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/",
  "http://purl.oclc.org/ooxml/officeDocument/relationships/",
];
export interface OfficeRelationship {type: string; target: string; external: boolean}
export interface OfficePackage {
  parts: Map<string, Uint8Array>;
  xmlParts: Map<string, XmlDocument>;
  relationships: Map<string, Map<string, OfficeRelationship>>;
  mainPart: string;
  mainContentType: string;
}

export function safeOfficeLink(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 8192 || /[\x00-\x20\x7f]/u.test(value)) return;
  if (value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    if (["http:", "https:", "mailto:"].includes(url.protocol)) return url.href;
  } catch { /* Unsupported relative or malformed URL. */ }
}
export function isOfficeRelationship(rel: OfficeRelationship | undefined, type: string): boolean {
  return Boolean(rel && officeRelationshipPrefixes.some(prefix => rel.type === prefix + type));
}
function relationshipSource(name: string): string {
  if (name === "_rels/.rels") return "";
  const match = /^(.*\/)?_rels\/([^/]+)\.rels$/.exec(name);
  if (!match) throw new OfficeFileError("invalid");
  return (match[1] ?? "") + match[2];
}
function internalTarget(part: string, target: string): string {
  if (/[\\\x00-\x20\x7f?#]/u.test(target) || /^[a-z][\w+.-]*:/i.test(target) || target.startsWith("//")) throw new OfficeFileError("unsafe");
  let decoded: string;
  try { decoded = decodeURIComponent(target); } catch { throw new OfficeFileError("invalid"); }
  const segments = target.startsWith("/") ? [] : part.split("/").slice(0, -1);
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) throw new OfficeFileError("unsafe");
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join("/");
}

/** Shared package admission; no second codec sees the original ZIP headers. */
export async function readOfficePackage(bytes: Uint8Array, signal?: AbortSignal): Promise<OfficePackage> {
  const parts = await readOfficeArchive(bytes, signal);
  const xmlParts = new Map<string, XmlDocument>();
  const relationships = new Map<string, Map<string, OfficeRelationship>>();
  let mainPart: string | undefined;
  for (const [name, data] of parts) {
    if (!/\.(?:xml|rels)$/i.test(name)) continue;
    const xml = parseOfficeXml(data);
    xmlParts.set(name, xml);
    if (!name.endsWith(".rels")) continue;
    const root = xml.documentElement;
    if (!root || !relationshipNamespaces.has(root.namespaceURI ?? "") || root.localName !== "Relationships") throw new OfficeFileError("invalid");
    const source = relationshipSource(name);
    const selected = new Map<string, OfficeRelationship>();
    relationships.set(source, selected);
    const records = xml.getElementsByTagNameNS(root.namespaceURI!, "Relationship");
    for (let i = 0; i < records.length; i++) {
      const record = records.item(i)!;
      const id = record.getAttribute("Id"), type = record.getAttribute("Type") ?? "", target = record.getAttribute("Target") ?? "";
      if (!id || selected.has(id) || !type || !target) throw new OfficeFileError("invalid");
      const mode = record.getAttribute("TargetMode");
      if (mode === "External") {
        const rel = {type, target, external: true};
        if (!isOfficeRelationship(rel, "hyperlink") || !safeOfficeLink(target)) throw new OfficeFileError("unsafe");
        selected.set(id, rel);
        continue;
      }
      if (mode && mode !== "Internal") throw new OfficeFileError("unsafe");
      const resolved = internalTarget(source, target);
      if (!parts.has(resolved)) throw new OfficeFileError("invalid");
      const rel = {type, target: resolved, external: false};
      selected.set(id, rel);
      if (source === "" && isOfficeRelationship(rel, "officeDocument")) {
        if (mainPart) throw new OfficeFileError("invalid");
        mainPart = resolved;
      }
    }
  }
  const types = xmlParts.get("[Content_Types].xml");
  if (!mainPart || !types || types.documentElement?.localName !== "Types" || types.documentElement.namespaceURI !== "http://schemas.openxmlformats.org/package/2006/content-types") throw new OfficeFileError("invalid");
  const declared = types.getElementsByTagNameNS("*", "*");
  for (let i = 0; i < declared.length; i++) {
    if (/macroenabled|vba|activex|oleobject/i.test(declared.item(i)?.getAttribute("ContentType") ?? "")) throw new OfficeFileError("unsafe");
  }
  let mainContentType: string | undefined;
  const overrides = types.getElementsByTagNameNS("http://schemas.openxmlformats.org/package/2006/content-types", "Override");
  for (let i = 0; i < overrides.length; i++) {
    const item = overrides.item(i)!;
    if (item.getAttribute("PartName") !== "/" + mainPart) continue;
    if (mainContentType !== undefined) throw new OfficeFileError("invalid");
    mainContentType = item.getAttribute("ContentType") ?? "";
  }
  if (!mainContentType || !xmlParts.has(mainPart)) throw new OfficeFileError("invalid");
  return {parts, xmlParts, relationships, mainPart, mainContentType};
}
