/**
 * PresentationStore backed by the Takos product storage API.
 *
 * Each presentation is stored under a `/takos-slide/` folder:
 *   - File name: `{id}.takosslide`
 *   - Content: full Presentation object serialised as JSON
 *
 * Reads (list / get / export) always go to the backing storage API, which
 * is the single source of truth. The in-process Map only memoizes the
 * presentation.id -> fileId mapping discovered while reading and a freshly
 * loaded working copy for the current operation; it is never used as an
 * authoritative read cache, so writes by other replicas/isolates or external
 * Takos-side changes are reflected on the next read instead of being masked
 * until the process restarts.
 */

import type {
  Presentation,
  Slide,
  SlideElement,
  SlideTransition,
} from "./types/index.ts";
import type { TakosStorageClient } from "../../shared/lib/takos-storage.ts";
import { exportPresentationToPdf } from "./lib/pdf-exporter.ts";
import { BUILT_IN_TEMPLATES, getTemplate } from "./lib/templates.ts";

const FOLDER_NAME = "takos-slide";
const FILE_EXTENSION = ".takosslide";
const MIME_TYPE = "application/vnd.takos.slide+json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function createDefaultSlide(): Slide {
  return {
    id: generateId(),
    elements: [],
    background: "#ffffff",
  };
}

const MAX_TEXT_LENGTH = 10_000;
const MAX_NOTES_LENGTH = 20_000;
const MAX_CSS_VALUE_LENGTH = 200;
const MAX_URL_LENGTH = 2_048;
const MIN_COORDINATE = -5_000;
const MAX_COORDINATE = 5_000;
const MIN_SIZE = 1;
const MAX_SIZE = 5_000;
const MIN_FONT_SIZE = 1;
const MAX_FONT_SIZE = 200;
const MIN_ROTATION = -360;
const MAX_ROTATION = 360;

const COMMON_ELEMENT_KEYS = new Set(["x", "y", "width", "height", "rotation"]);
const TEXT_ELEMENT_KEYS = new Set([
  "text",
  "fontSize",
  "fontFamily",
  "fontColor",
  "textAlign",
  "bold",
  "italic",
]);
const SHAPE_ELEMENT_KEYS = new Set([
  "shapeType",
  "fillColor",
  "strokeColor",
  "strokeWidth",
]);
const IMAGE_ELEMENT_KEYS = new Set(["imageUrl"]);

function assertNumber(
  key: string,
  value: unknown,
  min: number,
  max: number,
  integer = false,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  if (integer && !Number.isInteger(value)) {
    throw new Error(`${key} must be an integer`);
  }
  if (value < min || value > max) {
    throw new Error(`${key} must be between ${min} and ${max}`);
  }
  return value;
}

function assertString(key: string, value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  if (value.length > maxLength) {
    throw new Error(`${key} must be at most ${maxLength} characters`);
  }
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      throw new Error(`${key} contains control characters`);
    }
  }
  return value;
}

/**
 * Speaker notes are free-form prose, so unlike single-line string fields they
 * may contain newlines / tabs. Every other control character is rejected, in
 * the same spirit as {@link assertString}.
 */
function assertNotes(value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw new Error("notes must be a string");
  if (value.length > maxLength) {
    throw new Error(`notes must be at most ${maxLength} characters`);
  }
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue; // tab / LF / CR
    if (code <= 0x1f || code === 0x7f) {
      throw new Error("notes contains control characters");
    }
  }
  return value;
}

function assertBoolean(key: string, value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
  return value;
}

