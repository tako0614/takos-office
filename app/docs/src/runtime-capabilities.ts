import {
  createScreenshotRuntimeCapability,
  type ScreenshotRuntimeCapability,
  screenshotUnavailableMessage,
} from "../../shared/runtime-capabilities.ts";

export const DOCS_SCREENSHOT_TOOL_NAME = "docs_screenshot";
export const DOCS_SCREENSHOT_UNAVAILABLE_MESSAGE =
  "docs_screenshot is unavailable in this runtime";

export type DocsScreenshotRuntimeCapability = ScreenshotRuntimeCapability;

export type DocsRuntimeCapabilityManifest = {
  screenshot: DocsScreenshotRuntimeCapability;
};

export function createDocsRuntimeCapabilityManifest(
  options: { nativeRendering?: boolean } = {},
): DocsRuntimeCapabilityManifest {
  return {
    screenshot: createScreenshotRuntimeCapability(
      DOCS_SCREENSHOT_TOOL_NAME,
      DOCS_SCREENSHOT_UNAVAILABLE_MESSAGE,
      options,
    ),
  };
}

export const docsScreenshotUnavailableMessage = screenshotUnavailableMessage;
