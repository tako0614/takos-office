import mammoth from "mammoth/mammoth.browser.js";
import { writeOfficeArchive, OfficeFileError } from "../../../shared/lib/office-archive.ts";
import { readOfficePackage } from "../../../shared/lib/office-package.ts";
import { htmlToOfficeDocument, rasterDataUrl, rasterInfo, MAX_RASTER_BYTES, type ImportedOfficeDocument } from "./docx-model.ts";

const wordNamespaces = new Set(["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"]);

/** Pure file conversion, run in a disposable Worker by the UI. */
export async function importDocx(bytes: Uint8Array, signal?: AbortSignal): Promise<ImportedOfficeDocument> {
  const packageData = await readOfficePackage(bytes, signal);
  const {parts, mainPart, mainContentType} = packageData;
  if (mainContentType !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") throw new OfficeFileError("unsupported");
  const document = packageData.xmlParts.get(mainPart)!;
  if (document.documentElement?.localName !== "document" || !wordNamespaces.has(document.documentElement.namespaceURI ?? "")) throw new OfficeFileError("invalid");
  for (const xml of packageData.xmlParts.values()) {
    for (const localName of ["altChunk", "control", "OLEObject"]) {
      const matches = xml.getElementsByTagNameNS("*", localName);
      for (let i = 0; i < matches.length; i++) {
        const ns = matches.item(i)?.namespaceURI ?? "";
        if (wordNamespaces.has(ns) || ns === "urn:schemas-microsoft-com:office:office") throw new OfficeFileError("unsafe");
      }
    }
  }
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
  if(core) title=packageData.xmlParts.get("docProps/core.xml")!.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/","title").item(0)?.textContent?.trim().slice(0,1000) || undefined;
  return {...converted,...(title ? {title} : {}),hasUnsupportedContent:converted.hasUnsupportedContent || result.messages.some(message=>message.type === "warning")};
}
