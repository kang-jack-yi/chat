export const queryKeys = {
  conversations: ["conversations"] as const,
  users: ["users"] as const,
  departments: ["departments"] as const,
  documents: (view?: string, query?: string) => ["documents", view, query] as const,
  messages: (conversationId?: number) => ["messages", conversationId] as const,
  messageContext: (conversationId?: number, messageId?: number) =>
    ["message-context", conversationId, messageId] as const,
};
