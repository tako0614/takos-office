/** PresentationML dimensions are exact integer EMUs; one inch is 914,400 EMUs. */
export interface SlideSize {
  widthEmu: number;
  heightEmu: number;
}
export const EMU_PER_INCH = 914_400;
export const EMU_PER_LOGICAL_PIXEL = 9_525; // the editor's 96 pixels per inch
export const MIN_SLIDE_EMU = 91_440;
export const MAX_SLIDE_EMU = 51_206_400;
export const LEGACY_SLIDE_SIZE: Readonly<SlideSize> = Object.freeze({
  widthEmu: 9_144_000,
  heightEmu: 5_143_500,
});

export function isValidSlideSize(value: unknown): value is SlideSize {
  if (!value || typeof value !== "object") return false;
  const size = value as SlideSize;
  return Number.isSafeInteger(size.widthEmu) && Number.isSafeInteger(size.heightEmu)
    && size.widthEmu >= MIN_SLIDE_EMU && size.widthEmu <= MAX_SLIDE_EMU
    && size.heightEmu >= MIN_SLIDE_EMU && size.heightEmu <= MAX_SLIDE_EMU
    && size.widthEmu / size.heightEmu >= 1 / 32 && size.widthEmu / size.heightEmu <= 32;
}

export function physicalSlideSize(size?: SlideSize): Readonly<SlideSize> {
  if (size === undefined) return LEGACY_SLIDE_SIZE;
  if (!isValidSlideSize(size)) throw new RangeError("Invalid presentation slide size");
  return size;
}

export function logicalSlideSize(size?: SlideSize): {width: number; height: number} {
  const physical = physicalSlideSize(size);
  return {
    width: physical.widthEmu / EMU_PER_LOGICAL_PIXEL,
    height: physical.heightEmu / EMU_PER_LOGICAL_PIXEL,
  };
}
