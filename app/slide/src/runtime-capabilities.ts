import {
  createScreenshotRuntimeCapability,
  type ScreenshotRuntimeCapability,
  screenshotUnavailableMessage,
} from "../../shared/runtime-capabilities.ts";

export const SLIDE_SCREENSHOT_TOOL_NAME = "slide_screenshot";
export const SLIDE_SCREENSHOT_UNAVAILABLE_MESSAGE =
  "slide_screenshot is unavailable in this runtime";

export type SlideScreenshotRuntimeCapability = ScreenshotRuntimeCapability;

export type SlideRuntimeCapabilityManifest = {
  screenshot: SlideScreenshotRuntimeCapability;
};

export function createSlideRuntimeCapabilityManifest(
  options: { nativeRendering?: boolean } = {},
): SlideRuntimeCapabilityManifest {
  return {
    screenshot: createScreenshotRuntimeCapability(
      SLIDE_SCREENSHOT_TOOL_NAME,
      SLIDE_SCREENSHOT_UNAVAILABLE_MESSAGE,
      options,
    ),
  };
}

export const slideScreenshotUnavailableMessage = screenshotUnavailableMessage;
