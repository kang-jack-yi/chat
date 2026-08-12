import type { Conversation } from "@chat/shared";

export function clearConversationUnread(
  conversations: Conversation[] | undefined,
  conversationId: number,
) {
  if (!conversations) return conversations;
  return conversations.map((conversation) =>
    conversation.id === conversationId
      ? {
          ...conversation,
          unreadCount: 0,
          mentioned: false,
          mentionMessageId: null,
          mentionType: null,
        }
      : conversation);
}
