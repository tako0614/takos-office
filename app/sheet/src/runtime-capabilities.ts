export const EXCEL_SCREENSHOT_TOOL_NAME = "sheet_screenshot";
export const EXCEL_SCREENSHOT_UNAVAILABLE_MESSAGE =
  "sheet_screenshot is unavailable in this runtime";

export type ExcelScreenshotRuntimeCapability = {
  kind: "screenshot";
  toolName: typeof EXCEL_SCREENSHOT_TOOL_NAME;
  requires: readonly ["nativeRendering"];
  supported: boolean;
  unavailableMessage: typeof EXCEL_SCREENSHOT_UNAVAILABLE_MESSAGE;
  unavailableReason?: string;
};

export type ExcelRuntimeCapabilityManifest = {
  screenshot: ExcelScreenshotRuntimeCapability;
};

export function createExcelRuntimeCapabilityManifest(
  options: { nativeRendering?: boolean } = {},
): ExcelRuntimeCapabilityManifest {
  const supported = options.nativeRendering ?? true;
  return {
    screenshot: {
      kind: "screenshot",
      toolName: EXCEL_SCREENSHOT_TOOL_NAME,
      requires: ["nativeRendering"],
      supported,
      unavailableMessage: EXCEL_SCREENSHOT_UNAVAILABLE_MESSAGE,
      unavailableReason: supported
        ? undefined
        : "Server-side canvas rendering is not available in this runtime.",
    },
  };
}

export function excelScreenshotUnavailableMessage(
  capability: ExcelScreenshotRuntimeCapability,
): string | null {
  return capability.supported ? null : capability.unavailableMessage;
}
