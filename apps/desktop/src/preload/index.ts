import { contextBridge, ipcRenderer } from "electron";

const desktop = {
  app: {
    getVersion: () => ipcRenderer.invoke("app:get-version"),
  },
  preferences: {
    get: () => ipcRenderer.invoke("preferences:get"),
    update: (input: unknown) => ipcRenderer.invoke("preferences:update", input),
    chooseDownloadDirectory: () => ipcRenderer.invoke("preferences:choose-download-directory"),
    openLogs: () => ipcRenderer.invoke("preferences:open-logs"),
    cacheStats: () => ipcRenderer.invoke("preferences:cache-stats"),
    clearAttachmentCache: () => ipcRenderer.invoke("preferences:clear-attachment-cache"),
    onChanged: (listener: (preferences: unknown) => void) => {
      const handler = (_event: unknown, preferences: unknown) => listener(preferences);
      ipcRenderer.on("preferences:changed", handler);
      return () => ipcRenderer.off("preferences:changed", handler);
    },
  },
  auth: {
    updateAccessToken: (accessToken: string | null) =>
      ipcRenderer.invoke("auth:update-access-token", accessToken),
    onTokenUpdated: (listener: (accessToken: string) => void) => {
      const handler = (_event: unknown, accessToken: string) => listener(accessToken);
      ipcRenderer.on("auth:token-updated", handler);
      return () => ipcRenderer.off("auth:token-updated", handler);
    },
    onRequired: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("auth:required", handler);
      return () => ipcRenderer.off("auth:required", handler);
    },
  },
  windows: {
    openInviteHistory: (input: unknown) =>
      ipcRenderer.invoke("windows:open-invite-history", input),
    openImageViewer: (input: unknown) =>
      ipcRenderer.invoke("windows:open-image-viewer", input),
    openChatHistory: (input: unknown) =>
      ipcRenderer.invoke("windows:open-chat-history", input),
    openForwardRecord: (input: unknown) =>
      ipcRenderer.invoke("windows:open-forward-record", input),
    openDocument: (documentId: number) =>
      ipcRenderer.invoke("windows:open-document", documentId),
    downloadDocument: (input: { id: number; title: string }) =>
      ipcRenderer.invoke("windows:download-document", input),
    onDocumentChanged: (listener: (input: { documentId: number }) => void) => {
      const handler = (_event: unknown, input: { documentId: number }) => listener(input);
      ipcRenderer.on("documents:changed", handler);
      return () => ipcRenderer.off("documents:changed", handler);
    },
    onLocateHistoryMessage: (
      listener: (input: { conversationId: number; messageId: number }) => void,
    ) => {
      const handler = (
        _event: unknown,
        input: { conversationId: number; messageId: number },
      ) => listener(input);
      ipcRenderer.on("windows:locate-history-message", handler);
      return () => ipcRenderer.off("windows:locate-history-message", handler);
    },
    getRecentInviteHistoryIds: (conversationId: number) =>
      ipcRenderer.invoke("windows:get-recent-invite-history-ids", conversationId),
  },
  clipboard: {
    writeText: (value: string) => ipcRenderer.invoke("clipboard:write-text", value),
    readText: () => ipcRenderer.invoke("clipboard:read-text"),
    writeImage: (input: { data: Uint8Array; mimeType: string }) =>
      ipcRenderer.invoke("clipboard:write-image", input),
  },
  server: {
    get: () => ipcRenderer.invoke("server:get"),
    test: (url: string) => ipcRenderer.invoke("server:test", url),
    switch: (url: string) => ipcRenderer.invoke("server:switch", url),
    onSwitched: (listener: (config: unknown) => void) => {
      const handler = (_event: unknown, config: unknown) => listener(config);
      ipcRenderer.on("server:switched", handler);
      return () => ipcRenderer.off("server:switched", handler);
    },
  },
  im: {
    open: (input: { serverId: string; companyId: number; userId: number }) =>
      ipcRenderer.invoke("database:open", input),
    close: () => ipcRenderer.invoke("database:close"),
    clear: () => ipcRenderer.invoke("database:clear"),
    call: <T>(method: string, args?: unknown) =>
      ipcRenderer.invoke("database:call", method, args) as Promise<T>,
  },
  attachment: {
    stage: (input: { name: string; mimeType: string; size: number; data: Uint8Array }) =>
      ipcRenderer.invoke("attachment:stage", input),
    removeDraft: (id: string) => ipcRenderer.invoke("attachment:remove-draft", id),
    open: (input: { attachmentId?: number; draftId?: string }) =>
      ipcRenderer.invoke("attachment:open", input),
    saveAs: (input: { attachmentId?: number; draftId?: string; name: string }) =>
      ipcRenderer.invoke("attachment:save-as", input),
    saveMany: (input: Array<{ attachmentId: number; name: string }>) =>
      ipcRenderer.invoke("attachment:save-many", input),
    showInFolder: (input: { attachmentId?: number; draftId?: string }) =>
      ipcRenderer.invoke("attachment:show-in-folder", input),
    readCache: (attachmentId: number) =>
      ipcRenderer.invoke("cache:read-attachment", attachmentId),
    writeCache: (input: { attachmentId: number; data: Uint8Array }) =>
      ipcRenderer.invoke("cache:write-attachment", input),
  },
  screenshot: {
    capture: (input: { hideMainWindow: boolean }) =>
      ipcRenderer.invoke("screenshot:capture", input),
    getPreferences: () => ipcRenderer.invoke("screenshot:get-preferences"),
    setPreferences: (input: { hideMainWindow: boolean }) =>
      ipcRenderer.invoke("screenshot:set-preferences", input),
    setActiveConversation: (conversationId?: number) =>
      ipcRenderer.invoke("screenshot:set-active-conversation", conversationId),
    onShortcut: (listener: (input: { conversationId: number }) => void) => {
      const handler = (_event: unknown, input: { conversationId: number }) => listener(input);
      ipcRenderer.on("screenshot:shortcut", handler);
      return () => ipcRenderer.off("screenshot:shortcut", handler);
    },
    onUnavailable: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("screenshot:unavailable", handler);
      return () => ipcRenderer.off("screenshot:unavailable", handler);
    },
  },
  sync: {
    getStatus: () => ipcRenderer.invoke("sync:get-status"),
    retry: () => ipcRenderer.invoke("sync:retry"),
    report: (status: unknown) => ipcRenderer.invoke("sync:report", status),
    subscribe: (listener: (status: unknown) => void) => {
      const handler = (_event: unknown, status: unknown) => listener(status);
      ipcRenderer.on("sync:status", handler);
      return () => ipcRenderer.off("sync:status", handler);
    },
    onRetry: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("sync:retry-requested", handler);
      return () => ipcRenderer.off("sync:retry-requested", handler);
    },
  },
  external: {
    open: (url: string) => ipcRenderer.invoke("external:open", url),
  },
};

contextBridge.exposeInMainWorld("desktop", desktop);
