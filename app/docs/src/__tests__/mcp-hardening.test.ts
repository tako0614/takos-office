import { expect, test } from "bun:test";

import {
  buildExportHtml,
  normalizeScreenshotDimensions,
  sanitizeHtmlForExport,
} from "../mcp.ts";

test("sanitizeHtmlForExport removes executable HTML and unsafe URLs", () => {
  const html = sanitizeHtmlForExport(
    '<p onclick="alert(1)">Hi<script>alert(2)</script></p><a href="javascript:alert(3)">bad</a><img src=x onerror=alert(4)>',
  );

  expect(html.includes("onclick")).toEqual(false);
  expect(html.includes("<script")).toEqual(false);
  expect(html.includes("javascript:")).toEqual(false);
  expect(html.includes("onerror")).toEqual(false);
  expect(html.includes("<p>Hialert(2)</p>")).toBeTruthy();
});

test("buildExportHtml escapes title and renders TipTap JSON safely", () => {
  const content = JSON.stringify({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Click",
            marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
          },
        ],
      },
      { type: "image", attrs: { src: "javascript:alert(2)", alt: "bad" } },
    ],
  });

  const html = buildExportHtml("<img src=x onerror=alert(1)>", content);
  expect(html.includes("&lt;img src=x onerror=alert(1)&gt;")).toBeTruthy();
  expect(html.includes("javascript:")).toEqual(false);
  expect(html.includes("<img src=")).toEqual(false);
  expect(html.includes("<p>Click</p>")).toBeTruthy();
});

test("normalizeScreenshotDimensions clamps image size", () => {
  expect(normalizeScreenshotDimensions(99, 50)).toEqual({
    width: 200,
    height: 200,
  });
  expect(normalizeScreenshotDimensions(50_000, 50_000)).toEqual({
    width: 2400,
    height: 3200,
  });
});