function assertCssValue(key: string, value: unknown): string {
  const css = assertString(key, value, MAX_CSS_VALUE_LENGTH).trim();
  if (!css || /[<>{};]/.test(css) || /\burl\s*\(/i.test(css)) {
    throw new Error(`${key} must be a safe CSS color or gradient`);
  }
  return css;
}

function assertImageUrl(value: unknown): string {
  const url = assertString("imageUrl", value, MAX_URL_LENGTH).trim();
  if (
    /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(url)
  ) {
    return url;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
  } catch {
    // handled below
  }
  throw new Error("imageUrl must be an http(s) URL or supported data image");
}

function allowedElementKeys(element: SlideElement): Set<string> {
  const keys = new Set(COMMON_ELEMENT_KEYS);
  const typeKeys = element.type === "text"
    ? TEXT_ELEMENT_KEYS
    : element.type === "shape"
    ? SHAPE_ELEMENT_KEYS
    : IMAGE_ELEMENT_KEYS;
  for (const key of typeKeys) keys.add(key);
  return keys;
}

export function sanitizeElementUpdateProperties(
  element: SlideElement,
  properties: Record<string, unknown>,
): Partial<Omit<SlideElement, "id" | "type">> {
  if (
    !properties || typeof properties !== "object" || Array.isArray(properties)
  ) {
    throw new Error("properties must be an object");
  }

  const allowed = allowedElementKeys(element);
  const sanitized: Partial<Omit<SlideElement, "id" | "type">> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (!allowed.has(key)) {
      throw new Error(`Cannot update ${key} on ${element.type} element`);
    }

    switch (key) {
      case "x":
        sanitized.x = assertNumber(key, value, MIN_COORDINATE, MAX_COORDINATE);
        break;
      case "y":
        sanitized.y = assertNumber(key, value, MIN_COORDINATE, MAX_COORDINATE);
        break;
      case "width":
        sanitized.width = assertNumber(key, value, MIN_SIZE, MAX_SIZE);
        break;
      case "height":
        sanitized.height = assertNumber(key, value, MIN_SIZE, MAX_SIZE);
        break;
      case "rotation":
        sanitized.rotation = assertNumber(
          key,
          value,
          MIN_ROTATION,
          MAX_ROTATION,
        );
        break;
      case "text":
        sanitized.text = assertString(key, value, MAX_TEXT_LENGTH);
        break;
      case "fontSize":
        sanitized.fontSize = assertNumber(
          key,
          value,
          MIN_FONT_SIZE,
          MAX_FONT_SIZE,
          true,
        );
        break;
      case "fontFamily": {
        const fontFamily = assertString(key, value, 120).trim();
        if (!fontFamily || /[<>{};]/.test(fontFamily)) {
          throw new Error("fontFamily must be a safe font family string");
        }
        sanitized.fontFamily = fontFamily;
        break;
      }
      case "fontColor":
        sanitized.fontColor = assertCssValue(key, value);
        break;
      case "textAlign":
        if (value !== "left" && value !== "center" && value !== "right") {
          throw new Error("textAlign must be left, center, or right");
        }
        sanitized.textAlign = value;
        break;
      case "bold":
        sanitized.bold = assertBoolean(key, value);
        break;
      case "italic":
        sanitized.italic = assertBoolean(key, value);
        break;
      case "shapeType":
        if (
          value !== "rect" && value !== "ellipse" && value !== "triangle" &&
          value !== "arrow"
        ) {
          throw new Error(
            "shapeType must be rect, ellipse, triangle, or arrow",
          );
        }
        sanitized.shapeType = value;
        break;
      case "fillColor":
        sanitized.fillColor = assertCssValue(key, value);
        break;
      case "strokeColor":
        sanitized.strokeColor = assertCssValue(key, value);
        break;
      case "strokeWidth":
        sanitized.strokeWidth = assertNumber(key, value, 0, 100);
        break;
      case "imageUrl":
        sanitized.imageUrl = assertImageUrl(value);
        break;
    }
  }

  return sanitized;
}

// ---------------------------------------------------------------------------
// PresentationStore interface (all methods are now async)
// ---------------------------------------------------------------------------

export interface PresentationStore {
  // Presentation CRUD
  list(): Promise<
    (Pick<Presentation, "id" | "title" | "updatedAt"> & {
      slideCount: number;
    })[]
  >;
  create(title: string): Promise<Presentation>;
  get(id: string): Promise<Presentation | undefined>;
  replace(presentation: Presentation): Promise<Presentation>;
  delete(id: string): Promise<boolean>;
  setTitle(id: string, title: string): Promise<Presentation>;

