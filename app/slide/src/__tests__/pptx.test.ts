import { expect, test } from "bun:test";
import { readOfficePackage } from "../../../shared/lib/office-package.ts";
import { exportPptx } from "../lib/pptx-export.ts";
import type { Presentation } from "../types/index.ts";

const presentation: Presentation = {
  id:"pptx-export",title:"Known deck",createdAt:"2026-11-08T00:00:00.000Z",updatedAt:"2026-11-08T00:00:00.000Z",
  slideSize:{widthEmu:9_144_000,heightEmu:6_858_000},
  slides:[{id:"first",background:"#123456",notes:"Known speaker note",elements:[
    {id:"text",type:"text",x:96,y:96,width:384,height:96,rotation:0,text:"Known editable text",fontSize:24,bold:true,fontColor:"#112233"},
    {id:"shape",type:"shape",shapeType:"ellipse",x:96,y:300,width:192,height:96,rotation:15,fillColor:"#ff0000",strokeColor:"#000000",strokeWidth:2},
  ]}],
};

test("PowerPoint output is a real package with exact physical size, editable text, shape and speaker notes", async () => {
  const result = await exportPptx(presentation);
  expect(result.blob.type).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
  const pkg = await readOfficePackage(new Uint8Array(await result.blob.arrayBuffer()));
  expect(pkg.mainContentType).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml");
  const xml = pkg.xmlParts.get(pkg.mainPart)!;
  const size = xml.getElementsByTagNameNS("http://schemas.openxmlformats.org/presentationml/2006/main","sldSz").item(0)!;
  expect([size.getAttribute("cx"),size.getAttribute("cy")]).toEqual(["9144000","6858000"]);
  const slide = new TextDecoder().decode(pkg.parts.get("ppt/slides/slide1.xml"));
  expect(slide).toContain("Known editable text");
  expect(slide).toContain('prst="ellipse"');
  expect(slide).toContain('b="1"');
  const notes = new TextDecoder().decode(pkg.parts.get("ppt/notesSlides/notesSlide1.xml"));
  expect(notes).toContain("Known speaker note");
  expect(result.hasUnsupportedContent).toBe(false);
});

import { importPptx } from "../lib/pptx-import.ts";

async function fixture(name: string) {
  return new Uint8Array(await Bun.file(new URL(`./fixtures/pptx/${name}`,import.meta.url)).arrayBuffer());
}

test("an independent 4:3 PowerPoint deck imports physical size, slide order, text, a rectangle and embedded image", async () => {
  const result = await importPptx(await fixture("shp-pos-and-size.pptx"));
  expect(result.slideSize).toEqual({widthEmu:9144000,heightEmu:6858000});
  expect(result.slides).toHaveLength(3);
  expect(result.slides[0].elements.some(element => element.type === "text")).toBe(true);
  expect(result.slides[0].elements.some(element => element.shapeType === "rect")).toBe(true);
  expect(result.slides[1].elements.some(element => element.type === "image" && element.imageUrl?.startsWith("data:image/png;base64,"))).toBe(true);
  expect(result.slides[2].elements).toEqual([]);
});

test("an independent deck with an embedded workbook is refused without weakening package admission", async () => {
  await expect(importPptx(await fixture("shp-shapes.pptx"))).rejects.toMatchObject({code:"unsafe"});
});

test("an independent PowerPoint file keeps 16:9 size and authored speaker notes without the print-layout page number", async () => {
  const result = await importPptx(await fixture("notes-slide-image.pptx"));
  expect(result.slideSize).toEqual({widthEmu:12192000,heightEmu:6858000});
  expect(result.slides).toHaveLength(1);
  expect(result.slides[0].elements.some(element => element.text?.includes("Notes image placeholder oracle"))).toBe(true);
  expect(result.slides[0].notes).toBe("Speaker notes so PowerPoint emits the notes slide.");
});

