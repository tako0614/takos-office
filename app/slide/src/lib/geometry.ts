/**
 * Pure 2D geometry helpers for the slide editor.
 *
 * Elements are stored as an axis-aligned box (`x`, `y`, `width`, `height`) plus
 * a `rotation` in degrees applied about the box centre (see
 * `renderElement` in `canvas-renderer.ts`, which translates to the centre,
 * rotates clockwise by `rotation` degrees, then translates back).
 *
 * To hit-test or resize a rotated element we transform the pointer from slide
 * (screen) space into the element's UNROTATED local space by rotating the point
 * about the element centre by `-rotation`. In that local frame the element is
 * an axis-aligned box again, so the existing bbox / handle maths apply
 * unchanged. These helpers are deliberately framework-free and side-effect-free
 * so they can be unit-tested directly.
 */

import type { SlideElement } from "../types/index.ts";

export interface Point {
  x: number;
  y: number;
}

/**
 * Rotate a point `(px, py)` about the centre `(cx, cy)` by `angleDeg` degrees
 * clockwise (matching the canvas `ctx.rotate` convention used by the renderer,
 * where positive angle rotates the +x axis towards +y on a y-down canvas).
 *
 * Returns a new point; the inputs are not mutated. An angle of `0` returns the
 * point unchanged (modulo floating-point identity) so unrotated elements behave
 * exactly as before.
 */
export function rotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  angleDeg: number,
): Point {
  if (angleDeg === 0) return { x: px, y: py };
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

/**
 * The centre of an element's axis-aligned box.
 */
export function elementCenter(element: SlideElement): Point {
  return {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  };
}

/**
 * Map a point from slide (screen) space into the element's UNROTATED local
 * space by inverse-rotating it about the element centre by `-rotation`.
 *
 * In the returned frame the element occupies its plain axis-aligned box, so the
 * standard `x..x+width` / `y..y+height` containment and handle tests are valid
 * even for rotated elements. For an element with `rotation === 0` this returns
 * the point unchanged.
 */
export function toElementLocal(point: Point, element: SlideElement): Point {
  const c = elementCenter(element);
  return rotatePoint(point.x, point.y, c.x, c.y, -(element.rotation ?? 0));
}

/**
 * Which resize handle is being dragged. `n`/`s`/`e`/`w` are edge midpoints and
 * `nw`/`ne`/`sw`/`se` are corners.
 */
export type ResizeHandleId =
  | "nw"
  | "ne"
  | "sw"
  | "se"
  | "n"
  | "s"
  | "w"
  | "e";

export interface BoxGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute the new axis-aligned box for a rotated element being resized by
 * dragging `handle` from the pointer position `start` to `current` (both in
 * slide/screen space).
 *
 * The maths is done in the element's local (unrotated) frame so the drag feels
 * natural regardless of rotation:
 *  1. the screen-space delta is inverse-rotated into the local frame,
 *  2. width/height change per the dragged edge(s) (clamped to `minSize`),
 *  3. the local edge/corner OPPOSITE the handle is held fixed, and that anchor
 *     is mapped back to screen space to recover the new top-left `x`/`y`.
 *
 * For `rotation === 0` the local delta equals the screen delta and this reduces
 * exactly to the classic `newW = w + dx` / `newX = x + dx` edge maths, so
 * unrotated resize is unchanged.
 */
export function resizeRotatedBox(
  element: Pick<SlideElement, "x" | "y" | "width" | "height" | "rotation">,
  handle: ResizeHandleId,
  start: Point,
  current: Point,
  minSize = 20,
): BoxGeometry {
  const rotation = element.rotation ?? 0;
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;

  // Screen-space delta inverse-rotated into the element's local frame. We
  // inverse-rotate the delta vector directly (rotation about the origin) rather
  // than two absolute points so it is independent of the centre.
  const local = rotatePoint(
    current.x - start.x,
    current.y - start.y,
    0,
    0,
    -rotation,
  );
  const dx = local.x;
  const dy = local.y;

  let newW = element.width;
  let newH = element.height;
  // Local-frame offsets of the box's top-left corner relative to the centre.
  // The dragged edges move; the opposite edges stay fixed, so we track how the
  // local top-left shifts.
  let leftShift = 0; // added to local left edge when dragging "w"
  let topShift = 0; // added to local top edge when dragging "n"

  if (handle.includes("e")) {
    newW = Math.max(minSize, element.width + dx);
  }
  if (handle.includes("w")) {
    newW = Math.max(minSize, element.width - dx);
    // Clamping limits how far the left edge can move inward.
    leftShift = element.width - newW;
  }
  if (handle.includes("s")) {
    newH = Math.max(minSize, element.height + dy);
  }
  if (handle.includes("n")) {
    newH = Math.max(minSize, element.height - dy);
    topShift = element.height - newH;
  }

  // The element's original local top-left (relative to centre) is
  // (-width/2, -height/2). After the resize, the new local top-left is that
  // plus the shifts from dragging w/n edges. The new centre in local space is
  // the new top-left plus half the new size.
  const oldLocalLeft = -element.width / 2;
  const oldLocalTop = -element.height / 2;
  const newLocalLeft = oldLocalLeft + leftShift;
  const newLocalTop = oldLocalTop + topShift;
  const newLocalCenterX = newLocalLeft + newW / 2;
  const newLocalCenterY = newLocalTop + newH / 2;

  // Map the new local centre offset back into screen space to get the new
  // absolute centre, then derive the axis-aligned top-left.
  const rotatedCenterOffset = rotatePoint(
    newLocalCenterX,
    newLocalCenterY,
    0,
    0,
    rotation,
  );
  const newCx = cx + rotatedCenterOffset.x;
  const newCy = cy + rotatedCenterOffset.y;

  return {
    x: newCx - newW / 2,
    y: newCy - newH / 2,
    width: newW,
    height: newH,
  };
}
