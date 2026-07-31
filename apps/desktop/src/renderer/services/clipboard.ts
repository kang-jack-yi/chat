export async function writeClipboardText(text: string) {
  if (window.desktop?.clipboard) {
    await window.desktop.clipboard.writeText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}

export async function readClipboardText() {
  if (window.desktop?.clipboard) {
    return window.desktop.clipboard.readText();
  }
  return navigator.clipboard.readText();
}

export async function writeClipboardImage(blob: Blob) {
  if (window.desktop?.clipboard) {
    const data = new Uint8Array(await blob.arrayBuffer());
    await window.desktop.clipboard.writeImage({
      data,
      mimeType: blob.type || "image/png",
    });
    return;
  }
  if (!("ClipboardItem" in window)) {
    throw new Error("当前环境不支持复制图片");
  }
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type]: blob }),
  ]);
}
