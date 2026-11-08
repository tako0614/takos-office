import type { Element as XmlElement } from "@xmldom/xmldom";
import type { Slide, SlideElement, SlideSize } from "../types/index.ts";
import { readOfficePackage, isOfficeRelationship, type OfficePackage } from "../../../shared/lib/office-package.ts";
import { rasterDataUrl, rasterInfo, MAX_RASTER_PIXELS } from "../../../shared/lib/office-raster.ts";
import { EMU_PER_LOGICAL_PIXEL, isValidSlideSize, logicalSlideSize } from "../../../shared/lib/slide-size.ts";
import { MAX_OFFICE_EDITOR_BYTES, OfficeFileError } from "../../../shared/lib/office-file.ts";

export interface ImportedPresentation {
  title?: string;
  slides: Slide[];
  slideSize: SlideSize;
  hasUnsupportedContent: boolean;
}
const presentationNs = new Set(["http://schemas.openxmlformats.org/presentationml/2006/main", "http://purl.oclc.org/ooxml/presentationml/main"]);
const drawingNs = new Set(["http://schemas.openxmlformats.org/drawingml/2006/main", "http://purl.oclc.org/ooxml/drawingml/main"]);
const relationshipNs = ["http://schemas.openxmlformats.org/officeDocument/2006/relationships", "http://purl.oclc.org/ooxml/officeDocument/relationships"];
function children(element: XmlElement | undefined, namespace: Set<string>, name?: string): XmlElement[] {
  const result: XmlElement[] = [];
  for (let node = element?.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue;
    const child = node as XmlElement;
    if (namespace.has(child.namespaceURI ?? "") && (!name || child.localName === name)) result.push(child);
  }
  return result;
}
const a = (element: XmlElement | undefined, name: string) => children(element, drawingNs, name)[0];
const p = (element: XmlElement | undefined, name: string) => children(element, presentationNs, name)[0];
function relationId(element: XmlElement, name = "id"): string | undefined {
  return relationshipNs.map(ns => element.getAttributeNS(ns, name)).find(Boolean) || undefined;
}
function numeric(element: XmlElement | undefined, name: string, fallback?: number): number {
  const raw = element?.getAttribute(name);
  if (raw === null || raw === undefined || raw === "") {
    if (fallback !== undefined) return fallback;
    throw new OfficeFileError("invalid");
  }
  if (!/^[+-]?\d+$/.test(raw.trim())) throw new OfficeFileError("invalid");
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new OfficeFileError("too-large");
  return value;
}
function root(pkg: OfficePackage, part: string | undefined, name: string): XmlElement | undefined {
  if (!part) return;
  const element = pkg.xmlParts.get(part)?.documentElement;
  if (!element || !presentationNs.has(element.namespaceURI ?? "") || element.localName !== name) throw new OfficeFileError("invalid");
  return element;
}
function related(pkg: OfficePackage, part: string, type: string): string | undefined {
  const matches = [...(pkg.relationships.get(part)?.values() ?? [])].filter(rel => isOfficeRelationship(rel, type));
  if (matches.length > 1 || matches.some(rel => rel.external)) throw new OfficeFileError("invalid");
  return matches[0]?.target;
}
function placeholder(shape: XmlElement | undefined) {
  return p(p(p(shape,"nvSpPr"),"nvPr"),"ph");
}
function matchPlaceholder(tree: XmlElement | undefined, shape: XmlElement | undefined): XmlElement | undefined {
  const current = placeholder(shape);
  if (!current) return;
  const candidates = children(tree,presentationNs,"sp");
  return candidates.find(item => (placeholder(item)?.getAttribute("idx") || "0") === (current.getAttribute("idx") || "0"))
    ?? candidates.find(item => (placeholder(item)?.getAttribute("type") || "obj") === (current.getAttribute("type") || "obj"));
}

