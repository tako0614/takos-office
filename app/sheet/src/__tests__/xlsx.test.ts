import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { exportXlsx, importXlsx } from "../lib/xlsx.ts";
import { readOfficePackage, isOfficeRelationship } from "../../../shared/lib/office-package.ts";
import { readOfficeArchive, writeOfficeArchive } from "../../../shared/lib/office-archive.ts";
import { applyNumberFormat } from "../lib/number-format.ts";

const fixture = (name: string) => readFile(new URL(`./fixtures/xlsx/${name}`, import.meta.url));

async function withCells(rows: string, date1904 = false) {
  const parts = await readOfficeArchive(new Uint8Array(await fixture("tutorial03.xlsx")));
  const name = "xl/worksheets/sheet1.xml", xml = new TextDecoder().decode(parts.get(name));
  parts.set(name, new TextEncoder().encode(xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${rows}</sheetData>`)));
  if (date1904) {
    const workbook = new TextDecoder().decode(parts.get("xl/workbook.xml"));
    parts.set("xl/workbook.xml", new TextEncoder().encode(workbook.replace(/<workbookPr[^>]*\/>/, '<workbookPr date1904="1"/>')));
  }
  return writeOfficeArchive(parts);
}

test("typed literals and shared-formula followers retain their original Excel meaning", async () => {
  const bytes = await withCells('<row r="1"><c r="A1" t="inlineStr"><is><t>123</t></is></c><c r="B1"><v>5</v></c><c r="C1"><f t="shared" ref="C1:C2" si="0">B1*2</f><v>10</v></c><c r="D1" t="inlineStr"><is><t>=1+1</t></is></c><c r="E1" t="b"><v>1</v></c><c r="F1" t="e"><v>#N/A</v></c></row><row r="2"><c r="B2"><v>7</v></c><c r="C2"><f t="shared" si="0"/><v>14</v></c></row>');
  const imported = await importXlsx(bytes), cells = imported.spreadsheet.sheets[0].cells;
  expect(cells.A1).toMatchObject({ value: "123", valueType: "text" });
  expect(cells.D1).toMatchObject({ value: "=1+1", valueType: "text" });
  expect(cells.E1).toMatchObject({ value: "TRUE", valueType: "boolean" });
  expect(cells.F1).toMatchObject({ value: "#N/A", valueType: "error" });
  expect(cells.C2).toMatchObject({ value: "=B2*2", computed: "14", computedType: "number" });
  const exported = await exportXlsx(imported.spreadsheet);
  const again = (await importXlsx(new Uint8Array(await exported.blob.arrayBuffer()))).spreadsheet.sheets[0].cells;
  expect(again.A1.valueType).toBe("text");
  expect(again.D1.valueType).toBe("text");
  expect(again.E1.valueType).toBe("boolean");
  expect(again.F1.valueType).toBe("error");
});

test("1904 date cells and date-formula caches normalize to the existing editor's date system", async () => {
  const imported = await importXlsx(await withCells('<row r="1"><c r="A1" s="2"><v>0</v></c><c r="B1" s="2"><f>A1</f><v>0</v></c></row>', true));
  const cells = imported.spreadsheet.sheets[0].cells;
  expect(cells.A1.value).toBe("1462");
  expect(cells.B1.computed).toBe("1462");
  expect(applyNumberFormat(cells.A1.value, cells.A1.format?.numberFormat)).toBe("January 1 1904");
});

test("unsafe formula hyperlinks are refused without refusing safe ordinary hyperlinks", async () => {
  const formula = (target: string) => withCells(`<row r="1"><c r="A1" t="str"><f>HYPERLINK("${target}","link")</f><v>link</v></c></row>`);
  await expect(importXlsx(await formula("javascript:alert(1)"))).rejects.toMatchObject({ code: "unsafe" });
  expect((await importXlsx(await formula("https://example.com/"))).spreadsheet.sheets[0].cells.A1.computed).toBe("link");
});

test("defined names remain symbolic metadata instead of being expanded or lost by the codec", async () => {
  const parts = await readOfficeArchive(new Uint8Array(await fixture("set_row01.xlsx")));
  const workbook = new TextDecoder().decode(parts.get("xl/workbook.xml"));
  parts.set("xl/workbook.xml", new TextEncoder().encode(workbook.replace("</sheets>", '</sheets><definedNames><definedName name="Area">Sheet1!$A$1:$CV$101</definedName></definedNames>')));
  const imported = await importXlsx(await writeOfficeArchive(parts));
  expect(imported.spreadsheet.definedNames).toEqual([{ name: "Area", reference: "Sheet1!$A$1:$CV$101" }]);
  const output = await exportXlsx(imported.spreadsheet);
  const pkg = await readOfficePackage(new Uint8Array(await output.blob.arrayBuffer()));
  const xml = pkg.xmlParts.get(pkg.mainPart)!, ns = xml.documentElement!.namespaceURI!;
  expect(xml.getElementsByTagNameNS(ns, "definedName").item(0)?.textContent).toBe("Sheet1!$A$1:$CV$101");
});

test("an independent Excel workbook retains values, formula cache, date/currency formats and column width", async () => {
  const { spreadsheet } = await importXlsx(new Uint8Array(await fixture("tutorial03.xlsx")));
  const sheet = spreadsheet.sheets[0];
  expect(sheet.cells.A1.value).toBe("Item");
  expect(sheet.cells.A1.valueType).toBe("text");
  expect(sheet.cells.A1.format?.bold).toBe(true);
  expect(sheet.cells.C2.value).toBe("1000");
  expect(sheet.cells.C2.valueType).toBe("number");
  expect(sheet.cells.C6.value).toBe("=SUM(C2:C5)");
  expect(sheet.cells.C6.computed).toBe("1450");
  expect(sheet.cells.C6.computedType).toBe("number");
  expect(sheet.cells.B2.value).toBe("41287");
  expect(sheet.cells.B2.format?.numberFormat).toBe("mmmm\\ d\\ yyyy");
  expect(sheet.cells.C2.format?.numberFormat).toBe("\\$#,##0");
  expect(sheet.colWidths[1]).toBeCloseTo(114.9765625, 6);
});

test("a compact merge range cannot materialize more than the admitted cell budget inside the codec", async () => {
  const parts = await readOfficeArchive(new Uint8Array(await fixture("set_row01.xlsx")));
  const name = "xl/worksheets/sheet1.xml";
  const xml = new TextDecoder().decode(parts.get(name));
  parts.set(name, new TextEncoder().encode(xml.replace("</worksheet>", '<mergeCells count="1"><mergeCell ref="A1:CV101"/></mergeCells></worksheet>')));
  await expect(importXlsx(await writeOfficeArchive(parts))).rejects.toThrow("too large");
});

test("a foreign namespace cannot bypass the pre-codec merge budget", async () => {
  const parts = await readOfficeArchive(new Uint8Array(await fixture("set_row01.xlsx")));
  const name = "xl/worksheets/sheet1.xml", xml = new TextDecoder().decode(parts.get(name));
  parts.set(name, new TextEncoder().encode(xml.replace("</worksheet>", '<mergeCells xmlns="urn:foreign" count="1"><mergeCell ref="A1:CV101"/></mergeCells></worksheet>')));
  await expect(importXlsx(await writeOfficeArchive(parts))).rejects.toThrow();
});

test("Excel export writes real worksheet formula/cache and retained custom formats into a standard package", async () => {
  const { spreadsheet } = await importXlsx(new Uint8Array(await fixture("tutorial03.xlsx")));
  const output = await exportXlsx(spreadsheet);
  expect(output.blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const pkg = await readOfficePackage(new Uint8Array(await output.blob.arrayBuffer()));
  const worksheet = [...pkg.relationships.get(pkg.mainPart)!.values()].find(r => isOfficeRelationship(r, "worksheet"))!;
  const xml = pkg.xmlParts.get(worksheet.target)!, ns = xml.documentElement!.namespaceURI!;
  const sum = Array.from(xml.getElementsByTagNameNS(ns, "c")).find(c => c.getAttribute("r") === "C6")!;
  expect(sum.getElementsByTagNameNS(ns, "f").item(0)?.textContent).toBe("SUM(C2:C5)");
  expect(sum.getElementsByTagNameNS(ns, "v").item(0)?.textContent).toBe("1450");
  const formats = pkg.xmlParts.get("xl/styles.xml")!;
  expect(Array.from(formats.getElementsByTagNameNS(ns, "numFmt")).map(f => f.getAttribute("formatCode"))).toContain("mmmm\\ d\\ yyyy");
  const reimported = await importXlsx(new Uint8Array(await output.blob.arrayBuffer()));
  expect(reimported.spreadsheet.sheets[0].cells.C6.computed).toBe("1450");
  expect(reimported.spreadsheet.sheets[0].cells.A1.valueType).toBe("text");
});
