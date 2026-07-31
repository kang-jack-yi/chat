import { describe, expect, it } from "vitest";
import { clampImageScale } from "./ImageViewerWindow";

describe("image viewer transforms", () => {
  it("limits zoom to 10% through 500%", () => {
    expect(clampImageScale(0)).toBe(0.1);
    expect(clampImageScale(1.25)).toBe(1.25);
    expect(clampImageScale(8)).toBe(5);
  });
});
