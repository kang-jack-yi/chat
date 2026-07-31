import type { Attachment } from "@chat/shared";
import { httpClient, post } from "./request";

export const uploadService = {
  async file(
    file: File,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ) {
    const form = new FormData();
    form.append("file", file);
    const attachment = await post<Attachment>("/api/uploads", form, {
      signal,
      onUploadProgress: (event) => {
        if (!event.total) return;
        onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      },
    });
    const data = new Uint8Array(await file.arrayBuffer());
    await window.desktop?.attachment.writeCache({ attachmentId: attachment.id, data });
    return attachment;
  },
  remove: (attachmentId: number) =>
    httpClient.delete(`/api/uploads/${attachmentId}`),
  async blob(attachment: Attachment) {
    const cached = await window.desktop?.attachment.readCache(attachment.id);
    if (cached) return new Blob([Uint8Array.from(cached).buffer], { type: attachment.mimeType });
    const response = await httpClient.get<ArrayBuffer>(attachment.url, { responseType: "arraybuffer" });
    const data = new Uint8Array(response.data);
    await window.desktop?.attachment.writeCache({ attachmentId: attachment.id, data });
    return new Blob([response.data], { type: attachment.mimeType });
  },
};
