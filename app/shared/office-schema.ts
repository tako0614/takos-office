import { z } from "zod";

const id = z.string().trim().min(1).max(256);
const title = z.string().max(512);
const timestamp = z.string().min(1).max(64);
const finite = z.number().finite();
const css = z.string().max(512);

export const titlePatchSchema = z
  .object({
    title: title.refine((value) => value.trim().length > 0),
  })
  .strict();

export const documentCreateSchema = z
  .object({
    title: title.optional(),
    content: z
      .string()
      .max(8 * 1024 * 1024)
      .optional(),
  })
  .strict();

export const documentSchema = z
  .object({
    id,
    title,
    content: z.string().max(8 * 1024 * 1024),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const transitionSchema = z
  .object({
    type: z.enum([
      "none",
      "fade",
      "slide-left",
      "slide-right",
      "slide-up",
      "zoom",
    ]),
    duration: finite.min(0).max(60_000),
  })
  .strict();

const elementSchema = z
  .object({
    id,
    type: z.enum(["text", "shape", "image"]),
    x: finite,
    y: finite,
    width: finite.min(0),
    height: finite.min(0),
    rotation: finite,
    text: z.string().max(10_000).optional(),
    fontSize: finite.optional(),
    fontFamily: z.string().max(512).optional(),
    fontColor: css.optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    shapeType: z.enum(["rect", "ellipse", "triangle", "arrow"]).optional(),
    fillColor: css.optional(),
    strokeColor: css.optional(),
    strokeWidth: finite.optional(),
    imageUrl: z.string().max(2_048).optional(),
  })
  .strict();

const slideSchema = z
  .object({
    id,
    elements: z.array(elementSchema).max(10_000),
    background: css,
    transition: transitionSchema.optional(),
    notes: z.string().max(20_000).optional(),
  })
  .strict();

export const presentationCreateSchema = z
  .object({
    title: title.optional(),
  })
  .strict();

export const presentationSchema = z
  .object({
    id,
    title,
    slides: z.array(slideSchema).min(1).max(1_000),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

const cellFormatSchema = z
  .object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    textColor: css.optional(),
    bgColor: css.optional(),
    fontSize: finite.optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    numberFormat: z.string().max(256).optional(),
  })
  .strict();

const cellSchema = z
  .object({
    value: z.string().max(1_000_000),
    computed: z.string().max(1_000_000).optional(),
    format: cellFormatSchema.optional(),
  })
  .strict();

const conditionalRuleSchema = z
  .object({
    id,
    range: z.string().max(128),
    condition: z
      .object({
        type: z.enum([
          "greaterThan",
          "lessThan",
          "equal",
          "notEqual",
          "between",
          "textContains",
          "isEmpty",
          "isNotEmpty",
        ]),
        values: z.array(z.string().max(10_000)).max(2),
      })
      .strict(),
    format: cellFormatSchema,
  })
  .strict();

const sheetSchema = z
  .object({
    id,
    name: z.string().max(512),
    cells: z.record(z.string().max(32), cellSchema),
    colWidths: z.record(z.string(), finite),
    rowHeights: z.record(z.string(), finite),
    conditionalRules: z.array(conditionalRuleSchema).max(10_000).optional(),
    filter: z
      .object({
        column: z.number().int().min(0),
        query: z.string().max(10_000),
      })
      .strict()
      .optional(),
  })
  .strict();

export const spreadsheetCreateSchema = z
  .object({
    title: title.optional(),
  })
  .strict();

export const spreadsheetSchema = z
  .object({
    id,
    title,
    sheets: z.array(sheetSchema).min(1).max(256),
    activeSheetId: id,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();
