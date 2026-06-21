import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { Slide, SlideElement } from "../types";
import {
  hitTestElements,
  hitTestHandles,
  renderSlide,
  type ResizeHandle,
} from "../lib/canvas-renderer";

// Internal slide coordinate space
const SLIDE_W = 960;
const SLIDE_H = 540;

interface SlideCanvasProps {
  slide: Slide;
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  onUpdateElement: (element: SlideElement) => void;
  onEditText: (elementId: string) => void;
}

export default function SlideCanvas(props: SlideCanvasProps) {
  let canvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  const [canvasSize, setCanvasSize] = createSignal({ w: 960, h: 540 });
  const [dragging, setDragging] = createSignal(false);
  const [resizing, setResizing] = createSignal<ResizeHandle | null>(null);
  const [dragStart, setDragStart] = createSignal({ x: 0, y: 0 });
  const [elementStart, setElementStart] = createSignal({
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  });

  const scale = () => canvasSize().w / SLIDE_W;

  const toSlideCoords = (clientX: number, clientY: number) => {
    if (!canvasRef) return { x: 0, y: 0 };
    const rect = canvasRef.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / scale(),
      y: (clientY - rect.top) / scale(),
    };
  };

  const redraw = () => {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;

    const { w, h } = canvasSize();
    const pixelRatio = globalThis.devicePixelRatio || 1;
    canvasRef.width = w * pixelRatio;
    canvasRef.height = h * pixelRatio;
    canvasRef.style.width = `${w}px`;
    canvasRef.style.height = `${h}px`;

    ctx.scale(pixelRatio, pixelRatio);

    renderSlide(ctx, props.slide, w, h, {
      selectedElementId: props.selectedElementId,
      showHandles: true,
      scale: scale(),
    });
  };

  const updateSize = () => {
    if (!containerRef) return;
    const containerW = containerRef.clientWidth - 32; // padding
    const containerH = containerRef.clientHeight - 32;
    const scaleW = containerW / SLIDE_W;
    const scaleH = containerH / SLIDE_H;
    const s = Math.min(scaleW, scaleH, 1.5);
    setCanvasSize({ w: Math.floor(SLIDE_W * s), h: Math.floor(SLIDE_H * s) });
  };

  onMount(() => {
    updateSize();
    const observer = new ResizeObserver(() => updateSize());
    if (containerRef) observer.observe(containerRef);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    // Track reactive dependencies
    props.slide;
    props.selectedElementId;
    canvasSize();
    redraw();
  });

  const handleMouseDown = (e: MouseEvent) => {
    const pos = toSlideCoords(e.clientX, e.clientY);

    // Check resize handles first
    if (props.selectedElementId) {
      const selected = props.slide.elements.find(
        (el) => el.id === props.selectedElementId,
      );
      if (selected) {
        const handle = hitTestHandles(selected, pos.x, pos.y, 12 / scale());
        if (handle) {
          setResizing(handle);
          setDragStart(pos);
          setElementStart({
            x: selected.x,
            y: selected.y,
            w: selected.width,
            h: selected.height,
          });
          return;
        }
      }
    }

    // Hit test elements
    const hit = hitTestElements(props.slide.elements, pos.x, pos.y);
    if (hit) {
      props.onSelectElement(hit.id);
      setDragging(true);
      setDragStart(pos);
      setElementStart({
        x: hit.x,
        y: hit.y,
        w: hit.width,
        h: hit.height,
      });
    } else {
      props.onSelectElement(null);
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    const pos = toSlideCoords(e.clientX, e.clientY);
    const dx = pos.x - dragStart().x;
    const dy = pos.y - dragStart().y;
    const start = elementStart();

    if (dragging() && props.selectedElementId) {
      const el = props.slide.elements.find(
        (el) => el.id === props.selectedElementId,
      );
      if (el) {
        props.onUpdateElement({
          ...el,
          x: Math.round(start.x + dx),
          y: Math.round(start.y + dy),
        });
      }
    }

    if (resizing() && props.selectedElementId) {
      const el = props.slide.elements.find(
        (el) => el.id === props.selectedElementId,
      );
      if (!el) return;

      const handle = resizing()!;
      let newX = start.x;
      let newY = start.y;
      let newW = start.w;
      let newH = start.h;

      if (handle.includes("e")) {
        newW = Math.max(20, start.w + dx);
      }
      if (handle.includes("w")) {
        newW = Math.max(20, start.w - dx);
        newX = start.x + dx;
      }
      if (handle.includes("s")) {
        newH = Math.max(20, start.h + dy);
      }
      if (handle.includes("n")) {
        newH = Math.max(20, start.h - dy);
        newY = start.y + dy;
      }

      props.onUpdateElement({
        ...el,
        x: Math.round(newX),
        y: Math.round(newY),
        width: Math.round(newW),
        height: Math.round(newH),
      });
    }
  };

  const handleMouseUp = () => {
    setDragging(false);
    setResizing(null);
  };

  const handleDoubleClick = (e: MouseEvent) => {
    const pos = toSlideCoords(e.clientX, e.clientY);
    const hit = hitTestElements(props.slide.elements, pos.x, pos.y);
    if (hit && hit.type === "text") {
      props.onEditText(hit.id);
    }
  };

  return (
    <div
      ref={containerRef}
      class="flex-1 flex items-center justify-center bg-gray-900 p-4 overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        class="shadow-2xl rounded-lg cursor-default"
        style={{
          "max-width": "100%",
          "max-height": "100%",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDblClick={handleDoubleClick}
      />
    </div>
  );
}