  // Slide operations
  addSlide(
    presentationId: string,
    index?: number,
    background?: string,
  ): Promise<Slide>;
  removeSlide(presentationId: string, slideIndex: number): Promise<void>;
  reorderSlide(
    presentationId: string,
    fromIndex: number,
    toIndex: number,
  ): Promise<void>;
  setSlideBackground(
    presentationId: string,
    slideIndex: number,
    background: string,
  ): Promise<void>;
  setSlideNotes(
    presentationId: string,
    slideIndex: number,
    notes: string,
  ): Promise<Slide>;
  duplicateSlide(presentationId: string, slideIndex: number): Promise<Slide>;

  // Element operations
  addTextElement(
    presentationId: string,
    slideIndex: number,
    opts: {
      text: string;
      x: number;
      y: number;
      width?: number;
      height?: number;
      fontSize?: number;
      fontColor?: string;
      bold?: boolean;
      italic?: boolean;
    },
  ): Promise<SlideElement>;

  addShapeElement(
    presentationId: string,
    slideIndex: number,
    opts: {
      shapeType: "rect" | "ellipse" | "triangle" | "arrow";
      x: number;
      y: number;
      width: number;
      height: number;
      fillColor?: string;
      strokeColor?: string;
    },
  ): Promise<SlideElement>;

  addImageElement(
    presentationId: string,
    slideIndex: number,
    opts: {
      imageUrl: string;
      x: number;
      y: number;
      width?: number;
      height?: number;
    },
  ): Promise<SlideElement>;

  removeElement(
    presentationId: string,
    slideIndex: number,
    elementId: string,
  ): Promise<void>;

  updateElement(
    presentationId: string,
    slideIndex: number,
    elementId: string,
    properties: Partial<Omit<SlideElement, "id" | "type">>,
  ): Promise<SlideElement>;

  moveElement(
    presentationId: string,
    slideIndex: number,
    elementId: string,
    x: number,
    y: number,
  ): Promise<SlideElement>;

  resizeElement(
    presentationId: string,
    slideIndex: number,
    elementId: string,
    width: number,
    height: number,
  ): Promise<SlideElement>;

  // Z-order (stacking) — `slide.elements` is painted front-to-back in array
  // order, so the LAST element is drawn on top. Returns the updated slide.
  bringElementToFront(
    presentationId: string,
    slideIndex: number,
    elementId: string,
  ): Promise<Slide>;
  sendElementToBack(
    presentationId: string,
    slideIndex: number,
    elementId: string,
  ): Promise<Slide>;
  raiseElement(
    presentationId: string,
    slideIndex: number,
    elementId: string,
  ): Promise<Slide>;
  lowerElement(
    presentationId: string,
    slideIndex: number,
    elementId: string,
  ): Promise<Slide>;

  // Transitions
  setSlideTransition(
    presentationId: string,
    slideIndex: number,
    transition: SlideTransition,
  ): Promise<void>;

  // Templates
  listTemplates(): { id: string; name: string; description: string }[];
  createFromTemplate(
    title: string,
    templateId: string,
  ): Promise<Presentation>;
  addSlideFromTemplate(
    presentationId: string,
    templateId: string,
    slideIndex?: number,
  ): Promise<Slide>;

