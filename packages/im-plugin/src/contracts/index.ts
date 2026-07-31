import type {
  Conversation,
  DraftAttachment,
  DraftSendCommand,
  LocalImMessage,
  Message,
  MessageContext,
  MessageHistoryPage,
  MessageHistoryQuery,
  SyncStatus,
} from "@chat/shared";

export interface MessagePageInput {
  conversationId: number;
  before?: number;
  limit?: number;
}

export interface MessagePage {
  items: Message[];
  nextCursor: number | null;
}

export type ImPluginEvent =
  | { type: "message.upsert"; message: LocalImMessage }
  | { type: "conversation.upsert"; conversation: Conversation }
  | { type: "send.status"; clientId: string; status: LocalImMessage["status"]; progress?: number }
  | { type: "sync.status"; status: SyncStatus }
  | { type: "auth.required" }
  | { type: "plugin.error"; error: { code: string; message: string } };

export interface ImPluginContract {
  initialize(input: {
    serverUrl: string;
    serverId: string;
    companyId: number;
    userId: number;
    accessToken: string;
  }): Promise<void>;
  updateAccessToken(accessToken: string): Promise<void>;
  deactivate(): Promise<void>;
  stageAttachment(input: {
    name: string;
    mimeType: string;
    size: number;
    data: Uint8Array;
  }): Promise<DraftAttachment>;
  send(input: DraftSendCommand): Promise<LocalImMessage[]>;
  retry(clientId: string): Promise<void>;
  cancel(clientId: string): Promise<void>;
  getMessages(input: MessagePageInput): Promise<MessagePage>;
  getRecentUserMessages(input: {
    conversationId: number;
    limit?: number;
  }): Promise<Message[]>;
  queryMessageHistory(input: MessageHistoryQuery): Promise<MessageHistoryPage>;
  getMessageContext(input: {
    conversationId: number;
    messageId: number;
  }): Promise<MessageContext>;
  listConversations(): Promise<Conversation[]>;
}
