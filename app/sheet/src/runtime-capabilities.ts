import {
  createScreenshotRuntimeCapability,
  type ScreenshotRuntimeCapability,
  screenshotUnavailableMessage,
} from "../../shared/runtime-capabilities.ts";

export const EXCEL_SCREENSHOT_TOOL_NAME = "sheet_screenshot";
export const EXCEL_SCREENSHOT_UNAVAILABLE_MESSAGE =
  "sheet_screenshot is unavailable in this runtime";

export type ExcelScreenshotRuntimeCapability = ScreenshotRuntimeCapability;

export type ExcelRuntimeCapabilityManifest = {
  screenshot: ExcelScreenshotRuntimeCapability;
};

export function createExcelRuntimeCapabilityManifest(
  options: { nativeRendering?: boolean } = {},
): ExcelRuntimeCapabilityManifest {
  return {
    screenshot: createScreenshotRuntimeCapability(
      EXCEL_SCREENSHOT_TOOL_NAME,
      EXCEL_SCREENSHOT_UNAVAILABLE_MESSAGE,
      options,
    ),
  };
}

export const excelScreenshotUnavailableMessage = screenshotUnavailableMessage;
