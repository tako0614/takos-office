export type SlideElementType = "text" | "shape" | "image";

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export type TransitionType =
  | "none"
  | "fade"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "zoom";

export interface SlideTransition {
  type: TransitionType;
  duration: number; // ms
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface SlideTemplate {
  id: string;
  name: string;
  description: string;
  slides: Omit<Slide, "id">[];
}

export interface SlideElement {
  id: string;
  type: SlideElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  // text
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontColor?: string;
  textAlign?: "left" | "center" | "right";
  bold?: boolean;
  italic?: boolean;
  // shape
  shapeType?: "rect" | "ellipse" | "triangle" | "arrow";
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  // image
  imageUrl?: string;
}

export interface Slide {
  id: string;
  elements: SlideElement[];
  background: string; // CSS color or gradient
  transition?: SlideTransition;
}

export interface Presentation {
  id: string;
  title: string;
  slides: Slide[];
  createdAt: string;
  updatedAt: string;
}