  // Export
  exportJson(id: string): Promise<Presentation>;
  exportPdf(id: string): Promise<Uint8Array>;
  getSlideCount(id: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createPresentationStore(
  client: TakosStorageClient,
): PresentationStore {
  /**
   * presentation.id -> fileId memo, populated while reading and updated on
   * writes. NOT an authoritative read cache: every read re-fetches content
   * from storage.
   */
  const fileIds = new Map<string, string>();
  let folderId: string | null = null;

  // -- internal helpers ----------------------------------------------------

  function fileIdFor(idOrFileId: string): string | undefined {
    if (fileIds.has(idOrFileId)) return fileIds.get(idOrFileId);
    for (const fileId of fileIds.values()) {
      if (fileId === idOrFileId) return fileId;
    }
    return undefined;
  }

  function isSupportedFile(file: { name: string; mimeType?: string | null }) {
    return file.name.endsWith(FILE_EXTENSION);
  }

  async function loadFile(
    fileId: string,
  ): Promise<{ p: Presentation; fileId: string } | undefined> {
    const file = await client.get(fileId);
    if (!file || file.type !== "file" || !isSupportedFile(file)) {
      return undefined;
    }
    const raw = await client.getContent(file.id);
    const p = JSON.parse(raw) as Presentation;
    fileIds.set(p.id, file.id);
    return { p, fileId: file.id };
  }

  /**
   * Ensure the app folder exists and cache its id. Folder structure is stable,
   * so it is the only thing memoized for the process lifetime; presentation
   * content is always re-read from storage by the read methods.
   */
  async function ensureFolder(): Promise<void> {
    if (folderId) return;
    const files = await client.list();
    const folder = files.find(
      (f) => f.type === "folder" && f.name === FOLDER_NAME,
    );
    if (folder) {
      folderId = folder.id;
    } else {
      const created = await client.createFolder(FOLDER_NAME);
      folderId = created.id;
    }
  }

  /** Re-read every presentation in the folder from storage. */
  async function loadAll(): Promise<{ p: Presentation; fileId: string }[]> {
    await ensureFolder();
    const allFiles = await client.list(FOLDER_NAME);
    const entries: { p: Presentation; fileId: string }[] = [];
    for (const file of allFiles) {
      if (file.type !== "file" || !isSupportedFile(file)) continue;
      try {
        const entry = await loadFile(file.id);
        if (entry) entries.push(entry);
      } catch {
        console.warn(
          `[takos-slide] Skipping unreadable file: ${file.name}`,
        );
      }
    }
    return entries;
  }

  async function persist(id: string, p: Presentation): Promise<void> {
    const fileId = fileIdFor(id);
    if (!fileId) return;
    await client.putContent(fileId, JSON.stringify(p), MIME_TYPE);
  }

  /**
   * Load a presentation fresh from storage so mutations operate on the
   * current persisted state rather than a stale in-process copy.
   */
  async function mustGet(
    id: string,
  ): Promise<{ p: Presentation; fileId: string }> {
    await ensureFolder();
    let fileId = fileIdFor(id);
    if (!fileId) {
      await loadAll(); // refresh fileId memo
      fileId = fileIdFor(id);
    }
    if (fileId) {
      const entry = await loadFile(fileId);
      if (entry) return entry;
      fileIds.delete(id);
    }
    const fallback = await loadFile(id);
    if (fallback) return fallback;
    throw new Error(`Presentation not found: ${id}`);
  }

  function mustGetSlide(p: Presentation, slideIndex: number): Slide {
    const slide = p.slides[slideIndex];
    if (!slide) {
      throw new Error(
        `Slide index ${slideIndex} out of range (0..${p.slides.length - 1})`,
      );
    }
    return slide;
  }

  function mustGetElement(slide: Slide, elementId: string): SlideElement {
    const el = slide.elements.find((e) => e.id === elementId);
    if (!el) throw new Error(`Element not found: ${elementId}`);
    return el;
  }

  function requireElementIndex(slide: Slide, elementId: string): number {
    const idx = slide.elements.findIndex((e) => e.id === elementId);
    if (idx === -1) throw new Error(`Element not found: ${elementId}`);
    return idx;
  }

  function touch(p: Presentation): void {
    p.updatedAt = now();
  }

  // -- store ---------------------------------------------------------------

  const store: PresentationStore = {
    // Presentation CRUD ---------------------------------------------------

    async list() {
      const entries = await loadAll();
      return entries.map((e) => ({
        id: e.p.id,
        title: e.p.title,
        slideCount: e.p.slides.length,
        updatedAt: e.p.updatedAt,
      }));
    },

    async create(title: string) {
      await ensureFolder();
      const ts = now();
      const p: Presentation = {
        id: generateId(),
        title,
        slides: [createDefaultSlide()],
        createdAt: ts,
        updatedAt: ts,
      };
      const file = await client.create(
        `${p.id}${FILE_EXTENSION}`,
        folderId ?? undefined,
        { content: JSON.stringify(p), mimeType: MIME_TYPE },
      );
      fileIds.set(p.id, file.id);
      return p;
    },

    async get(id: string) {
      await ensureFolder();
      let fileId = fileIdFor(id);
      if (!fileId) {
        await loadAll(); // refresh fileId memo from storage
        fileId = fileIdFor(id);
      }
      if (fileId) {
        const entry = await loadFile(fileId);
        if (entry) return entry.p;
        fileIds.delete(id);
      }
      return (await loadFile(id))?.p;
    },

    async replace(presentation: Presentation) {
      await ensureFolder();
      let fileId = fileIdFor(presentation.id);
      if (!fileId) {
        await loadAll(); // refresh fileId memo from storage
        fileId = fileIdFor(presentation.id);
      }
      const next = {
        ...presentation,
        updatedAt: presentation.updatedAt || now(),
      };
      if (fileId) {
        await client.putContent(fileId, JSON.stringify(next), MIME_TYPE);
        fileIds.set(next.id, fileId);
        return next;
      }

      const file = await client.create(
        `${next.id}${FILE_EXTENSION}`,
        folderId ?? undefined,
        { content: JSON.stringify(next), mimeType: MIME_TYPE },
      );
      fileIds.set(next.id, file.id);
      return next;
    },

    async delete(id: string) {
      await ensureFolder();
      let fileId = fileIdFor(id);
      if (!fileId) {
        await loadAll(); // refresh fileId memo from storage
        fileId = fileIdFor(id);
      }
      if (!fileId) return false;
      await client.delete(fileId);
      fileIds.delete(id);
      return true;
    },

    async setTitle(id: string, title: string) {
      const { p } = await mustGet(id);
      p.title = title;
      touch(p);
      await persist(id, p);
      return p;
    },

    // Slide operations ----------------------------------------------------

    async addSlide(presentationId, index, background) {
      const { p } = await mustGet(presentationId);
      const slide: Slide = {
        id: generateId(),
        elements: [],
        background: background ?? "#ffffff",
      };
      if (index !== undefined && index >= 0 && index <= p.slides.length) {
        p.slides.splice(index, 0, slide);
      } else {
        p.slides.push(slide);
      }
      touch(p);
      await persist(presentationId, p);
      return slide;
    },

    async removeSlide(presentationId, slideIndex) {
      const { p } = await mustGet(presentationId);
      mustGetSlide(p, slideIndex);
      // Preserve the >=1-slide invariant relied on by create/present/export
      // and slides[0] access (matches SpreadsheetStore.removeTab).
      if (p.slides.length <= 1) {
        throw new Error("Cannot remove the last slide");
      }
      p.slides.splice(slideIndex, 1);
      touch(p);
      await persist(presentationId, p);
    },

    async reorderSlide(presentationId, fromIndex, toIndex) {
      const { p } = await mustGet(presentationId);
      mustGetSlide(p, fromIndex);
      if (toIndex < 0 || toIndex >= p.slides.length) {
        throw new Error(
          `toIndex ${toIndex} out of range (0..${p.slides.length - 1})`,
        );
      }
      const [slide] = p.slides.splice(fromIndex, 1);
      p.slides.splice(toIndex, 0, slide);
      touch(p);
      await persist(presentationId, p);
    },

    async setSlideBackground(presentationId, slideIndex, background) {
      const { p } = await mustGet(presentationId);
      const slide = mustGetSlide(p, slideIndex);
      slide.background = background;
      touch(p);
      await persist(presentationId, p);
    },

    async setSlideNotes(presentationId, slideIndex, notes) {
      const { p } = await mustGet(presentationId);
      const slide = mustGetSlide(p, slideIndex);
      slide.notes = assertNotes(notes, MAX_NOTES_LENGTH);
      touch(p);
      await persist(presentationId, p);
      return slide;
    },

    async duplicateSlide(presentationId, slideIndex) {
      const { p } = await mustGet(presentationId);
      const src = mustGetSlide(p, slideIndex);
      const dup: Slide = {
        id: generateId(),
        background: src.background,
        elements: src.elements.map((e) => ({ ...e, id: generateId() })),
        // Carry the slide-level notes/transition so duplicating preserves them
        // (they are first-class slide fields, like createFromTemplate keeps).
        ...(src.notes !== undefined ? { notes: src.notes } : {}),
        ...(src.transition !== undefined
          ? { transition: { ...src.transition } }
          : {}),
      };
      p.slides.splice(slideIndex + 1, 0, dup);
      touch(p);
      await persist(presentationId, p);
      return dup;
    },

    // Element operations --------------------------------------------------

    async addTextElement(presentationId, slideIndex, opts) {
      const { p } = await mustGet(presentationId);
      const slide = mustGetSlide(p, slideIndex);
      const el: SlideElement = {
        id: generateId(),
        type: "text",
        x: opts.x,
        y: opts.y,
        width: opts.width ?? 300,
        height: opts.height ?? 60,
        rotation: 0,
        text: opts.text,
        fontSize: opts.fontSize ?? 24,
        fontFamily: "Inter, sans-serif",
        fontColor: opts.fontColor ?? "#333333",
        textAlign: "center",
        bold: opts.bold ?? false,
        italic: opts.italic ?? false,
      };
      slide.elements.push(el);
      touch(p);
      await persist(presentationId, p);
      return el;
    },

    async addShapeElement(presentationId, slideIndex, opts) {
      const { p } = await mustGet(presentationId);
      const slide = mustGetSlide(p, slideIndex);
      const el: SlideElement = {
        id: generateId(),
        type: "shape",
        x: opts.x,
        y: opts.y,
        width: opts.width,
        height: opts.height,
        rotation: 0,
        shapeType: opts.shapeType,
        fillColor: opts.fillColor ?? "#4f87e0",
        strokeColor: opts.strokeColor ?? "#2563eb",
        strokeWidth: 2,
      };
      slide.elements.push(el);
      touch(p);
      await persist(presentationId, p);
      return el;
    },

    async addImageElement(presentationId, slideIndex, opts) {
      const { p } = await mustGet(presentationId);
      const slide = mustGetSlide(p, slideIndex);
      const el: SlideElement = {
        id: generateId(),
        type: "image",
        x: opts.x,
        y: opts.y,
        width: opts.width ?? 300,
        height: opts.height ?? 200,
        rotation: 0,
        imageUrl: opts.imageUrl,
      };
      slide.elements.push(el);
      touch(p);
      await persist(presentationId, p);
      return el;
    },

    async removeElement(presentationId, slideIndex, elementId) {
      const { p } = await mustGet(presentationId);
      const slide = mustGetSlide(p, slideIndex);
      const idx = slide.elements.findIndex((e) => e.id === elementId);
      if (idx === -1) throw new Error(`Element not found: ${elementId}`);
      slide.elements.splice(idx, 1);
      touch(p);
      await persist(presentationId, p);
    },

    async updateElement(presentationId, slideIndex, elementId, properties) {
      const { p } = await mustGet(presentationId);
      const slide = mustGetSlide(p, slideIndex);
      const el = mustGetElement(slide, elementId);
      const sanitized = sanitizeElementUpdateProperties(
        el,
        properties as Record<string, unknown>,
      );
      Object.assign(el, sanitized);
      touch(p);
      await persist(presentationId, p);
      return el;
    },

    async moveElement(presentationId, slideIndex, elementId, x, y) {
      const { p } = await mustGet(presentationId);
      const slide = mustGetSlide(p, slideIndex);
      const el = mustGetElement(slide, elementId);
      el.x = x;
      el.y = y;
      touch(p);
      await persist(presentationId, p);
      return el;
    },

    async resizeElement(presentationId, slideIndex, elementId, width, height) {
      const { p } = await mustGet(presentationId);
      const slide = mustGetSlide(p, slideIndex);
      const el = mustGetElement(slide, elementId);
      el.width = width;
      el.height = height;
      touch(p);
      await persist(presentationId, p);
      return el;
    },

    // Z-order (stacking) ---------------------------------------------------
    // `slide.elements` is painted in array order, so index 0 is the bottom-most
    // and the last index is on top. Reorderings move the element within the
    // array and persist; a no-op move (already front/back/top/bottom) still
    // succeeds and returns the slide.

    async bringElementToFront(presentationId, slideIndex, elementId) {
      const { p } = await mustGet(presentationId);
      const slide = mustGetSlide(p, slideIndex);
      const idx = requireElementIndex(slide, elementId);
      const [el] = slide.elements.splice(idx, 1);
      slide.elements.push(el);
      touch(p);
      await persist(presentationId, p);
      return slide;
    },

    async sendElementToBack(presentationId, slideIndex, elementId) {
      const { p } = await mustGet(presentationId);
      const slide = mustGetSlide(p, slideIndex);
      const idx = requireElementIndex(slide, elementId);
      const [el] = slide.elements.splice(idx, 1);
      slide.elements.unshift(el);
      touch(p);
      await persist(presentationId, p);
      return slide;
    },

    async raiseElement(presentationId, slideIndex, elementId) {
      const { p } = await mustGet(presentationId);
      const slide = mustGetSlide(p, slideIndex);
      const idx = requireElementIndex(slide, elementId);
      if (idx < slide.elements.length - 1) {
        const [el] = slide.elements.splice(idx, 1);
        slide.elements.splice(idx + 1, 0, el);
        touch(p);
        await persist(presentationId, p);
      }
      return slide;
    },

    async lowerElement(presentationId, slideIndex, elementId) {
      const { p } = await mustGet(presentationId);
      const slide = mustGetSlide(p, slideIndex);
      const idx = requireElementIndex(slide, elementId);
      if (idx > 0) {
        const [el] = slide.elements.splice(idx, 1);
        slide.elements.splice(idx - 1, 0, el);
        touch(p);
        await persist(presentationId, p);
      }
      return slide;
    },

    // Transitions ----------------------------------------------------------

    async setSlideTransition(presentationId, slideIndex, transition) {
      const { p } = await mustGet(presentationId);
      const slide = mustGetSlide(p, slideIndex);
      slide.transition = transition;
      touch(p);
      await persist(presentationId, p);
    },

    // Templates -------------------------------------------------------------

    listTemplates() {
      return BUILT_IN_TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
      }));
    },

