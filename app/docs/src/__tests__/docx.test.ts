import { expect, test } from "bun:test";
import { readOfficeArchive, parseOfficeXml } from "../../../shared/lib/office-archive.ts";
import { exportDocx } from "../lib/docx-export.ts";

test("DOCX download is a real Word package with heading, text and bold formatting", async () => {
  const content = JSON.stringify({ type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Known heading" }] },
    { type: "paragraph", content: [{ type: "text", text: "Known bold text", marks: [{ type: "bold" }] }] },
  ] });
  const { blob } = await exportDocx("Known title", content);
  const parts = await readOfficeArchive(new Uint8Array(await blob.arrayBuffer()));
  expect(parts.has("[Content_Types].xml")).toBe(true);
  const doc = parseOfficeXml(parts.get("word/document.xml")!);
  const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  expect(doc.getElementsByTagNameNS(ns, "pStyle").item(0)?.getAttributeNS(ns, "val")).toBe("Heading2");
  expect(doc.getElementsByTagNameNS(ns, "b").length).toBeGreaterThan(0);
  expect(doc.getElementsByTagNameNS(ns, "t").item(0)?.textContent).toBe("Known heading");
  expect(doc.getElementsByTagNameNS(ns, "t").item(1)?.textContent).toBe("Known bold text");
});

import { importDocx } from "../lib/docx-import.ts";

async function fixture(name: string) {
  return new Uint8Array(await Bun.file(new URL(`./fixtures/docx/${name}`, import.meta.url)).arrayBuffer());
}

test("an independent Word list imports as editable bullet list items", async () => {
  const result = await importDocx(await fixture("simple-list.docx"));
  const model = JSON.parse(result.content);
  expect(model.content[0].type).toBe("bulletList");
  expect(model.content[0].content.map((item: {content: {content: {text: string}[]}[]}) => item.content[0].content[0].text)).toEqual(["Apple", "Banana"]);
});

test("an independent Word table retains its cells and surrounding paragraphs", async () => {
  const result = await importDocx(await fixture("tables.docx"));
  const model = JSON.parse(result.content);
  expect(model.content.map((node: {type: string}) => node.type)).toEqual(["paragraph", "table", "paragraph"]);
  const cells = model.content[1].content.flatMap((row: {content: {content: {content: {text: string}[]}[]}[]}) => row.content.map(cell => cell.content[0].content[0].text));
  expect(cells).toEqual(["Top left", "Top right", "Bottom left", "Bottom right"]);
  expect(model.content[0].content[0].text).toBe("Above");
  expect(model.content[2].content[0].text).toBe("Below");
});

test("an independent Word PNG imports as a validated embedded editor image", async () => {
  const result = await importDocx(await fixture("tiny-picture.docx"));
  const model = JSON.parse(result.content);
  expect(model.content[0].type).toBe("image");
  expect(model.content[0].attrs.src).toStartWith("data:image/png;base64,");
  expect(model.content[0].attrs.width).toBeGreaterThan(0);
  expect(model.content[0].attrs.height).toBeGreaterThan(0);
});

import { writeOfficeArchive, OfficeFileError } from "../../../shared/lib/office-archive.ts";

async function modifiedWord(change: (parts: Map<string, Uint8Array>) => void) {
  const parts = await readOfficeArchive(await fixture("simple-list.docx"));
  change(parts);
  return writeOfficeArchive(parts);
}

