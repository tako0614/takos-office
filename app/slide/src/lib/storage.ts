import type { Presentation, Slide, SlideElement } from "../types/index.ts";
import { t } from "../i18n.ts";
import { createApiClient } from "../../../shared/lib/api-client.ts";

const STORAGE_KEY = "takos-slide-presentations";

const api = createApiClient("/api/presentations", STORAGE_KEY);
const API_PRESENTATIONS_PATH = api.apiPath;
const { requestJson, withCurrentSpaceId, redirectToLogin } = api;

export interface LocalSaveResult<T> {
  value: T;
  remote: Promise<unknown>;
}

export function clearPresentationsCache(): void {
  api.clearCache();
}

function syncPresentationToApi(
  presentation: Presentation,
): Promise<Presentation> {
  return requestJson<Presentation>(
    `${API_PRESENTATIONS_PATH}/${encodeURIComponent(presentation.id)}`,
    {
      method: "PUT",
      body: JSON.stringify(presentation),
    },
  );
}

async function deletePresentationFromApi(id: string): Promise<void> {
  const response = await fetch(
    withCurrentSpaceId(`${API_PRESENTATIONS_PATH}/${encodeURIComponent(id)}`),
    {
      method: "DELETE",
      credentials: "same-origin",
    },
  );
  if (response.status === 401) {
    clearPresentationsCache();
    redirectToLogin();
  }
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
}

export async function loadPresentationsFromApi(): Promise<Presentation[]> {
  const presentations = await requestJson<Presentation[]>(
    API_PRESENTATIONS_PATH,
  );
  savePresentations(presentations);
  return presentations;
}

export async function loadPresentationFromApi(
  id: string,
): Promise<Presentation> {
  const presentation = await requestJson<Presentation>(
    `${API_PRESENTATIONS_PATH}/${encodeURIComponent(id)}`,
  );
  const presentations = loadPresentations();
  const index = presentations.findIndex((entry) =>
    entry.id === presentation.id
  );
  if (index >= 0) presentations[index] = presentation;
  else presentations.push(presentation);
  savePresentations(presentations);
  return presentation;
}

function generateId(): string {
  return crypto.randomUUID();
}

export function loadPresentations(): Presentation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Presentation[];
  } catch {
    return [];
  }
}

export function savePresentations(presentations: Presentation[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presentations));
}

export function createDefaultSlide(): Slide {
  return {
    id: generateId(),
    elements: [],
    background: "#ffffff",
  };
}

export function createPresentation(title: string): Presentation {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    title,
    slides: [createDefaultSlide()],
    createdAt: now,
    updatedAt: now,
  };
}

export function savePresentation(
  presentation: Presentation,
): LocalSaveResult<Presentation[]> {
  const presentations = loadPresentations();
  const index = presentations.findIndex((p) => p.id === presentation.id);
  const updated = {
    ...presentation,
    updatedAt: new Date().toISOString(),
  };
  if (index >= 0) {
    presentations[index] = updated;
  } else {
    presentations.push(updated);
  }
  savePresentations(presentations);
  return { value: presentations, remote: syncPresentationToApi(updated) };
}

export function deletePresentation(
  id: string,
): LocalSaveResult<Presentation[]> {
  const presentations = loadPresentations().filter((p) => p.id !== id);
  savePresentations(presentations);
  return { value: presentations, remote: deletePresentationFromApi(id) };
}

export function getPresentation(id: string): Presentation | undefined {
  return loadPresentations().find((p) => p.id === id);
}

export function createTextElement(
  x: number,
  y: number,
  text = t("defaultTextElement"),
): SlideElement {
  return {
    id: generateId(),
    type: "text",
    x,
    y,
    width: 300,
    height: 60,
    rotation: 0,
    text,
    fontSize: 24,
    fontFamily: "Inter, sans-serif",
    fontColor: "#333333",
    textAlign: "center",
    bold: false,
    italic: false,
  };
}

export function createShapeElement(
  shapeType: "rect" | "ellipse" | "triangle" | "arrow",
  x: number,
  y: number,
): SlideElement {
  return {
    id: generateId(),
    type: "shape",
    x,
    y,
    width: 200,
    height: 150,
    rotation: 0,
    shapeType,
    fillColor: "#4f87e0",
    strokeColor: "#2563eb",
    strokeWidth: 2,
  };
}

export function createImageElement(
  imageUrl: string,
  x: number,
  y: number,
): SlideElement {
  return {
    id: generateId(),
    type: "image",
    x,
    y,
    width: 300,
    height: 200,
    rotation: 0,
    imageUrl,
  };
}
