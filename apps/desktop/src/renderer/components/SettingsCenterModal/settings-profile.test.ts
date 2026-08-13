import { describe, expect, it, vi } from "vitest";
import { inferStatusDuration, resolveStatusExpiry } from "./index";

describe("profile status duration", () => {
  it("expires today at the next local midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 20, 45, 0));
    expect(resolveStatusExpiry("today")).toBe(new Date(2026, 7, 13, 0, 0, 0).toISOString());
    vi.useRealTimers();
  });

  it("restores the closest duration from the stored expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 10, 0, 0));
    expect(inferStatusDuration(null)).toBe("never");
    expect(inferStatusDuration(new Date(2026, 7, 12, 11, 0, 0).toISOString())).toBe("1h");
    expect(inferStatusDuration(new Date(2026, 7, 12, 14, 0, 0).toISOString())).toBe("4h");
    expect(inferStatusDuration(new Date(2026, 7, 13, 0, 0, 0).toISOString())).toBe("today");
    vi.useRealTimers();
  });
});
