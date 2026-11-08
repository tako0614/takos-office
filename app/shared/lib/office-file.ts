export const MAX_OFFICE_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_OFFICE_EXPANDED_BYTES = 100 * 1024 * 1024;
export const MAX_OFFICE_ENTRIES = 10_000;
export const MAX_OFFICE_EDITOR_BYTES = 7 * 1024 * 1024;

export class OfficeFileError extends Error {
  constructor(readonly code: "invalid" | "too-large" | "unsafe" | "unsupported" | "timeout", options?: ErrorOptions) {
    super({ invalid: "This Office file is invalid.", "too-large": "This Office file is too large or complex.", unsafe: "This Office file contains unsafe content.", unsupported: "This Office file uses an unsupported feature.", timeout: "This Office file took too long to process." }[code], options);
    this.name = "OfficeFileError";
  }
}
