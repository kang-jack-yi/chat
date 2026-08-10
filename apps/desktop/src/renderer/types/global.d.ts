declare module "socket.io-client" {
  const io: (uri?: string, options?: Record<string, unknown>) => any;
  export default io;
}
import type {
  ChatHistoryMetadata,
  DraftAttachment,
  AuxiliaryTask,
  ImageGalleryPage,
  InviteHistoryResult,
  Message,
  MessageHistoryPage,
  MessageHistoryQuery,
  OpenChatHistoryInput,
  OpenForwardRecordInput,
  OpenImageViewerInput,
  OpenInviteHistoryInput,
  ServerConfig,
  ServerHealth,
  SyncStatus,
} from "@chat/shared";

declare global {
  interface Window {
    desktop?: {
      app: {
        getVersion(): Promise<string>;
      };
      auth: {
        updateAccessToken(accessToken: string | null): Promise<boolean>;
        onTokenUpdated(listener: (accessToken: string) => void): () => void;
        onRequired(listener: () => void): () => void;
      };
      windows: {
        openInviteHistory(input: OpenInviteHistoryInput): Promise<InviteHistoryResult>;
        openImageViewer(input: OpenImageViewerInput): Promise<void>;
        openChatHistory(input: OpenChatHistoryInput): Promise<void>;
        openForwardRecord(input: OpenForwardRecordInput): Promise<void>;
        openDocument(documentId: number): Promise<void>;
        downloadDocument(input: {
          id: number;
          title: string;
        }): Promise<boolean>;
        onDocumentChanged(
          listener: (input: { documentId: number }) => void,
        ): () => void;
        onLocateHistoryMessage(
          listener: (input: { conversationId: number; messageId: number }) => void,
        ): () => void;
        getRecentInviteHistoryIds(conversationId: number): Promise<number[]>;
      };
      clipboard: {
        writeText(value: string): Promise<boolean>;
        readText(): Promise<string>;
        writeImage(input: {
          data: Uint8Array;
          mimeType: string;
        }): Promise<boolean>;
      };
      server: {
        get(): Promise<ServerConfig | null>;
        test(url: string): Promise<{ config: ServerConfig; health: ServerHealth }>;
        switch(url: string): Promise<{ config: ServerConfig; health: ServerHealth }>;
        onSwitched(listener: (config: ServerConfig) => void): () => void;
      };
      im: {
        open(input: { serverId: string; companyId: number; userId: number }): Promise<{ filePath: string }>;
        close(): Promise<void>;
        clear(): Promise<void>;
        call<T>(method: string, args?: unknown): Promise<T>;
      };
      attachment: {
        stage(input: {
          name: string;
          mimeType: string;
          size: number;
          data: Uint8Array;
        }): Promise<DraftAttachment>;
        removeDraft(id: string): Promise<boolean>;
        open(input: { attachmentId?: number; draftId?: string }): Promise<boolean>;
        saveAs(input: {
          attachmentId?: number;
          draftId?: string;
          name: string;
        }): Promise<boolean>;
        saveMany(input: Array<{
          attachmentId: number;
          name: string;
        }>): Promise<number>;
        showInFolder(input: {
          attachmentId?: number;
          draftId?: string;
        }): Promise<boolean>;
        readCache(attachmentId: number): Promise<Uint8Array | null>;
        writeCache(input: {
          attachmentId: number;
          data: Uint8Array;
        }): Promise<boolean>;
      };
      screenshot: {
        capture(input: { hideMainWindow: boolean }): Promise<
          | { canceled: true }
          | {
              canceled: false;
              name: string;
              mimeType: "image/png";
              data: Uint8Array;
            }
        >;
        getPreferences(): Promise<{
          hideMainWindow: boolean;
          shortcutAvailable: boolean;
        }>;
        setPreferences(input: { hideMainWindow: boolean }): Promise<boolean>;
        setActiveConversation(conversationId?: number): Promise<boolean>;
        onShortcut(
          listener: (input: { conversationId: number }) => void,
        ): () => void;
        onUnavailable(listener: () => void): () => void;
      };
      sync: {
        getStatus(): Promise<SyncStatus>;
        retry(): Promise<void>;
        report(status: SyncStatus): Promise<boolean>;
        subscribe(listener: (status: SyncStatus) => void): () => void;
        onRetry(listener: () => void): () => void;
      };
      external: {
        open(url: string): Promise<void>;
      };
    };
    auxiliary?: {
      task: {
        get(): Promise<AuxiliaryTask | null>;
        complete(taskId: string, result: InviteHistoryResult): Promise<void>;
        cancel(taskId: string): Promise<void>;
        resetComplete(taskId: string): Promise<void>;
        onReady(listener: () => void): () => void;
        onUpdated(listener: () => void): () => void;
        onReset(listener: (taskId: string) => void): () => void;
      };
      messages: {
        getRecent(input: {
          taskId: string;
          conversationId: number;
          limit: 30;
        }): Promise<Message[]>;
      };
      history: {
        getMetadata(taskId: string): Promise<ChatHistoryMetadata>;
        query(input: {
          taskId: string;
          query: MessageHistoryQuery;
        }): Promise<MessageHistoryPage>;
        locate(input: {
          taskId: string;
          messageId: number;
        }): Promise<boolean>;
      };
      forwardRecord: {
        get(taskId: string): Promise<Message>;
      };
      attachments: {
        resolve(input: {
          taskId: string;
          attachmentId: number;
        }): Promise<{ url: string }>;
      };
      images: {
        openViewer(input: {
          taskId: string;
          conversationId: number;
          messageId: number;
          attachmentId: number;
        }): Promise<void>;
        getPage(input: {
          taskId: string;
          direction: "initial" | "previous" | "next";
          cursor?: string;
          limit: number;
        }): Promise<ImageGalleryPage>;
        resolve(input: {
          taskId: string;
          imageKey: string;
        }): Promise<{ url: string }>;
        saveAs(input: {
          taskId: string;
          imageKey: string;
        }): Promise<boolean>;
      };
    };
    documentDesktop?: {
      context: {
        get(): Promise<{
          documentId: number;
          serverUrl: string;
          accessToken: string;
          account: {
            serverId: string;
            companyId: number;
            userId: number;
          };
        }>;
        refreshToken(): Promise<string>;
        onTokenUpdated(listener: (accessToken: string) => void): () => void;
      };
      window: {
        download(input: { id: number; title: string }): Promise<boolean>;
        notifyChanged(documentId: number): Promise<boolean>;
        onBeforeClose(listener: () => void): () => void;
        readyToClose(): Promise<boolean>;
      };
    };
  }
}

export {};
