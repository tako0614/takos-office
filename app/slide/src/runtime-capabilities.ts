export const SLIDE_SCREENSHOT_TOOL_NAME = "slide_screenshot";
export const SLIDE_SCREENSHOT_UNAVAILABLE_MESSAGE =
  "slide_screenshot is unavailable in this runtime";

export type SlideScreenshotRuntimeCapability = {
  kind: "screenshot";
  toolName: typeof SLIDE_SCREENSHOT_TOOL_NAME;
  requires: readonly ["nativeRendering"];
  supported: boolean;
  unavailableMessage: typeof SLIDE_SCREENSHOT_UNAVAILABLE_MESSAGE;
  unavailableReason?: string;
};

export type SlideRuntimeCapabilityManifest = {
  screenshot: SlideScreenshotRuntimeCapability;
};

export function createSlideRuntimeCapabilityManifest(
  options: { nativeRendering?: boolean } = {},
): SlideRuntimeCapabilityManifest {
  const supported = options.nativeRendering ?? true;
  return {
    screenshot: {
      kind: "screenshot",
      toolName: SLIDE_SCREENSHOT_TOOL_NAME,
      requires: ["nativeRendering"],
      supported,
      unavailableMessage: SLIDE_SCREENSHOT_UNAVAILABLE_MESSAGE,
      unavailableReason: supported
        ? undefined
        : "Server-side canvas rendering is not available in this runtime.",
    },
  };
}

export function slideScreenshotUnavailableMessage(
  capability: SlideScreenshotRuntimeCapability,
): string | null {
  return capability.supported ? null : capability.unavailableMessage;
}
