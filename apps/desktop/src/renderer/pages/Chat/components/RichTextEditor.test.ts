import { describe, expect, it } from "vitest";
import { clipboardFiles, mentionPanelPosition, shouldSubmitMessage } from "./RichTextEditor";

function file(name: string, type: string, size = 10) {
  return { name, type, size } as File;
}

function transfer(files: File[]) {
  return {
    items: files.map((item) => ({
      kind: "file",
      getAsFile: () => item,
    })),
    files,
  } as unknown as DataTransfer;
}

describe("clipboardFiles", () => {
  it("removes the untyped hash file attached to a clipboard screenshot", () => {
    const screenshot = file("image.png", "image/png", 200);
    const temporary = file("1ed4695bfc43716d", "", 200);

    expect(clipboardFiles(transfer([screenshot, temporary]))).toEqual([screenshot]);
  });

  it("keeps regular copied files", () => {
    const document = file("需求说明.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    expect(clipboardFiles(transfer([document]))).toEqual([document]);
  });
});

describe("mentionPanelPosition", () => {
  it("opens above the caret when the bottom space is insufficient", () => {
    expect(mentionPanelPosition(
      { left: 80, top: 700, bottom: 720 },
      1000,
      760,
    )).toEqual({ left: 80, top: 458 });
  });

  it("keeps the panel inside the viewport horizontally", () => {
    expect(mentionPanelPosition(
      { left: 980, top: 100, bottom: 120 },
      1000,
      760,
    )).toEqual({ left: 768, top: 126 });
  });
});

describe("shouldSubmitMessage", () => {
  const event = (overrides: Partial<KeyboardEvent> = {}) => ({
    key: "Enter",
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    ...overrides,
  });

  it("respects Enter mode and keeps IME/Shift+Enter for editing", () => {
    expect(shouldSubmitMessage(event(), "enter")).toBe(true);
    expect(shouldSubmitMessage(event({ shiftKey: true }), "enter")).toBe(false);
    expect(shouldSubmitMessage(event({ isComposing: true }), "enter")).toBe(false);
  });

  it("requires Ctrl or Command in Ctrl+Enter mode", () => {
    expect(shouldSubmitMessage(event(), "ctrlEnter")).toBe(false);
    expect(shouldSubmitMessage(event({ ctrlKey: true }), "ctrlEnter")).toBe(true);
    expect(shouldSubmitMessage(event({ metaKey: true }), "ctrlEnter")).toBe(true);
  });
});