test("DOCX semantic roundtrip retains common marks, nested lists, tables and safe links", async () => {
  const text = (value: string, marks?: {type: string; attrs?: Record<string,unknown>}[]) => ({type:"text",text:value,...(marks ? {marks}: {})});
  const paragraph = (value: string) => ({type:"paragraph",content:[text(value)]});
  const model = {type:"doc",content:[
    {type:"heading",attrs:{level:1},content:[text("Semantic heading")]},
    {type:"paragraph",content:[text("Bold italic underline",[{type:"bold"},{type:"italic"},{type:"underline"}]),text("Safe link",[{type:"link",attrs:{href:"https://example.invalid/reference"}}])]},
    {type:"bulletList",content:[{type:"listItem",content:[paragraph("Outer"),{type:"orderedList",attrs:{start:1},content:[{type:"listItem",content:[paragraph("Inner")]}]}]}]},
    {type:"table",content:[{type:"tableRow",content:[{type:"tableCell",content:[paragraph("Cell one")]},{type:"tableCell",content:[paragraph("Cell two")]}]}]},
  ]};
  const exported = await exportDocx("Semantic title",JSON.stringify(model));
  const imported = await importDocx(new Uint8Array(await exported.blob.arrayBuffer()));
  const parsed = JSON.parse(imported.content);
  expect(imported.title).toBe("Semantic title");
  expect(parsed.content[0]).toMatchObject({type:"heading",attrs:{level:1}});
  const marked = parsed.content[1].content.find((node: {text:string}) => node.text === "Bold italic underline");
  expect(marked.marks.map((mark: {type:string}) => mark.type).sort()).toEqual(["bold","italic","underline"]);
  expect(parsed.content[1].content.find((node: {text:string}) => node.text === "Safe link").marks).toContainEqual({type:"link",attrs:{href:"https://example.invalid/reference"}});
  expect(imported.content).toContain('"bulletList"');
  expect(imported.content).toContain('"orderedList"');
  expect(imported.content).toContain('"table"');
  expect(imported.content).toContain("Cell two");
});

test("an embedded raster image survives DOCX export and import without network access", async () => {
  const independent = await importDocx(await fixture("tiny-picture.docx"));
  const exported = await exportDocx("Embedded",independent.content);
  const imported = await importDocx(new Uint8Array(await exported.blob.arrayBuffer()));
  expect(JSON.parse(imported.content).content[0].attrs.src).toBe(JSON.parse(independent.content).content[0].attrs.src);
});

test("external image relationships and forged officeDocument relation types are rejected before conversion", async () => {
  const text = new TextEncoder();
  const external = await modifiedWord(parts => {
    parts.set("word/_rels/document.xml.rels",text.encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="external-image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" TargetMode="External" Target="https://not-allowed.invalid/private.png"/></Relationships>'));
  });
  await expect(importDocx(external)).rejects.toMatchObject({code:"unsafe"});
  const forged = await modifiedWord(parts => {
    parts.set("_rels/.rels",text.encode(new TextDecoder().decode(parts.get("_rels/.rels")).replace('http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument','https://forged.invalid/officeDocument')));
  });
  await expect(importDocx(forged)).rejects.toBeInstanceOf(OfficeFileError);
});

test("remote images and unsafe links are never fetched during export", async () => {
  const result = await exportDocx("No remote access",JSON.stringify({type:"doc",content:[
    {type:"image",attrs:{src:"https://not-allowed.invalid/image.png",alt:"Remote illustration"}},
    {type:"paragraph",content:[{type:"text",text:"Unsafe link",marks:[{type:"link",attrs:{href:"javascript:alert(1)"}}]}]},
  ]}));
  expect(result.hasUnsupportedContent).toBe(true);
  const parts = await readOfficeArchive(new Uint8Array(await result.blob.arrayBuffer()));
  expect(new TextDecoder().decode(parts.get("word/document.xml"))).toContain("[Image: Remote illustration]");
  for(const [name,bytes] of parts) if(name.endsWith(".rels")) {
    expect(new TextDecoder().decode(bytes)).not.toContain("not-allowed.invalid");
    expect(new TextDecoder().decode(bytes)).not.toContain("javascript:");
  }
});

import { htmlToOfficeDocument, rasterDataUrl } from "../lib/docx-model.ts";

test("aggregate embedded image dimensions are bounded before editor adoption or Word export", async () => {
  // Adversarial raster headers: no decoder or canvas allocation is performed.
  const raster = new Uint8Array(24);
  raster.set([137,80,78,71,13,10,26,10]);
  const view = new DataView(raster.buffer);
  view.setUint32(16,4000); view.setUint32(20,5000);
  const src = rasterDataUrl(raster,"image/png");
  expect(() => htmlToOfficeDocument(`<p><img src="${src}"/><img src="${src}"/></p>`)).toThrow(OfficeFileError);
  await expect(exportDocx("Too many pixels",JSON.stringify({type:"doc",content:[{type:"image",attrs:{src}},{type:"image",attrs:{src}}]}))).rejects.toMatchObject({code:"too-large"});
});
