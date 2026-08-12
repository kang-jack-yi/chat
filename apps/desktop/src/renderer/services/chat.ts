import type {
  Conversation,
  DeleteMessagesForMeResult,
  ForwardMessagesInput,
  ForwardMessagesResult,
  GlobalMessageSearchPage,
  Message,
  MessageReceiptDetails,
  PublishAnnouncementPayload,
  RecallMessageResult,
  SendMessagePayload,
} from "@chat/shared";
import type { MessagePage } from "../types/api";
import { get, patch, post, remove } from "./request";
import { localDatabase } from "./local-database";

export type SendMessageInput = SendMessagePayload;

async function cacheConversation(conversation: Conversation) {
  if (localDatabase.available()) await localDatabase.upsertConversations([conversation]);
  return conversation;
}

async function refreshConversationCache() {
  const conversations = await get<Conversation[]>("/api/conversations?includeHidden=1");
  if (localDatabase.available()) await localDatabase.replaceConversations(conversations);
  return conversations;
}

export const chatService = {
  conversations: () =>
    localDatabase.available()
      ? localDatabase.conversations().then((items) =>
          items.filter((conversation) => !conversation.hidden))
      : get<Conversation[]>("/api/conversations"),
  searchWorkspace: (keyword: string, cursor?: string) =>
    localDatabase.available()
      ? localDatabase.searchWorkspace({ keyword, cursor, limit: 20 })
      : Promise.resolve<GlobalMessageSearchPage>({
          conversations: [],
          messages: [],
          nextCursor: null,
          historyComplete: false,
        }),
  messages: (id: number, before?: number, keyword?: string) => {
    if (localDatabase.available()) {
      if (keyword) {
        return localDatabase.search(keyword, id).then((rows) => ({
          items: rows.map((row) => row.message),
          nextCursor: null,
        }));
      }
      return localDatabase.messages(id, before);
    }
    const params = new URLSearchParams({ limit: "30" });
    if (before) params.set("before", String(before));
    if (keyword) params.set("q", keyword);
    return get<MessagePage<Message>>(`/api/conversations/${id}/messages?${params}`);
  },
  messageReceipts: (conversationId: number, messageId: number) =>
    get<MessageReceiptDetails>(
      `/api/conversations/${conversationId}/messages/${messageId}/receipts`,
    ),
  createDirect: (userId: number) =>
    post<Conversation>("/api/conversations", { type: "direct", userId }).then(cacheConversation),
  createGroup: (name: string, memberIds: number[]) =>
    post<Conversation>("/api/conversations", { type: "group", name, memberIds }).then(cacheConversation),
  send: (input: SendMessageInput) =>
    post<Message>(`/api/conversations/${input.conversationId}/messages`, input),
  publishAnnouncement: (input: PublishAnnouncementPayload) =>
    post<Message>(
      `/api/conversations/${input.conversationId}/announcement`,
      input,
    ),
  recall: (conversationId: number, messageId: number) =>
    post<RecallMessageResult>(
      `/api/conversations/${conversationId}/messages/${messageId}/recall`,
      {},
    ),
  forward: (conversationId: number, input: ForwardMessagesInput) =>
    post<ForwardMessagesResult>(
      `/api/conversations/${conversationId}/messages/forward`,
      input,
    ),
  deleteForMe: (conversationId: number, messageIds: number[]) =>
    post<DeleteMessagesForMeResult>(
      `/api/conversations/${conversationId}/messages/delete-for-me`,
      { messageIds },
    ).then(async (result) => {
      if (localDatabase.available()) {
        await localDatabase.removeMessagesForMe(conversationId, result.deletedMessageIds);
      }
      return result;
    }),
  read: (conversationId: number, messageId: number) =>
    post<{ messageId: number }>(`/api/conversations/${conversationId}/read`, { messageId })
      .then(async (result) => {
        if (localDatabase.available()) {
          await localDatabase.markConversationRead(conversationId);
        }
        return result;
      }),
  settings: (
    conversationId: number,
    payload: { pinned?: boolean; muted?: boolean; hidden?: boolean; clearHistory?: boolean },
  ) =>
    patch<Conversation>(`/api/conversations/${conversationId}/settings`, payload).then(async (conversation) => {
      if (payload.clearHistory && localDatabase.available()) {
        await localDatabase.clearConversationMessages(conversationId);
      }
      return cacheConversation(conversation);
    }),
  updateGroup: (
    conversationId: number,
    payload: { name: string },
  ) =>
    patch<Conversation>(`/api/conversations/${conversationId}`, payload).then(cacheConversation),
  transferOwner: (conversationId: number, userId: number) =>
    post<Conversation>(`/api/conversations/${conversationId}/owner`, { userId }).then(cacheConversation),
  dissolveGroup: (conversationId: number) =>
    remove<boolean>(`/api/conversations/${conversationId}`).then(async (result) => {
      await refreshConversationCache();
      return result;
    }),
  addMembers: (
    conversationId: number,
    userIds: number[],
    historyMessageIds: number[] = [],
  ) =>
    post<boolean>(`/api/conversations/${conversationId}/members`, {
      userIds,
      historyMessageIds,
    }).then(async (result) => {
      await get<Conversation>(`/api/conversations/${conversationId}`).then(cacheConversation);
      return result;
    }),
  removeMember: (conversationId: number, userId: number) =>
    remove<boolean>(`/api/conversations/${conversationId}/members/${userId}`).then(async (result) => {
      await refreshConversationCache();
      return result;
    }),
};