    async createFromTemplate(title, templateId) {
      const tpl = getTemplate(templateId);
      if (!tpl) throw new Error(`Template not found: ${templateId}`);

      await ensureFolder();
      const ts = now();
      const slides: Slide[] = tpl.slides.map((s) => ({
        ...s,
        id: generateId(),
        elements: s.elements.map((e) => ({ ...e, id: generateId() })),
      }));

      const p: Presentation = {
        id: generateId(),
        title,
        slides,
        createdAt: ts,
        updatedAt: ts,
      };

      const file = await client.create(
        `${p.id}${FILE_EXTENSION}`,
        folderId ?? undefined,
        { content: JSON.stringify(p), mimeType: MIME_TYPE },
      );
      fileIds.set(p.id, file.id);
      return p;
    },

    async addSlideFromTemplate(presentationId, templateId, slideIndex) {
      const tpl = getTemplate(templateId);
      if (!tpl) throw new Error(`Template not found: ${templateId}`);
      if (tpl.slides.length === 0) {
        throw new Error(`Template has no slides: ${templateId}`);
      }

      const { p } = await mustGet(presentationId);
      const templateSlide = tpl.slides[0];
      const slide: Slide = {
        ...templateSlide,
        id: generateId(),
        elements: templateSlide.elements.map((e) => ({
          ...e,
          id: generateId(),
        })),
      };

      if (
        slideIndex !== undefined &&
        slideIndex >= 0 &&
        slideIndex <= p.slides.length
      ) {
        p.slides.splice(slideIndex, 0, slide);
      } else {
        p.slides.push(slide);
      }

      touch(p);
      await persist(presentationId, p);
      return slide;
    },

    // Export ---------------------------------------------------------------

    async exportJson(id: string) {
      const { p } = await mustGet(id);
      return p;
    },

    async exportPdf(id: string) {
      const { p } = await mustGet(id);
      return exportPresentationToPdf(p);
    },

    async getSlideCount(id: string) {
      const { p } = await mustGet(id);
      return p.slides.length;
    },
  };

  return store;
}
