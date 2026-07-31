import type {
  Conversation,
  GlobalMessageSearchPage,
  GlobalMessageSearchQuery,
  LocalMessage,
  Message,
  MessageContext,
  MessageHistoryPage,
  MessageHistoryQuery,
  SendMessagePayload,
  SessionData,
  SyncBootstrap,
  SyncEvent,
} from "@chat/shared";
import type { MessagePage } from "../types/api";

const call = <T>(method: string, args?: unknown) => {
  if (!window.desktop) return Promise.reject(new Error("桌面数据库不可用"));
  return window.desktop.im.call<T>(method, args);
};

export const localDatabase = {
  available: () => Boolean(window.desktop),
  async open(serverId: string, session: SessionData) {
    if (!window.desktop) return;
    await window.desktop.im.open({
      serverId,
      companyId: session.company.id,
      userId: session.user.id,
    });
  },
  close: () => window.desktop?.im.close(),
  clear: () => window.desktop?.im.clear(),
  applyBootstrap: (bootstrap: SyncBootstrap) => call<boolean>("applyBootstrap", bootstrap),
  applyEvents: (events: SyncEvent[]) => call<boolean>("applyEvents", events),
  upsertMessages: (messages: Message[]) => call<boolean>("upsertMessages", messages),
  conversations: () => call<Conversation[]>("listConversations"),
  upsertConversations: (conversations: Conversation[]) => call<boolean>("upsertConversations", conversations),
  replaceConversations: (conversations: Conversation[]) => call<boolean>("replaceConversations", conversations),
  messages: (conversationId: number, before?: number) =>
    call<MessagePage<Message>>("getMessages", { conversationId, before, limit: 30 }),
  clearConversationMessages: (conversationId: number) =>
    call<boolean>("clearConversationMessages", conversationId),
  search: (query: string, conversationId?: number) =>
    call<Array<{ message: Message; snippet: string }>>("searchMessages", { query, conversationId }),
  searchWorkspace: (query: GlobalMessageSearchQuery) =>
    call<GlobalMessageSearchPage>("searchWorkspace", query),
  history: (query: MessageHistoryQuery) =>
    call<MessageHistoryPage>("queryMessageHistory", query),
  messageContext: (conversationId: number, messageId: number) =>
    call<MessageContext>("getMessageContext", { conversationId, messageId }),
  message: (conversationId: number, messageId: number) =>
    call<Message | null>("getMessage", { conversationId, messageId }),
  removeMessagesForMe: (conversationId: number, messageIds: number[]) =>
    call<boolean>("removeMessagesForMe", { conversationId, messageIds }),
  enqueue: (message: LocalMessage, command: SendMessagePayload) =>
    call<LocalMessage>("enqueueMessage", { message, command }),
  markMessage: (input: { clientId: string; message?: Message; status: string; error?: string }) =>
    call<boolean>("markMessage", input),
  getOutbox: () =>
    call<Array<{ payload: SendMessagePayload; retryCount: number; lastError?: string }>>("getOutbox"),
  hasPendingConversation: (conversationId: number) =>
    call<boolean>("hasPendingConversation", conversationId),
  cancel: (clientId: string) => call<boolean>("cancelQueuedMessage", clientId),
  getCursor: async () => Number(await call<string | null>("getSyncState", "cursor") || 0),
  setState: (key: string, value: string) => call<boolean>("setSyncState", { key, value }),
};
