import { expect, test } from "bun:test";
import { createCanvas, loadImage } from "canvas";
import { renderSlideToBuffer } from "../lib/server-renderer.ts";
import type { Slide } from "../types/index.ts";

const fourByThree = {widthEmu:9_144_000,heightEmu:6_858_000};
const bottomBand: Slide = {
  id:"physical-slide",background:"#ffffff",elements:[{
    id:"bottom-red",type:"shape",shapeType:"rect",x:0,y:600,width:960,height:120,rotation:0,fillColor:"#ff0000",strokeWidth:0,
  }],
};

test("a 4:3 slide's bottom element remains inside its native PNG at the original proportions", async () => {
  const bytes = await renderSlideToBuffer(bottomBand,400,300,fourByThree);
  const image = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(400,300), context = canvas.getContext("2d");
  context.drawImage(image,0,0);
  expect([image.width,image.height]).toEqual([400,300]);
  expect([...context.getImageData(200,275,1,1).data]).toEqual([255,0,0,255]);
  expect([...context.getImageData(200,100,1,1).data]).toEqual([255,255,255,255]);
});

import { renderThumbnail } from "../lib/canvas-renderer.ts";

test("a 4:3 library thumbnail keeps its page aspect and bottom content", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis,"document");
  Object.defineProperty(globalThis,"document",{configurable:true,value:{createElement:(tag: string)=>{expect(tag).toBe("canvas");return createCanvas(1,1);}}});
  try {
    const canvas = renderThumbnail(bottomBand,400,fourByThree);
    expect([canvas.width,canvas.height]).toEqual([400,300]);
    expect([...canvas.getContext("2d")!.getImageData(200,275,1,1).data]).toEqual([255,0,0,255]);
  } finally {
    if(descriptor) Object.defineProperty(globalThis,"document",descriptor);
    else Reflect.deleteProperty(globalThis,"document");
  }
});

import { exportPresentationToPdf } from "../lib/pdf-exporter.ts";

test("PDF retains an imported 10 by 7.5 inch page while legacy decks keep their previous page size", async () => {
  const base = {id:"pdf-size",title:"Size",slides:[bottomBand],createdAt:"2026-11-08T00:00:00.000Z",updatedAt:"2026-11-08T00:00:00.000Z"};
  const pageSize = (bytes: Uint8Array) => {
    const match = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(new TextDecoder("latin1").decode(bytes));
    expect(match).not.toBeNull();
    return [Number(match![1]),Number(match![2])];
  };
  const physical = pageSize(await exportPresentationToPdf({...base,slideSize:fourByThree}));
  expect(physical[0]).toBeCloseTo(720,2);
  expect(physical[1]).toBeCloseTo(540,2);
  const legacy = pageSize(await exportPresentationToPdf(base));
  expect(legacy[0]).toBeCloseTo(841.88976378,2);
  expect(legacy[1]).toBeCloseTo(473.56299213,2);
});
