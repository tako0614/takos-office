import { expect, test } from "bun:test";
import {
  elementCenter,
  resizeRotatedBox,
  rotatePoint,
  toElementLocal,
} from "../lib/geometry.ts";
import type { SlideElement } from "../types/index.ts";

function makeElement(
  overrides: Partial<SlideElement> = {},
): SlideElement {
  return {
    id: "el-1",
    type: "shape",
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    rotation: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// rotatePoint
// ---------------------------------------------------------------------------

test("rotatePoint with angle 0 returns the point unchanged", () => {
  expect(rotatePoint(5, 7, 0, 0, 0)).toEqual({ x: 5, y: 7 });
  expect(rotatePoint(123, -45, 10, 20, 0)).toEqual({ x: 123, y: -45 });
});

test("rotatePoint rotates 90 degrees clockwise about a centre", () => {
  // Canvas convention (y-down): +90deg maps +x axis towards +y.
  // Point (1, 0) about origin -> (0, 1).
  const p = rotatePoint(1, 0, 0, 0, 90);
  expect(p.x).toBeCloseTo(0, 10);
  expect(p.y).toBeCloseTo(1, 10);

  // About a non-origin centre (10, 10): point (11, 10) -> (10, 11).
  const q = rotatePoint(11, 10, 10, 10, 90);
  expect(q.x).toBeCloseTo(10, 10);
  expect(q.y).toBeCloseTo(11, 10);
});

test("rotatePoint rotates 180 degrees about a centre (point reflection)", () => {
  // 180deg about (10, 20): (15, 25) -> (5, 15).
  const p = rotatePoint(15, 25, 10, 20, 180);
  expect(p.x).toBeCloseTo(5, 10);
  expect(p.y).toBeCloseTo(15, 10);
});

test("rotatePoint is invertible: rotating by -angle undoes it", () => {
  const forward = rotatePoint(42, 17, 10, 10, 37);
  const back = rotatePoint(forward.x, forward.y, 10, 10, -37);
  expect(back.x).toBeCloseTo(42, 9);
  expect(back.y).toBeCloseTo(17, 9);
});

// ---------------------------------------------------------------------------
// elementCenter / toElementLocal
// ---------------------------------------------------------------------------

test("elementCenter returns the box centre", () => {
  expect(elementCenter(makeElement())).toEqual({ x: 200, y: 150 });
});

test("toElementLocal is the identity for rotation 0", () => {
  const el = makeElement({ rotation: 0 });
  const local = toElementLocal({ x: 250, y: 130 }, el);
  expect(local.x).toBeCloseTo(250, 10);
  expect(local.y).toBeCloseTo(130, 10);
});

test("a point inside a rotated rect maps inside the local box", () => {
  // Rotated 45deg about its centre (200, 150).
  const el = makeElement({ rotation: 45 });
  const center = elementCenter(el);

  // A screen-space point that lies on the rotated element: take a point that is
  // clearly inside the unrotated local box, rotate it into screen space, then
  // confirm toElementLocal maps it back inside the box.
  const localTarget = { x: 230, y: 160 }; // inside [100..300] x [100..200]
  const screen = rotatePoint(
    localTarget.x,
    localTarget.y,
    center.x,
    center.y,
    el.rotation,
  );

  const local = toElementLocal(screen, el);
  expect(local.x).toBeGreaterThanOrEqual(el.x);
  expect(local.x).toBeLessThanOrEqual(el.x + el.width);
  expect(local.y).toBeGreaterThanOrEqual(el.y);
  expect(local.y).toBeLessThanOrEqual(el.y + el.height);
  // And it round-trips back to the local target.
  expect(local.x).toBeCloseTo(localTarget.x, 9);
  expect(local.y).toBeCloseTo(localTarget.y, 9);
});

test("a point outside a rotated rect maps outside the local box", () => {
  const el = makeElement({ rotation: 45 });
  const center = elementCenter(el);

  // Far outside the local box, then rotate into screen space.
  const localTarget = { x: 500, y: 150 }; // x well beyond x+width (300)
  const screen = rotatePoint(
    localTarget.x,
    localTarget.y,
    center.x,
    center.y,
    el.rotation,
  );

  const local = toElementLocal(screen, el);
  const inside = local.x >= el.x &&
    local.x <= el.x + el.width &&
    local.y >= el.y &&
    local.y <= el.y + el.height;
  expect(inside).toBe(false);
});

test("rotation makes the difference: a corner of the unrotated box is no longer hit once rotated", () => {
  // The top-right screen corner (300, 100) is on the boundary of the unrotated
  // box but, once the element is rotated 90deg, that same screen point falls
  // outside the element's local box.
  const unrotated = makeElement({ rotation: 0 });
  const localUnrotated = toElementLocal({ x: 300, y: 100 }, unrotated);
  expect(localUnrotated.x).toBeCloseTo(300, 9);
  expect(localUnrotated.y).toBeCloseTo(100, 9);

  const rotated = makeElement({ rotation: 90 });
  const localRotated = toElementLocal({ x: 300, y: 100 }, rotated);
  const inside = localRotated.x >= rotated.x &&
    localRotated.x <= rotated.x + rotated.width &&
    localRotated.y >= rotated.y &&
    localRotated.y <= rotated.y + rotated.height;
  expect(inside).toBe(false);
});

// ---------------------------------------------------------------------------
// resizeRotatedBox
// ---------------------------------------------------------------------------

test("resizeRotatedBox matches classic edge maths for rotation 0 (east handle)", () => {
  const el = makeElement({ rotation: 0 });
  // Drag the east edge +40px.
  const box = resizeRotatedBox(
    el,
    "e",
    { x: 300, y: 150 },
    { x: 340, y: 150 },
  );
  expect(box.x).toBeCloseTo(100, 9);
  expect(box.y).toBeCloseTo(100, 9);
  expect(box.width).toBeCloseTo(240, 9);
  expect(box.height).toBeCloseTo(100, 9);
});

test("resizeRotatedBox matches classic edge maths for rotation 0 (west handle moves x)", () => {
  const el = makeElement({ rotation: 0 });
  // Drag the west edge -30px (left): x decreases, width grows by 30.
  const box = resizeRotatedBox(
    el,
    "w",
    { x: 100, y: 150 },
    { x: 70, y: 150 },
  );
  expect(box.x).toBeCloseTo(70, 9);
  expect(box.width).toBeCloseTo(230, 9);
  expect(box.y).toBeCloseTo(100, 9);
  expect(box.height).toBeCloseTo(100, 9);
});

test("resizeRotatedBox keeps the opposite edge fixed when rotated (east handle, 90deg)", () => {
  const el = makeElement({ rotation: 90 });
  // For a 90deg rotation, dragging the (local) east edge by a screen vector that
  // is +40 in screen-y corresponds to +40 in local-x, so width grows by 40 and
  // the local west edge stays put.
  const before = resizeRotatedBox(
    el,
    "e",
    { x: 200, y: 150 },
    { x: 200, y: 190 },
  );
  expect(before.width).toBeCloseTo(240, 6);
  expect(before.height).toBeCloseTo(100, 6);
});

test("resizeRotatedBox clamps to the minimum size", () => {
  const el = makeElement({ rotation: 0, width: 200 });
  // Drag east edge far to the left, past the minimum.
  const box = resizeRotatedBox(
    el,
    "e",
    { x: 300, y: 150 },
    { x: 0, y: 150 },
    20,
  );
  expect(box.width).toBe(20);
});
