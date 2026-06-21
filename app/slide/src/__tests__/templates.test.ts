import { expect, test } from "bun:test";

import { BUILT_IN_TEMPLATES, getTemplate } from "../lib/templates.ts";

// ---------------------------------------------------------------------------
// BUILT_IN_TEMPLATES
// ---------------------------------------------------------------------------

test("BUILT_IN_TEMPLATES has 5 templates", () => {
  expect(BUILT_IN_TEMPLATES.length).toEqual(5);
});

test("each template has required fields", () => {
  for (const tmpl of BUILT_IN_TEMPLATES) {
    expect(typeof tmpl.id === "string" && tmpl.id.length > 0).toBeTruthy();
    expect(typeof tmpl.name === "string" && tmpl.name.length > 0).toBeTruthy();
    expect(typeof tmpl.description === "string" && tmpl.description.length > 0).toBeTruthy();
    expect(Array.isArray(tmpl.slides) && tmpl.slides.length > 0).toBeTruthy();
  }
});

test("all template ids are unique", () => {
  const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
  expect(new Set(ids).size).toEqual(ids.length);
});

test("each template slide has elements array and background", () => {
  for (const tmpl of BUILT_IN_TEMPLATES) {
    for (const slide of tmpl.slides) {
      expect(Array.isArray(slide.elements)).toBeTruthy();
      expect(typeof slide.background === "string").toBeTruthy();
    }
  }
});

test("template slide elements have valid structure", () => {
  for (const tmpl of BUILT_IN_TEMPLATES) {
    for (const slide of tmpl.slides) {
      for (const el of slide.elements) {
        expect(el.type === "text" || el.type === "shape" || el.type === "image").toBeTruthy();
        expect(typeof el.x === "number").toBeTruthy();
        expect(typeof el.y === "number").toBeTruthy();
        expect(typeof el.width === "number").toBeTruthy();
        expect(typeof el.height === "number").toBeTruthy();
      }
    }
  }
});

// ---------------------------------------------------------------------------
// getTemplate
// ---------------------------------------------------------------------------

test("getTemplate returns correct template by id", () => {
  const tmpl = getTemplate("blank");
  expect(tmpl !== undefined).toBeTruthy();
  if (!tmpl) throw new Error("Expected blank template");
  expect(tmpl.id).toEqual("blank");
  expect(tmpl.name).toEqual("Blank");
});

test("getTemplate returns each built-in template", () => {
  for (const expected of BUILT_IN_TEMPLATES) {
    const result = getTemplate(expected.id);
    expect(result !== undefined).toBeTruthy();
    if (!result) throw new Error(`Expected template ${expected.id}`);
    expect(result.id).toEqual(expected.id);
  }
});

test("getTemplate returns undefined for unknown id", () => {
  const result = getTemplate("nonexistent-template");
  expect(result).toEqual(undefined);
});

test("title-slide template has 2 text elements", () => {
  const tmpl = getTemplate("title-slide");
  expect(tmpl !== undefined).toBeTruthy();
  if (!tmpl) throw new Error("Expected title-slide template");
  expect(tmpl.slides.length).toEqual(1);
  const textEls = tmpl.slides[0].elements.filter((e) => e.type === "text");
  expect(textEls.length).toEqual(2);
});

test("blank template has no elements", () => {
  const tmpl = getTemplate("blank");
  expect(tmpl !== undefined).toBeTruthy();
  if (!tmpl) throw new Error("Expected blank template");
  expect(tmpl.slides[0].elements.length).toEqual(0);
});
