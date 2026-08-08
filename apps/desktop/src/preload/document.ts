import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("documentDesktop", {
  context: {
    get: () => ipcRenderer.invoke("document:get-context"),
    refreshToken: () => ipcRenderer.invoke("document:refresh-token"),
    onTokenUpdated: (listener: (accessToken: string) => void) => {
      const handler = (_event: unknown, accessToken: string) => listener(accessToken);
      ipcRenderer.on("document:token-updated", handler);
      return () => ipcRenderer.off("document:token-updated", handler);
    },
  },
  window: {
    download: (input: { id: number; title: string }) =>
      ipcRenderer.invoke("windows:download-document", input),
    notifyChanged: (documentId: number) =>
      ipcRenderer.invoke("document:changed", documentId),
    onBeforeClose: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("document:before-close", handler);
      return () => ipcRenderer.off("document:before-close", handler);
    },
    readyToClose: () => ipcRenderer.invoke("document:ready-to-close"),
  },
});