/** Inert PresentationML projection. Only the native editable subset is retained. */
export async function importPptx(bytes: Uint8Array, signal?: AbortSignal): Promise<ImportedPresentation> {
  const pkg = await readOfficePackage(bytes,signal);
  if (pkg.mainContentType !== "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml") throw new OfficeFileError("unsupported");
  const presentation = root(pkg,pkg.mainPart,"presentation")!;
  const page = p(presentation,"sldSz");
  const slideSize = {widthEmu:numeric(page,"cx"),heightEmu:numeric(page,"cy")};
  if (!isValidSlideSize(slideSize)) throw new OfficeFileError("too-large");
  const logical = logicalSlideSize(slideSize);
  const slideIds = children(p(presentation,"sldIdLst"),presentationNs,"sldId");
  if (!slideIds.length || slideIds.length > 1000) throw new OfficeFileError("too-large");
  let unsupported = false, imageBytes = 0, imagePixels = 0, elementCount = 0;
  const slides: Slide[] = [];
  const ids = new Set<string>();
  for (const entry of slideIds) {
    signal?.throwIfAborted();
    const id = relationId(entry), ownId = entry.getAttribute("id");
    if (!id || !ownId || ids.has(ownId)) throw new OfficeFileError("invalid");
    ids.add(ownId);
    const selected = pkg.relationships.get(pkg.mainPart)?.get(id);
    if (!isOfficeRelationship(selected,"slide") || selected!.external) throw new OfficeFileError("invalid");
    const part = selected!.target, source = root(pkg,part,"sld")!;
    const layoutPart = related(pkg,part,"slideLayout"), layout = root(pkg,layoutPart,"sldLayout");
    const masterPart = layoutPart ? related(pkg,layoutPart,"slideMaster") : undefined;
    const master = root(pkg,masterPart,"sldMaster");
    const themePart = masterPart ? related(pkg,masterPart,"theme") : undefined;
    const theme = themePart ? pkg.xmlParts.get(themePart)?.documentElement ?? undefined : undefined;
    const themeElements = a(theme,"themeElements"), colors = new Map<string,string>();
    for (const item of children(a(themeElements,"clrScheme"),drawingNs)) {
      const value = a(item,"srgbClr")?.getAttribute("val") || a(item,"sysClr")?.getAttribute("lastClr");
      if (value && /^[0-9a-f]{6}$/i.test(value)) colors.set(item.localName!,value);
    }
    const colorMap = p(master,"clrMap");
    const mapping = new Map([...["bg1","tx1","bg2","tx2"].map((key,index) => [key,["lt1","dk1","lt2","dk2"][index]] as const)]);
    if (colorMap) for (let i=0;i<colorMap.attributes.length;i++) {
      const attr=colorMap.attributes.item(i)!;mapping.set(attr.name,attr.value);
    }
    const override = a(p(source,"clrMapOvr"),"overrideClrMapping") ?? a(p(layout,"clrMapOvr"),"overrideClrMapping");
    if (override) for(let i=0;i<override.attributes.length;i++) {const attr=override.attributes.item(i)!;mapping.set(attr.name,attr.value);}
    const majorFont = a(a(a(themeElements,"fontScheme"),"majorFont"),"latin")?.getAttribute("typeface") || "Arial";
    const minorFont = a(a(a(themeElements,"fontScheme"),"minorFont"),"latin")?.getAttribute("typeface") || "Arial";
    function color(container: XmlElement | undefined, fallback: string): string {
      if (!container) return fallback;
      const value = children(container,drawingNs).find(item => ["srgbClr","schemeClr","sysClr","prstClr"].includes(item.localName!));
      if (!value) return fallback;
      let hex: string | undefined;
      if (value.localName === "srgbClr") hex = value.getAttribute("val") ?? undefined;
      else if (value.localName === "sysClr") hex = value.getAttribute("lastClr") ?? undefined;
      else if (value.localName === "schemeClr") {
        const key = value.getAttribute("val") ?? "";
        hex = colors.get(mapping.get(key) ?? key);
      }
      if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) {unsupported=true;return fallback;}
      let channels = [0,2,4].map(offset => parseInt(hex!.slice(offset,offset+2),16)), alpha = 1;
      for (const transform of children(value,drawingNs)) {
        const amount = numeric(transform,"val",100000) / 100000;
        if (amount < 0 || amount > 1) throw new OfficeFileError("invalid");
        if (transform.localName === "tint") channels = channels.map(channel => 255-(255-channel)*amount);
        else if (transform.localName === "shade") channels = channels.map(channel => channel*amount);
        else if (transform.localName === "alpha") alpha *= amount;
        else unsupported=true;
      }
      return "#"+channels.map(channel => Math.round(channel).toString(16).padStart(2,"0")).join("")+(alpha<1 ? Math.round(alpha*255).toString(16).padStart(2,"0") : "");
    }
    const slide: Slide = {id:crypto.randomUUID(),background:"#ffffff",elements:[]};
    const add = (element: SlideElement) => {
      if (++elementCount > 50000 || slide.elements.length >= 10000) throw new OfficeFileError("too-large");
      slide.elements.push(element);
    };
    function image(partName: string, fill: XmlElement | undefined, box: Pick<SlideElement,"x"|"y"|"width"|"height"|"rotation">) {
      const blip = a(fill,"blip"), imageId = blip && relationId(blip,"embed");
      const rel = imageId ? pkg.relationships.get(partName)?.get(imageId) : undefined;
      if (!isOfficeRelationship(rel,"image") || rel!.external) throw new OfficeFileError("unsafe");
      const data = pkg.parts.get(rel!.target);
      if (!data) throw new OfficeFileError("invalid");
      const info = rasterInfo(data);
      imageBytes += data.byteLength;imagePixels += info.width*info.height;
      if (imageBytes > 5*1024*1024 || imagePixels > MAX_RASTER_PIXELS) throw new OfficeFileError("too-large");
      const crop = a(fill,"srcRect");
      if (crop && ["l","r","t","b"].some(name => numeric(crop,name,0)!==0) || a(fill,"tile")) unsupported=true;
      add({id:crypto.randomUUID(),type:"image",...box,imageUrl:rasterDataUrl(data,info.mime)});
    }
    for (const [document,documentPart] of [[source,part],[layout,layoutPart],[master,masterPart]] as const) {
      const background = p(p(document,"cSld"),"bg");
      if (!background) continue;
      const properties = p(background,"bgPr");
      if (a(properties,"solidFill")) slide.background = color(a(properties,"solidFill"),"#ffffff");
      else if (a(properties,"blipFill") && documentPart) image(documentPart,a(properties,"blipFill"),{x:0,y:0,width:logical.width,height:logical.height,rotation:0});
      else {slide.background=color(p(background,"bgRef"),"#ffffff");if(!p(background,"bgRef"))unsupported=true;}
      break;
    }
    const layoutTree = p(p(layout,"cSld"),"spTree"), masterTree = p(p(master,"cSld"),"spTree");
    function project(tree: XmlElement | undefined, sourcePart: string, inherited: boolean) {
      for (const shape of children(tree,presentationNs)) {
        const name = shape.localName;
        if (["nvGrpSpPr","grpSpPr","extLst"].includes(name!)) continue;
        if (name === "oleObj" || name === "control" || name === "contentPart") throw new OfficeFileError("unsafe");
        if (name !== "sp" && name !== "pic") {unsupported=true;continue;}
        if (inherited && placeholder(shape)) continue;
        const layoutShape = inherited ? undefined : matchPlaceholder(layoutTree,shape);
        const masterShape = matchPlaceholder(masterTree,layoutShape ?? shape);
        const properties = p(shape,"spPr");
        const transform = a(properties,"xfrm") ?? a(p(layoutShape,"spPr"),"xfrm") ?? a(p(masterShape,"spPr"),"xfrm");
        if (!transform) {unsupported=true;continue;}
        const offset = a(transform,"off"), extent = a(transform,"ext");
        const box = {x:numeric(offset,"x")/EMU_PER_LOGICAL_PIXEL,y:numeric(offset,"y")/EMU_PER_LOGICAL_PIXEL,width:numeric(extent,"cx")/EMU_PER_LOGICAL_PIXEL,height:numeric(extent,"cy")/EMU_PER_LOGICAL_PIXEL,rotation:numeric(transform,"rot",0)/60000};
        if (Object.values(box).some(value => !Number.isFinite(value) || Math.abs(value)>1_000_000) || box.width<0 || box.height<0) throw new OfficeFileError("too-large");
        if (transform.getAttribute("flipH")==="1" || transform.getAttribute("flipV")==="1") unsupported=true;
        if (name === "pic") {image(sourcePart,p(shape,"blipFill"),box);continue;}
        const body = p(shape,"txBody"), paragraphs = children(body,drawingNs,"p");
        const text = paragraphs.map(paragraph => children(paragraph,drawingNs).map(run => run.localName==="br" ? "\n" : a(run,"t")?.textContent ?? "").join("")).join("\n");
        if (text.length > 10000) throw new OfficeFileError("too-large");
        if (a(properties,"custGeom") || a(properties,"gradFill") || a(properties,"blipFill")) unsupported=true;
        const geometry = a(properties,"prstGeom")?.getAttribute("prst") ?? "rect";
        const shapeType = {rect:"rect",ellipse:"ellipse",triangle:"triangle",rightArrow:"arrow"}[geometry] as SlideElement["shapeType"] | undefined;
        const style = p(shape,"style"), fillRef = a(style,"fillRef"), line = a(properties,"ln"), lineRef = a(style,"lnRef");
        const hasLine = !a(line,"noFill") && numeric(line,"w",1)!==0 && Boolean(a(line,"solidFill") || line?.hasAttribute("w") || lineRef && numeric(lineRef,"idx",0)>0);
        const hasFill = !a(properties,"noFill") && Boolean(a(properties,"solidFill") || fillRef && numeric(fillRef,"idx",0)>0);
        if (!text || hasFill || hasLine) {
          if (shapeType) add({id:crypto.randomUUID(),type:"shape",...box,shapeType,fillColor:a(properties,"noFill") ? "transparent" : color(a(properties,"solidFill") ?? fillRef,"transparent"),strokeColor:color(a(line,"solidFill") ?? lineRef,"#000000"),strokeWidth:hasLine ? numeric(line,"w",12700)/EMU_PER_LOGICAL_PIXEL : 0});
          else unsupported=true;
        }
        if (!text) continue;
        const paragraph = paragraphs[0], paragraphProperties = a(paragraph,"pPr");
        const firstRun = children(paragraph,drawingNs).find(item => item.localName==="r" || item.localName==="fld");
        const defaults = a(paragraphProperties,"defRPr") ?? a(a(a(body,"lstStyle"),"lvl1pPr"),"defRPr")
          ?? a(a(a(p(layoutShape,"txBody"),"lstStyle"),"lvl1pPr"),"defRPr")
          ?? a(a(a(p(masterShape,"txBody"),"lstStyle"),"lvl1pPr"),"defRPr");
        const runProperties = a(firstRun,"rPr");
        const font = a(runProperties,"latin")?.getAttribute("typeface") || a(defaults,"latin")?.getAttribute("typeface") || minorFont;
        const fontSize = numeric(runProperties,"sz",numeric(defaults,"sz",1800))/100*4/3;
        if (fontSize < 1 || fontSize > 6000) throw new OfficeFileError("too-large");
        const align = paragraphProperties?.getAttribute("algn") || "l";
        if (!["l","ctr","r"].includes(align)) unsupported=true;
        if (!a(paragraphProperties,"buNone") && children(paragraphProperties,drawingNs).some(item => /^bu/.test(item.localName ?? ""))) unsupported=true;
        for (const paragraph of paragraphs) for(const run of children(paragraph,drawingNs,"r")) {
          const properties = a(run,"rPr");
          if (properties && runProperties && properties.toString()!==runProperties.toString() || a(properties,"hlinkClick")) unsupported=true;
        }
        add({id:crypto.randomUUID(),type:"text",...box,text,fontSize,fontFamily:font.startsWith("+mj") ? majorFont : font.startsWith("+mn") ? minorFont : font,
          fontColor:color(a(runProperties,"solidFill") ?? a(defaults,"solidFill") ?? a(style,"fontRef"),"#333333"),
          bold:(runProperties?.getAttribute("b") || defaults?.getAttribute("b"))==="1",italic:(runProperties?.getAttribute("i") || defaults?.getAttribute("i"))==="1",
          textAlign:align==="ctr" ? "center" : align==="r" ? "right" : "left"});
      }
    }
    if (source.getAttribute("showMasterSp")!=="0") {
      if (masterPart) project(masterTree,masterPart,true);
      if (layoutPart) project(layoutTree,layoutPart,true);
    }
    project(p(p(source,"cSld"),"spTree"),part,false);
    const notesPart = related(pkg,part,"notesSlide"), notes = root(pkg,notesPart,"notes");
    if (notes) {
      const text = children(p(p(notes,"cSld"),"spTree"),presentationNs,"sp").filter(shape => !placeholder(shape) || placeholder(shape)?.getAttribute("type")==="body")
        .flatMap(shape => children(p(shape,"txBody"),drawingNs,"p").map(paragraph => children(paragraph,drawingNs).map(run => run.localName==="br" ? "\n" : a(run,"t")?.textContent ?? "").join(""))).join("\n");
      if (text.length>20000) throw new OfficeFileError("too-large");
      slide.notes=text;
    }
    if (p(source,"transition") || p(source,"timing")) unsupported=true;
    slides.push(slide);
  }
  const core = pkg.xmlParts.get("docProps/core.xml");
  const title = core?.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/","title").item(0)?.textContent?.trim().slice(0,512) || undefined;
  const result = {slides,slideSize,hasUnsupportedContent:unsupported,...(title ? {title} : {})};
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_OFFICE_EDITOR_BYTES) throw new OfficeFileError("too-large");
  return result;
}
