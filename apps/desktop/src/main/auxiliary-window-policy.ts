export const AUXILIARY_BASELINE_MEMORY_LIMIT_KB = 128 * 1024;
export const AUXILIARY_BASELINE_REUSE_LIMIT = 50;
export const IMAGE_VIEWER_DEFAULT_SIZE = { width: 600, height: 450 } as const;
export const IMAGE_VIEWER_MINIMUM_SIZE = { width: 320, height: 240 } as const;

export function clampWindowBounds(
  bounds: { x: number; y: number; width: number; height: number },
  area: { x: number; y: number; width: number; height: number },
  minimum = IMAGE_VIEWER_MINIMUM_SIZE,
) {
  const width = Math.min(Math.max(bounds.width, minimum.width), area.width);
  const height = Math.min(Math.max(bounds.height, minimum.height), area.height);
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
  };
}

export function shouldRecycleAuxiliaryWindow(input: {
  baseline: boolean;
  reuseCount: number;
  privateBytesKb: number;
}) {
  return !input.baseline
    || input.reuseCount >= AUXILIARY_BASELINE_REUSE_LIMIT
    || input.privateBytesKb > AUXILIARY_BASELINE_MEMORY_LIMIT_KB;
}
