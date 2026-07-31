import { describe, expect, it } from "vitest";
import {
  AUXILIARY_BASELINE_MEMORY_LIMIT_KB,
  AUXILIARY_BASELINE_REUSE_LIMIT,
  clampWindowBounds,
  IMAGE_VIEWER_DEFAULT_SIZE,
  IMAGE_VIEWER_MINIMUM_SIZE,
  shouldRecycleAuxiliaryWindow,
} from "./auxiliary-window-policy";

describe("auxiliary window recycling policy", () => {
  it("uses the requested image viewer sizes and keeps restored bounds visible", () => {
    expect(IMAGE_VIEWER_DEFAULT_SIZE).toEqual({ width: 600, height: 450 });
    expect(IMAGE_VIEWER_MINIMUM_SIZE).toEqual({ width: 320, height: 240 });
    expect(clampWindowBounds(
      { x: 1800, y: -50, width: 200, height: 900 },
      { x: 0, y: 0, width: 1920, height: 1080 },
    )).toEqual({
      x: 1600,
      y: 0,
      width: 320,
      height: 900,
    });
  });

  it("keeps a healthy baseline renderer warm", () => {
    expect(shouldRecycleAuxiliaryWindow({
      baseline: true,
      reuseCount: AUXILIARY_BASELINE_REUSE_LIMIT - 1,
      privateBytesKb: AUXILIARY_BASELINE_MEMORY_LIMIT_KB,
    })).toBe(false);
  });

  it("recycles burst, overused and oversized renderers", () => {
    expect(shouldRecycleAuxiliaryWindow({
      baseline: false,
      reuseCount: 1,
      privateBytesKb: 1,
    })).toBe(true);
    expect(shouldRecycleAuxiliaryWindow({
      baseline: true,
      reuseCount: AUXILIARY_BASELINE_REUSE_LIMIT,
      privateBytesKb: 1,
    })).toBe(true);
    expect(shouldRecycleAuxiliaryWindow({
      baseline: true,
      reuseCount: 1,
      privateBytesKb: AUXILIARY_BASELINE_MEMORY_LIMIT_KB + 1,
    })).toBe(true);
  });
});