test("PowerPoint semantic roundtrip keeps exact physical size, text geometry, shape rotation and notes", async () => {
  const exported = await exportPptx(presentation);
  const result = await importPptx(new Uint8Array(await exported.blob.arrayBuffer()));
  expect(result.slideSize).toEqual({widthEmu:9144000,heightEmu:6858000});
  expect(result.slides[0].background.toLowerCase()).toBe("#123456");
  const text = result.slides[0].elements.find(element => element.text === "Known editable text")!;
  expect([text.x,text.y,text.width,text.height]).toEqual([96,96,384,96]);
  expect(text.bold).toBe(true);
  const ellipse = result.slides[0].elements.find(element => element.shapeType === "ellipse")!;
  expect([ellipse.x,ellipse.y,ellipse.width,ellipse.height,ellipse.rotation]).toEqual([96,300,192,96,15]);
  expect(result.slides[0].notes).toBe("Known speaker note");
});

import { renderSlideToBuffer } from "../lib/server-renderer.ts";
import { createCanvas, loadImage } from "canvas";

test("a common unfilled PowerPoint shape stays transparent through file exchange and actual rendering", async () => {
  const source: Presentation = {...presentation,slides:[{id:"outline",background:"#123456",elements:[{id:"unfilled",type:"shape",shapeType:"rect",x:96,y:96,width:384,height:192,rotation:0,fillColor:"transparent",strokeColor:"#000000",strokeWidth:2}]}]};
  const written = await exportPptx(source);
  expect(written.hasUnsupportedContent).toBe(false);
  const imported = await importPptx(new Uint8Array(await written.blob.arrayBuffer()));
  const image = await loadImage(Buffer.from(await renderSlideToBuffer(imported.slides[0],400,300,imported.slideSize)));
  const canvas = createCanvas(400,300), context=canvas.getContext("2d");context.drawImage(image,0,0);
  expect([...context.getImageData(100,75,1,1).data]).toEqual([18,52,86,255]);
});

for (const [name,element] of [
  ["negative text size",{...presentation.slides[0].elements[0],fontSize:-1}],
  ["nonrepresentable geometry",{...presentation.slides[0].elements[1],x:1e20}],
] as const) {
  test(`PowerPoint export refuses ${name} before downloading`, async () => {
    const invalid: Presentation = {...presentation,slides:[{...presentation.slides[0],elements:[element]}]};
    await expect(exportPptx(invalid)).rejects.toThrow();
  });
}

import { parseOfficeXml, writeOfficeArchive } from "../../../shared/lib/office-archive.ts";

for (const [kind,fragment] of [
  ["gradient",'<a:gradFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill>'],
  ["custom geometry",'<a:custGeom xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="w" b="h"/><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="50" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>'],
] as const) {
  test(`a standard no-text ${kind} shape exposes the partial-conversion warning`, async () => {
    const output = await exportPptx({...presentation,slides:[{id:"single-shape",background:"#ffffff",elements:[presentation.slides[0].elements[1]]}]});
    expect((await importPptx(new Uint8Array(await output.blob.arrayBuffer()))).hasUnsupportedContent).toBe(false);
    const pkg = await readOfficePackage(new Uint8Array(await output.blob.arrayBuffer()));
    const part = "ppt/slides/slide1.xml", document = pkg.xmlParts.get(part)!;
    const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const geometry = Array.from(document.getElementsByTagNameNS(ns,"prstGeom")).find(item=>item.getAttribute("prst")==="ellipse")!;
    const properties = geometry.parentNode!;
    const replacement = parseOfficeXml(new TextEncoder().encode(fragment)).documentElement!;
    const old = kind==="gradient" ? Array.from(properties.childNodes).find(item=>item.nodeType===1 && item.localName==="solidFill")! : geometry;
    properties.replaceChild(document.importNode(replacement,true),old);
    pkg.parts.set(part,new TextEncoder().encode(document.toString()));
    const result = await importPptx(await writeOfficeArchive(pkg.parts));
    expect(result.hasUnsupportedContent).toBe(true);
  });
}

test("a plain textbox with explicit no bullets neither invents a backing shape nor reports a partial conversion", async () => {
  const source = {...presentation,slides:[{id:"single-text",background:"#ffffff",elements:[presentation.slides[0].elements[0]]}]};
  const output = await exportPptx(source);
  const imported = await importPptx(new Uint8Array(await output.blob.arrayBuffer()));
  expect(imported.slides[0].elements.map(element=>element.type)).toEqual(["text"]);
  expect(imported.hasUnsupportedContent).toBe(false);
});
