/**
 * Shared screenshot runtime-capability model for the office editors.
 *
 * Each editor (docs / slide / sheet) exposes a `<editor>_screenshot` MCP tool
 * that needs server-side canvas rendering (Bun container, never workerd).
 * Availability is a single boolean (`nativeRendering`); when it is false the
 * tool returns `unavailableMessage` instead of attempting a render.
 *
 * This is the single definition; each editor wraps it with its own tool name
 * and message in `app/<editor>/src/runtime-capabilities.ts`.
 */

export type ScreenshotRuntimeCapability = {
  kind: "screenshot";
  toolName: string;
  requires: readonly ["nativeRendering"];
  supported: boolean;
  unavailableMessage: string;
  unavailableReason?: string;
};

export function createScreenshotRuntimeCapability(
  toolName: string,
  unavailableMessage: string,
  options: { nativeRendering?: boolean } = {},
): ScreenshotRuntimeCapability {
  const supported = options.nativeRendering ?? true;
  return {
    kind: "screenshot",
    toolName,
    requires: ["nativeRendering"],
    supported,
    unavailableMessage,
    unavailableReason: supported
      ? undefined
      : "Server-side canvas rendering is not available in this runtime.",
  };
}

export function screenshotUnavailableMessage(
  capability: ScreenshotRuntimeCapability,
): string | null {
  return capability.supported ? null : capability.unavailableMessage;
}
