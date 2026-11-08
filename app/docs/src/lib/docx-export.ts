import {
  AlignmentType, Document as WordDocument, ExternalHyperlink, HeadingLevel,
  ImageRun, InternalHyperlink, LevelFormat, Packer, Paragraph, Table,
  TableCell, TableRow, TextRun, UnderlineType, WidthType,
  type ILevelsOptions, type IRunOptions,
} from "docx";
import { editorDocument, readRasterDataUrl, safeOfficeLink, MAX_RASTER_PIXELS, type OfficeNode, type OfficeMark } from "./docx-model.ts";
import { OfficeFileError } from "../../../shared/lib/office-archive.ts";

const headings = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
type WordBlock = Paragraph | Table;
type List = { reference: string; level: number };
type MutableRunOptions = { -readonly [Key in keyof IRunOptions]: IRunOptions[Key] };

export async function exportDocx(title: string, content: string): Promise<{ blob: Blob; hasUnsupportedContent: boolean }> {
  const model = editorDocument(content);
  let unsupported = false, nextList = 0, imagePixels = 0;
  const numbering: { reference: string; levels: ILevelsOptions[] }[] = [];
  function runOptions(marks: OfficeMark[] = []): IRunOptions {
    const options: MutableRunOptions = {};
    for (const mark of marks) {
      switch (mark.type) {
        case "bold": options.bold=true; break;
        case "italic": options.italics=true; break;
        case "underline": options.underline={type:UnderlineType.SINGLE}; break;
        case "strike": options.strike=true; break;
        case "superscript": options.superScript=true; break;
        case "subscript": options.subScript=true; break;
        case "code": options.font="Courier New"; break;
        case "link": break;
        case "textStyle": {
          const attrs=mark.attrs;
          if (typeof attrs?.color === "string" && /^#[0-9a-f]{6}$/i.test(attrs.color)) options.color=attrs.color.slice(1);
          if (typeof attrs?.fontFamily === "string" && /^[\p{L}\p{N} ,'-]{1,100}$/u.test(attrs.fontFamily)) options.font=attrs.fontFamily;
          if (typeof attrs?.fontSize === "string" && /^\d+(?:\.\d+)?(?:pt|px)?$/.test(attrs.fontSize)) {
            const points=parseFloat(attrs.fontSize)*(attrs.fontSize.endsWith("px") ? .75 : 1);
            if (points >= 1 && points <= 144) options.size=Math.round(points*2);
          }
          break;
        }
        default: unsupported=true;
      }
    }
    return options;
  }
  function inline(nodes: OfficeNode[] = []): (TextRun | ExternalHyperlink | InternalHyperlink | ImageRun)[] {
    return nodes.flatMap((node): (TextRun | ExternalHyperlink | InternalHyperlink | ImageRun)[] => {
      if (node.type === "text") {
        const run = new TextRun({ ...runOptions(node.marks), text:typeof node.text === "string" ? node.text : "" });
        const link=node.marks?.find(mark=>mark.type === "link");
        if (!link) return [run];
        const href=safeOfficeLink(link.attrs?.href);
        if (!href) { unsupported=true; return [run]; }
        return [href.startsWith("#") ? new InternalHyperlink({anchor:href.slice(1),children:[run]}) : new ExternalHyperlink({link:href,children:[run]})];
      }
      if (node.type === "hardBreak") return [new TextRun({break:1})];
      if (node.type === "image") {
        try {
          const image=readRasterDataUrl(node.attrs?.src);
          imagePixels += image.width * image.height;
          if(imagePixels > MAX_RASTER_PIXELS) throw new OfficeFileError("too-large");
          const requestedWidth=typeof node.attrs?.width === "number" && node.attrs.width > 0 ? node.attrs.width : image.width;
          const requestedHeight=typeof node.attrs?.height === "number" && node.attrs.height > 0 ? node.attrs.height : image.height;
          const scale=Math.min(1,720/requestedWidth,960/requestedHeight);
          return [new ImageRun({type:image.type,data:image.bytes,transformation:{width:Math.max(1,Math.round(requestedWidth*scale)),height:Math.max(1,Math.round(requestedHeight*scale))},altText:{name:"Image",title:"Image",description:typeof node.attrs?.alt === "string" ? node.attrs.alt.slice(0,2000) : ""}})];
        } catch (error) {
          // Never fetch a remote URL while exporting. Preserve an explicit text fallback.
          if (error instanceof OfficeFileError && error.code === "unsupported") { unsupported=true; return [new TextRun({text:typeof node.attrs?.alt === "string" ? `[Image: ${node.attrs.alt}]` : "[Image]"})]; }
          throw error;
        }
      }
      unsupported=true; return inline(node.content);
    });
  }
  function paragraph(node: OfficeNode, list?: List): Paragraph {
    const align=node.attrs?.textAlign;
    return new Paragraph({
      children:inline(node.content),
      ...(node.type === "heading" ? {heading:headings[Math.max(0,Math.min(5,(Number(node.attrs?.level)||1)-1))]} : {}),
      ...(list ? {numbering:list} : {}),
      ...(align === "center" ? {alignment:AlignmentType.CENTER} : align === "right" ? {alignment:AlignmentType.RIGHT} : align === "justify" ? {alignment:AlignmentType.JUSTIFIED} : {}),
    });
  }
  function blocks(nodes: OfficeNode[] = [], parentLevel = -1): WordBlock[] {
    const result: WordBlock[] = [];
    for (const node of nodes) {
      if (["paragraph","heading","codeBlock"].includes(node.type)) { if(node.type === "codeBlock") unsupported=true; result.push(paragraph(node)); }
      else if (node.type === "image") result.push(new Paragraph({children:inline([node])}));
      else if (["bulletList","orderedList","taskList"].includes(node.type)) {
        if(node.type === "taskList") unsupported=true;
        const reference=`office-list-${++nextList}`, level=Math.min(8,parentLevel+1);
        const bullet=node.type !== "orderedList";
        const start=Math.max(1,Math.min(100_000,Math.trunc(Number(node.attrs?.start))||1));
        numbering.push({reference,levels:Array.from({length:9},(_,index)=>({level:index,format:bullet ? LevelFormat.BULLET : LevelFormat.DECIMAL,text:bullet ? "•" : `%${index+1}.`,start,alignment:AlignmentType.START,style:{paragraph:{indent:{left:(index+1)*720,hanging:360}}}}))});
        for (const item of node.content ?? []) {
          let first=true;
          for (const child of item.content ?? []) {
            if (["paragraph","heading"].includes(child.type)) { result.push(paragraph(child,first ? {reference,level} : undefined)); first=false; }
            else { if(first){result.push(paragraph({type:"paragraph",content:[]},{reference,level}));first=false;} result.push(...blocks([child],level)); }
          }
          if(first) result.push(paragraph({type:"paragraph",content:[]},{reference,level}));
        }
      } else if (node.type === "table") {
        const rows=(node.content ?? []).filter(n=>n.type === "tableRow");
        if(!rows.length) continue;
        result.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:rows.map(row=>new TableRow({
          tableHeader:row.content?.every(cell=>cell.type === "tableHeader"),
          children:(row.content ?? []).map(cell=>{
            const cellBlocks=blocks(cell.content);
            return new TableCell({
            columnSpan:Math.max(1,Math.min(100,Math.trunc(Number(cell.attrs?.colspan))||1)),
            rowSpan:Math.max(1,Math.min(100,Math.trunc(Number(cell.attrs?.rowspan))||1)),
            children:cellBlocks.length ? cellBlocks : [new Paragraph("")],
          }); }),
        }))}));
      } else { unsupported=true; result.push(...blocks(node.content,parentLevel)); }
    }
    return result;
  }
  const children=blocks(model.content);
  const file=new WordDocument({title:title.slice(0,1000),creator:"Takos Office",numbering:{config:numbering},sections:[{children:children.length ? children : [new Paragraph("")]}]});
  return {blob:await Packer.toBlob(file),hasUnsupportedContent:unsupported};
}
