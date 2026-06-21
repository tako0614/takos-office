export const DOCS_SCREENSHOT_TOOL_NAME = "docs_screenshot";
export const DOCS_SCREENSHOT_UNAVAILABLE_MESSAGE =
  "docs_screenshot is unavailable in this runtime";

export type DocsScreenshotRuntimeCapability = {
  kind: "screenshot";
  toolName: typeof DOCS_SCREENSHOT_TOOL_NAME;
  requires: readonly ["nativeRendering"];
  supported: boolean;
  unavailableMessage: typeof DOCS_SCREENSHOT_UNAVAILABLE_MESSAGE;
  unavailableReason?: string;
};

export type DocsRuntimeCapabilityManifest = {
  screenshot: DocsScreenshotRuntimeCapability;
};

export function createDocsRuntimeCapabilityManifest(
  options: { nativeRendering?: boolean } = {},
): DocsRuntimeCapabilityManifest {
  const supported = options.nativeRendering ?? true;
  return {
    screenshot: {
      kind: "screenshot",
      toolName: DOCS_SCREENSHOT_TOOL_NAME,
      requires: ["nativeRendering"],
      supported,
      unavailableMessage: DOCS_SCREENSHOT_UNAVAILABLE_MESSAGE,
      unavailableReason: supported
        ? undefined
        : "Server-side canvas rendering is not available in this runtime.",
    },
  };
}

export function docsScreenshotUnavailableMessage(
  capability: DocsScreenshotRuntimeCapability,
): string | null {
  return capability.supported ? null : capability.unavailableMessage;
}
