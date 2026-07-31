import { afterEach, describe, expect, it, vi } from "vitest";
import { readClipboardText, writeClipboardText } from "./clipboard";

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("desktop clipboard", () => {
  it("uses the Electron bridge for text copy and paste", async () => {
    const writeText = vi.fn(async () => true);
    const readText = vi.fn(async () => "copied message");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktop: {
          clipboard: {
            writeText,
            readText,
          },
        },
      },
    });

    await writeClipboardText("message");

    expect(writeText).toHaveBeenCalledWith("message");
    await expect(readClipboardText()).resolves.toBe("copied message");
  });
});
