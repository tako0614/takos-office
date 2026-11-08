import PptxGenJS from "pptxgenjs";
import type { Presentation, SlideElement } from "../types/index.ts";
import { presentationSchema } from "../../../shared/office-schema.ts";
import { EMU_PER_INCH, physicalSlideSize } from "../../../shared/lib/slide-size.ts";
import { readRasterDataUrl, MAX_RASTER_PIXELS } from "../../../shared/lib/office-raster.ts";
import { MAX_OFFICE_EDITOR_BYTES, OfficeFileError } from "../../../shared/lib/office-file.ts";

export async function exportPptx(presentation: Presentation): Promise<{blob: Blob; hasUnsupportedContent: boolean}> {
  let serialized: string;
  try { serialized = JSON.stringify(presentation); } catch (cause) { throw new OfficeFileError("invalid", {cause}); }
  if (new TextEncoder().encode(serialized).byteLength > MAX_OFFICE_EDITOR_BYTES) throw new OfficeFileError("too-large");
  if (!presentationSchema.safeParse(presentation).success) throw new OfficeFileError("invalid");
  const pptx = new PptxGenJS();
  const size = physicalSlideSize(presentation.slideSize);
  pptx.defineLayout({name:"OFFICE",width:size.widthEmu / EMU_PER_INCH,height:size.heightEmu / EMU_PER_INCH});
  pptx.layout = "OFFICE";
  pptx.author = "Takos Office";
  pptx.title = presentation.title;
  let unsupported = false, imageBytes = 0, imagePixels = 0;
  function color(value: string | undefined, fallback: string): string {
    if (value === undefined) return fallback;
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
    if (hex) return hex[1].length === 3 ? [...hex[1]].map(char => char + char).join("") : hex[1];
    const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(value.trim());
    if (rgb && rgb.slice(1).every(value => Number(value) <= 255)) return rgb.slice(1).map(value => Number(value).toString(16).padStart(2,"0")).join("");
    unsupported = true;
    return fallback;
  }
  function fill(value: string | undefined) {
    if (value === "transparent") return {color:"FFFFFF",transparency:100};
    const hex = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(value ?? "");
    if (hex) return {color:hex[1],transparency:100*(1-parseInt(hex[2],16)/255)};
    const rgba = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/i.exec(value ?? "");
    if (rgba && rgba.slice(1,4).every(value => Number(value)<=255) && Number(rgba[4])<=1) return {color:rgba.slice(1,4).map(value=>Number(value).toString(16).padStart(2,"0")).join(""),transparency:100*(1-Number(rgba[4]))};
    return {color:color(value,"4F87E0"),transparency:0};
  }
  const box = (element: SlideElement) => ({
    x:element.x / 96, y:element.y / 96, w:element.width / 96, h:element.height / 96,
    rotate:((element.rotation % 360) + 360) % 360,
  });
  for (const source of presentation.slides) {
    const slide = pptx.addSlide();
    slide.background = {color:color(source.background,"FFFFFF")};
    if (source.notes !== undefined) slide.addNotes(source.notes);
    if (source.transition && source.transition.type !== "none") unsupported = true;
    for (const element of source.elements) {
      if ([element.x,element.y,element.width,element.height].some(value => Math.abs(value)>1_000_000)) throw new OfficeFileError("too-large");
      if (element.type === "text" && element.fontSize !== undefined && (element.fontSize<=0 || element.fontSize*0.75>4000)) throw new OfficeFileError("invalid");
      if (element.width <= 0 || element.height <= 0) { unsupported = true; continue; }
      const bounds = box(element);
      if (element.type === "text") {
        slide.addText(element.text ?? "", {
          ...bounds, fontSize:(element.fontSize ?? 24) * 0.75, fontFace:element.fontFamily ?? "Arial",
          color:color(element.fontColor,"333333"), bold:element.bold ?? false, italic:element.italic ?? false,
          align:element.textAlign ?? "left", valign:"top", margin:6, paraSpaceAfter:0,
        });
      } else if (element.type === "shape") {
        const shape = {rect:pptx.ShapeType.rect,ellipse:pptx.ShapeType.ellipse,triangle:pptx.ShapeType.triangle,arrow:pptx.ShapeType.rightArrow}[element.shapeType ?? "rect"];
        const stroke = element.strokeWidth ?? 2;
        slide.addShape(shape, {...bounds,fill:fill(element.fillColor),line:{color:color(element.strokeColor,"2563EB"),width:Math.max(0,stroke * 0.75),transparency:stroke <= 0 ? 100 : 0}});
      } else if (element.type === "image") {
        if (typeof element.imageUrl !== "string" || !element.imageUrl.startsWith("data:")) {
          unsupported = true;
          slide.addText("[Image]", {...bounds,fontSize:12,color:"666666"});
          continue;
        }
        const image = readRasterDataUrl(element.imageUrl);
        imageBytes += image.bytes.byteLength;
        imagePixels += image.width * image.height;
        if (imageBytes > 5 * 1024 * 1024 || imagePixels > MAX_RASTER_PIXELS) throw new OfficeFileError("too-large");
        // Only admitted embedded bytes. Passing a remote `path` is never allowed.
        slide.addImage({...bounds,data:element.imageUrl});
      }
    }
  }
  const blob = await pptx.write({outputType:"blob",compression:true});
  if (!(blob instanceof Blob)) throw new OfficeFileError("invalid");
  return {blob:blob.slice(0,blob.size,"application/vnd.openxmlformats-officedocument.presentationml.presentation"),hasUnsupportedContent:unsupported};
}
