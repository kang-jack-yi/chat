export const queryKeys = {
  conversations: ["conversations"] as const,
  users: ["users"] as const,
  departments: ["departments"] as const,
  documents: (view?: string, query?: string) => ["documents", view, query] as const,
  documentComments: (documentId?: number) => ["document-comments", documentId] as const,
  messages: (conversationId?: number) => ["messages", conversationId] as const,
  messageReceipts: (conversationId?: number, messageId?: number) =>
    ["message-receipts", conversationId, messageId] as const,
  messageReceiptsForConversation: (conversationId?: number) =>
    ["message-receipts", conversationId] as const,
  messageContext: (conversationId?: number, messageId?: number) =>
    ["message-context", conversationId, messageId] as const,
  tasks: (status?: string) => ["tasks", status || "all"] as const,
  notifications: (unreadOnly?: boolean) => ["notifications", unreadOnly ? "unread" : "all"] as const,
};
