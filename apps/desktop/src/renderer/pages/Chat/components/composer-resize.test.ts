import { describe, expect, it } from "vitest";
import {
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  resizedComposerHeight,
} from "./composer-resize";

describe("resizedComposerHeight", () => {
  it("grows upward and shrinks downward", () => {
    expect(resizedComposerHeight(176, 500, 400)).toBe(276);
    expect(resizedComposerHeight(276, 400, 500)).toBe(176);
  });

  it("clamps the composer to its minimum and maximum", () => {
    expect(resizedComposerHeight(176, 500, 900)).toBe(COMPOSER_MIN_HEIGHT);
    expect(resizedComposerHeight(176, 500, 0)).toBe(COMPOSER_MAX_HEIGHT);
  });
});
