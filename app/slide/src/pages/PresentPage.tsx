import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import type { Presentation, SlideTransition } from "../types";
import { getPresentation, loadPresentationsFromApi } from "../lib/storage";
import { renderSlide } from "../lib/canvas-renderer";
import { useI18n } from "../i18n";

const SLIDE_W = 960;
const SLIDE_H = 540;

export default function PresentPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [presentation, setPresentation] = createSignal<Presentation | null>(
    null,
  );
  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [transitionStyle, setTransitionStyle] = createSignal<string>("");
  const [isTransitioning, setIsTransitioning] = createSignal(false);
  let canvasRef: HTMLCanvasElement | undefined;
  let wrapperRef: HTMLDivElement | undefined;

  onMount(() => {
    const pres = getPresentation(params.id);
    if (!pres) {
      void loadPresentationsFromApi()
        .then(() => {
          const remote = getPresentation(params.id);
          if (remote) setPresentation(remote);
          else navigate("/");
        })
        .catch(() => navigate("/"));
      return;
    }
    setPresentation(pres);

    // Request fullscreen
    document.documentElement.requestFullscreen?.().catch(() => {
      // Fullscreen might be blocked; continue anyway
    });
  });

  const exitPresentation = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    }
    navigate(`/${params.id}`);
  };

  const totalSlides = () => presentation()?.slides.length ?? 0;

  /**
   * Get the initial CSS transform/opacity for a given transition type
   * (the "entering" state before the transition plays).
   */
  function getTransitionStartStyle(t: SlideTransition): string {
    switch (t.type) {
      case "fade":
        return "opacity: 0;";
      case "slide-left":
        return "transform: translateX(100%); opacity: 1;";
      case "slide-right":
        return "transform: translateX(-100%); opacity: 1;";
      case "slide-up":
        return "transform: translateY(100%); opacity: 1;";
      case "zoom":
        return "transform: scale(0.3); opacity: 0;";
      default:
        return "";
    }
  }

  /**
   * Get the transition CSS property value.
   */
  function getTransitionProp(t: SlideTransition): string {
    const dur = `${t.duration}ms`;
    switch (t.type) {
      case "fade":
        return `opacity ${dur} ease-in-out`;
      case "slide-left":
      case "slide-right":
      case "slide-up":
        return `transform ${dur} ease-in-out`;
      case "zoom":
        return `transform ${dur} ease-in-out, opacity ${dur} ease-in-out`;
      default:
        return "";
    }
  }

  const navigateSlide = (newIndex: number) => {
    if (
      newIndex < 0 || newIndex >= totalSlides() || newIndex === currentIndex()
    ) return;
    if (isTransitioning()) return;

    const pres = presentation();
    if (!pres) return;

    const targetSlide = pres.slides[newIndex];
    const transition = targetSlide?.transition;

    if (!transition || transition.type === "none") {
      setCurrentIndex(newIndex);
      return;
    }

    // Start transition: apply the "entering" style
    setIsTransitioning(true);
    const startStyle = getTransitionStartStyle(transition);
    setTransitionStyle(startStyle);

    // Update the slide index so canvas redraws with the new content
    setCurrentIndex(newIndex);

    // After a frame, apply the transition and end style
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const transitionProp = getTransitionProp(transition);
        setTransitionStyle(
          `transition: ${transitionProp}; opacity: 1; transform: none;`,
        );

        setTimeout(() => {
          setTransitionStyle("");
          setIsTransitioning(false);
        }, transition.duration);
      });
    });
  };

  const nextSlide = () => navigateSlide(currentIndex() + 1);
  const prevSlide = () => navigateSlide(currentIndex() - 1);

  const handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
      case " ":
      case "Enter":
        e.preventDefault();
        nextSlide();
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        prevSlide();
        break;
      case "Escape":
        exitPresentation();
        break;
      case "Home":
        navigateSlide(0);
        break;
      case "End":
        navigateSlide(totalSlides() - 1);
        break;
    }
  };

  document.addEventListener("keydown", handleKeyDown);
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

  // Handle fullscreen exit
  const handleFullscreenChange = () => {
    if (!document.fullscreenElement) {
      navigate(`/${params.id}`);
    }
  };
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  onCleanup(() =>
    document.removeEventListener("fullscreenchange", handleFullscreenChange)
  );

  // Render current slide
  const redraw = () => {
    const pres = presentation();
    if (!pres || !canvasRef) return;
    const slide = pres.slides[currentIndex()];
    if (!slide) return;

    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;

    // Calculate optimal size to fill the screen while maintaining 16:9
    const screenW = globalThis.innerWidth;
    const screenH = globalThis.innerHeight;
    const scaleW = screenW / SLIDE_W;
    const scaleH = screenH / SLIDE_H;
    const scale = Math.min(scaleW, scaleH);
    const pixelRatio = globalThis.devicePixelRatio || 1;

    const canvasW = Math.floor(SLIDE_W * scale);
    const canvasH = Math.floor(SLIDE_H * scale);

    canvasRef.width = canvasW * pixelRatio;
    canvasRef.height = canvasH * pixelRatio;
    canvasRef.style.width = `${canvasW}px`;
    canvasRef.style.height = `${canvasH}px`;

    ctx.scale(pixelRatio, pixelRatio);

    renderSlide(ctx, slide, canvasW, canvasH, {
      scale,
      showHandles: false,
    });
  };

  createEffect(redraw);

  // Resize handler
  const handleResize = () => redraw();
  globalThis.addEventListener("resize", handleResize);
  onCleanup(() => globalThis.removeEventListener("resize", handleResize));

  return (
    <div
      class="fixed inset-0 bg-black flex items-center justify-center cursor-none select-none"
      onClick={(e) => {
        // Click on left third = prev, right two-thirds = next
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < rect.width / 3) {
          prevSlide();
        } else {
          nextSlide();
        }
      }}
    >
      <Show
        when={presentation()}
        fallback={<div class="text-gray-500">{t("loading")}</div>}
      >
        <div
          ref={wrapperRef}
          style={transitionStyle()}
          class="will-change-transform"
        >
          <canvas ref={canvasRef} class="shadow-2xl" />
        </div>

        {/* Slide counter (shows briefly) */}
        <div class="fixed bottom-4 right-4 text-gray-600 text-sm opacity-30 hover:opacity-80 transition-opacity cursor-default">
          {currentIndex() + 1} / {totalSlides()}
        </div>

        {/* ESC hint */}
        <div class="fixed top-4 right-4 text-gray-700 text-xs opacity-0 hover:opacity-60 transition-opacity cursor-default">
          {t("escToExit")}
        </div>
      </Show>
    </div>
  );
}
