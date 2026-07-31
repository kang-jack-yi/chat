import { contextBridge, ipcRenderer } from "electron";
import type {
  AuxiliaryTask,
  ChatHistoryMetadata,
  ImageGalleryPage,
  InviteHistoryResult,
  Message,
  MessageHistoryPage,
  MessageHistoryQuery,
} from "@chat/shared";

const auxiliary = {
  task: {
    get: () => ipcRenderer.invoke("auxiliary:task:get") as Promise<AuxiliaryTask | null>,
    complete: (taskId: string, result: InviteHistoryResult) =>
      ipcRenderer.invoke("auxiliary:task:complete", taskId, result),
    cancel: (taskId: string) =>
      ipcRenderer.invoke("auxiliary:task:cancel", taskId),
    onReady: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("auxiliary:task-ready", handler);
      return () => ipcRenderer.off("auxiliary:task-ready", handler);
    },
    onUpdated: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("auxiliary:task-updated", handler);
      return () => ipcRenderer.off("auxiliary:task-updated", handler);
    },
    resetComplete: (taskId: string) =>
      ipcRenderer.invoke("auxiliary:task:reset-complete", taskId),
    onReset: (listener: (taskId: string) => void) => {
      const handler = (_event: unknown, taskId: string) => listener(taskId);
      ipcRenderer.on("auxiliary:task-reset", handler);
      return () => ipcRenderer.off("auxiliary:task-reset", handler);
    },
  },
  messages: {
    getRecent: (input: {
      taskId: string;
      conversationId: number;
      limit: 30;
    }) => ipcRenderer.invoke("auxiliary:messages:get-recent", input) as Promise<Message[]>,
  },
  history: {
    getMetadata: (taskId: string) =>
      ipcRenderer.invoke(
        "auxiliary:history:get-metadata",
        taskId,
      ) as Promise<ChatHistoryMetadata>,
    query: (input: { taskId: string; query: MessageHistoryQuery }) =>
      ipcRenderer.invoke(
        "auxiliary:history:query",
        input,
      ) as Promise<MessageHistoryPage>,
    locate: (input: { taskId: string; messageId: number }) =>
      ipcRenderer.invoke("auxiliary:history:locate", input) as Promise<boolean>,
  },
  forwardRecord: {
    get: (taskId: string) =>
      ipcRenderer.invoke("auxiliary:forward-record:get", taskId) as Promise<Message>,
  },
  attachments: {
    resolve: (input: { taskId: string; attachmentId: number }) =>
      ipcRenderer.invoke("auxiliary:attachments:resolve", input) as Promise<{ url: string }>,
  },
  images: {
    openViewer: (input: {
      taskId: string;
      conversationId: number;
      messageId: number;
      attachmentId: number;
    }) => ipcRenderer.invoke("auxiliary:images:open-viewer", input),
    getPage: (input: {
      taskId: string;
      direction: "initial" | "previous" | "next";
      cursor?: string;
      limit: number;
    }) => ipcRenderer.invoke("auxiliary:images:get-page", input) as Promise<ImageGalleryPage>,
    resolve: (input: { taskId: string; imageKey: string }) =>
      ipcRenderer.invoke("auxiliary:images:resolve", input) as Promise<{ url: string }>,
    saveAs: (input: { taskId: string; imageKey: string }) =>
      ipcRenderer.invoke("auxiliary:images:save-as", input) as Promise<boolean>,
  },
};

contextBridge.exposeInMainWorld("auxiliary", auxiliary);
