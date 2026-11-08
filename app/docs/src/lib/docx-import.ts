import mammoth from "mammoth/mammoth.browser.js";
import { readOfficeArchive, writeOfficeArchive, parseOfficeXml, OfficeFileError } from "../../../shared/lib/office-archive.ts";
import { htmlToOfficeDocument, rasterDataUrl, rasterInfo, MAX_RASTER_BYTES, safeOfficeLink, type ImportedOfficeDocument } from "./docx-model.ts";

const relNamespaces = new Set(["http://schemas.openxmlformats.org/package/2006/relationships", "http://purl.oclc.org/ooxml/package/relationships"]);
const officeRelationshipTypes = new Set(["http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument"]);
const hyperlinkRelationshipTypes = new Set(["http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", "http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink"]);
const wordNamespaces = new Set(["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"]);

function partForRelationships(name: string): string {
  if (name === "_rels/.rels") return "";
  const match = /^(.*\/)?_rels\/([^/]+)\.rels$/.exec(name);
  if (!match) throw new OfficeFileError("invalid");
  return (match[1] ?? "") + match[2];
}

function internalTarget(part: string, target: string): string {
  if (/[\\\x00-\x20\x7f?#]/u.test(target) || /^[a-z][\w+.-]*:/i.test(target) || target.startsWith("//")) throw new OfficeFileError("unsafe");
  let decoded: string;
  try { decoded=decodeURIComponent(target); } catch { throw new OfficeFileError("invalid"); }
  const segments=target.startsWith("/") ? [] : part.split("/").slice(0,-1);
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") { if(!segments.length) throw new OfficeFileError("unsafe"); segments.pop(); }
    else segments.push(segment);
  }
  return segments.join("/");
}

/** Pure file conversion. The UI runs this in a disposable Worker, never in a privileged service. */
export async function importDocx(bytes: Uint8Array, signal?: AbortSignal): Promise<ImportedOfficeDocument> {
  const parts=await readOfficeArchive(bytes,signal);
  let mainPart: string | undefined;
  for (const [name, data] of parts) {
    if (!/\.(?:xml|rels)$/i.test(name)) continue;
    const xml=parseOfficeXml(data);
    if (name.endsWith(".rels")) {
      const root = xml.documentElement;
      if (!root || !relNamespaces.has(root.namespaceURI ?? "") || root.localName !== "Relationships") throw new OfficeFileError("invalid");
      const ids=new Set<string>();
      const relationships=xml.getElementsByTagNameNS(root.namespaceURI!,"Relationship");
      for (let i=0;i<relationships.length;i++) {
        const rel=relationships.item(i)!;
        const id=rel.getAttribute("Id"), type=rel.getAttribute("Type") ?? "", target=rel.getAttribute("Target") ?? "";
        if(!id || ids.has(id) || !type || !target) throw new OfficeFileError("invalid");
        ids.add(id);
        if (rel.getAttribute("TargetMode") === "External") {
          if (!hyperlinkRelationshipTypes.has(type) || !safeOfficeLink(target)) throw new OfficeFileError("unsafe");
          continue;
        }
        if (rel.getAttribute("TargetMode") && rel.getAttribute("TargetMode") !== "Internal") throw new OfficeFileError("unsafe");
        const resolved=internalTarget(partForRelationships(name),target);
        if (!parts.has(resolved)) throw new OfficeFileError("invalid");
        if (name === "_rels/.rels" && officeRelationshipTypes.has(type)) {
          if(mainPart) throw new OfficeFileError("invalid");
          mainPart=resolved;
        }
      }
    }
    for (const localName of ["altChunk","control","OLEObject"]) {
      const matches=xml.getElementsByTagNameNS("*",localName);
      for(let i=0;i<matches.length;i++) {
        const ns=matches.item(i)?.namespaceURI ?? "";
        if(wordNamespaces.has(ns) || ns === "urn:schemas-microsoft-com:office:office") throw new OfficeFileError("unsafe");
      }
    }
  }
  if (!mainPart || !parts.has("[Content_Types].xml")) throw new OfficeFileError("invalid");
  const types=parseOfficeXml(parts.get("[Content_Types].xml")!);
  if(types.documentElement?.localName !== "Types" || types.documentElement.namespaceURI !== "http://schemas.openxmlformats.org/package/2006/content-types") throw new OfficeFileError("invalid");
  const declaredTypes=types.getElementsByTagNameNS("*", "*");
  for(let i=0;i<declaredTypes.length;i++) {
    if(/macroenabled|vba|activex|oleobject/i.test(declaredTypes.item(i)?.getAttribute("ContentType") ?? "")) throw new OfficeFileError("unsafe");
  }
  const overrides=types.getElementsByTagNameNS("http://schemas.openxmlformats.org/package/2006/content-types","Override");
  let validType=false;
  for (let i=0;i<overrides.length;i++) {
    const item=overrides.item(i)!;
    if(item.getAttribute("PartName") === "/"+mainPart) {
      if(validType) throw new OfficeFileError("invalid");
      if(item.getAttribute("ContentType") !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") throw new OfficeFileError("unsupported");
      validType=true;
    }
  }
  const document=parseOfficeXml(parts.get(mainPart)!);
  if(!validType || document.documentElement?.localName !== "document" || !wordNamespaces.has(document.documentElement.namespaceURI ?? "")) throw new OfficeFileError("invalid");
  const canonical=await writeOfficeArchive(parts,signal);
  signal?.throwIfAborted();
  let imageBytes=0, imageError: unknown;
  const result=await mammoth.convertToHtml({arrayBuffer:Uint8Array.from(canonical).buffer},{
    externalFileAccess:false,
    includeEmbeddedStyleMap:false,
    ignoreEmptyParagraphs:false,
    styleMap:["u => u", "strike => s"],
    convertImage:mammoth.images.imgElement(async(image)=>{
      try {
        const data=new Uint8Array(await image.readAsArrayBuffer());
        imageBytes+=data.byteLength;
        if(imageBytes > MAX_RASTER_BYTES) throw new OfficeFileError("too-large");
        const info=rasterInfo(data,image.contentType);
        return {src:rasterDataUrl(data,info.mime)};
      } catch(error) { imageError=error; throw error; }
    }),
  });
  signal?.throwIfAborted();
  if(imageError) throw imageError;
  if(result.messages.some(message=>message.type === "error")) throw new OfficeFileError("invalid");
  const converted=htmlToOfficeDocument(result.value);
  let title: string | undefined;
  const core=parts.get("docProps/core.xml");
  if(core) title=parseOfficeXml(core).getElementsByTagNameNS("http://purl.org/dc/elements/1.1/","title").item(0)?.textContent?.trim().slice(0,1000) || undefined;
  return {...converted,...(title ? {title} : {}),hasUnsupportedContent:converted.hasUnsupportedContent || result.messages.some(message=>message.type === "warning")};
}
