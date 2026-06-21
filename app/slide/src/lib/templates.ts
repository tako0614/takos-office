/**
 * Built-in slide templates for takos-slide.
 *
 * Each template defines one or more slides with pre-placed elements.
 * Slide IDs are omitted (generated at creation time).
 */

import type { Slide, SlideElement, SlideTemplate } from "../types/index.ts";

type SlideWithoutId = Omit<Slide, "id">;
type ElementWithoutId = Omit<SlideElement, "id">;

// ---------------------------------------------------------------------------
// Helper to build element data without ids
// ---------------------------------------------------------------------------

function textEl(
  overrides: Partial<ElementWithoutId> & {
    text: string;
    x: number;
    y: number;
  },
): ElementWithoutId {
  return {
    type: "text",
    width: 300,
    height: 60,
    rotation: 0,
    fontSize: 24,
    fontFamily: "Inter, sans-serif",
    fontColor: "#333333",
    textAlign: "center",
    bold: false,
    italic: false,
    ...overrides,
  };
}

function shapeEl(
  overrides: Partial<ElementWithoutId> & {
    shapeType: "rect" | "ellipse" | "triangle" | "arrow";
    x: number;
    y: number;
    width: number;
    height: number;
  },
): ElementWithoutId {
  return {
    type: "shape",
    rotation: 0,
    fillColor: "#4f87e0",
    strokeColor: "#2563eb",
    strokeWidth: 2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const blank: SlideTemplate = {
  id: "blank",
  name: "Blank",
  description: "A single white slide with no elements.",
  slides: [
    {
      elements: [],
      background: "#ffffff",
    },
  ],
};

const titleSlide: SlideTemplate = {
  id: "title-slide",
  name: "Title Slide",
  description: "Large centered title with a subtitle below.",
  slides: [
    {
      background: "#ffffff",
      elements: [
        textEl({
          text: "Presentation Title",
          x: 130,
          y: 180,
          width: 700,
          height: 80,
          fontSize: 48,
          fontColor: "#1a1a2e",
          bold: true,
          textAlign: "center",
        }),
        textEl({
          text: "Subtitle or author name",
          x: 230,
          y: 280,
          width: 500,
          height: 50,
          fontSize: 24,
          fontColor: "#6b7280",
          italic: true,
          textAlign: "center",
        }),
      ] as SlideElement[],
    },
  ],
};

const titleContent: SlideTemplate = {
  id: "title-content",
  name: "Title + Content",
  description: "A title bar at the top with a content area below.",
  slides: [
    {
      background: "#ffffff",
      elements: [
        // Title bar background
        shapeEl({
          shapeType: "rect",
          x: 0,
          y: 0,
          width: 960,
          height: 80,
          fillColor: "#1e3a5f",
          strokeColor: "#1e3a5f",
          strokeWidth: 0,
        }),
        // Title text
        textEl({
          text: "Slide Title",
          x: 40,
          y: 16,
          width: 880,
          height: 50,
          fontSize: 32,
          fontColor: "#ffffff",
          bold: true,
          textAlign: "left",
        }),
        // Content placeholder
        textEl({
          text: "Content goes here. Replace this text with your slide content.",
          x: 40,
          y: 110,
          width: 880,
          height: 380,
          fontSize: 22,
          fontColor: "#333333",
          textAlign: "left",
        }),
      ] as SlideElement[],
    },
  ],
};

const twoColumn: SlideTemplate = {
  id: "two-column",
  name: "Two Column",
  description: "Title at the top with two side-by-side content areas.",
  slides: [
    {
      background: "#ffffff",
      elements: [
        // Title
        textEl({
          text: "Slide Title",
          x: 40,
          y: 20,
          width: 880,
          height: 60,
          fontSize: 32,
          fontColor: "#1a1a2e",
          bold: true,
          textAlign: "left",
        }),
        // Divider line
        shapeEl({
          shapeType: "rect",
          x: 40,
          y: 80,
          width: 880,
          height: 3,
          fillColor: "#e5e7eb",
          strokeColor: "#e5e7eb",
          strokeWidth: 0,
        }),
        // Left column
        textEl({
          text: "Left column content. Add your points here.",
          x: 40,
          y: 100,
          width: 420,
          height: 400,
          fontSize: 20,
          fontColor: "#333333",
          textAlign: "left",
        }),
        // Right column
        textEl({
          text: "Right column content. Add your points here.",
          x: 500,
          y: 100,
          width: 420,
          height: 400,
          fontSize: 20,
          fontColor: "#333333",
          textAlign: "left",
        }),
      ] as SlideElement[],
    },
  ],
};

const sectionHeader: SlideTemplate = {
  id: "section-header",
  name: "Section Header",
  description: "Bold section divider with a colored background.",
  slides: [
    {
      background: "#1e3a5f",
      elements: [
        // Accent bar
        shapeEl({
          shapeType: "rect",
          x: 80,
          y: 250,
          width: 120,
          height: 4,
          fillColor: "#f59e0b",
          strokeColor: "#f59e0b",
          strokeWidth: 0,
        }),
        // Section title
        textEl({
          text: "Section Title",
          x: 80,
          y: 180,
          width: 800,
          height: 70,
          fontSize: 44,
          fontColor: "#ffffff",
          bold: true,
          textAlign: "left",
        }),
        // Subtitle
        textEl({
          text: "Brief description of this section",
          x: 80,
          y: 270,
          width: 800,
          height: 50,
          fontSize: 22,
          fontColor: "#94a3b8",
          italic: false,
          textAlign: "left",
        }),
      ] as SlideElement[],
    },
  ],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const BUILT_IN_TEMPLATES: SlideTemplate[] = [
  blank,
  titleSlide,
  titleContent,
  twoColumn,
  sectionHeader,
];

/**
 * Look up a template by id.
 */
export function getTemplate(id: string): SlideTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}
