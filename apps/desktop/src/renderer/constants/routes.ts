export const ROUTES = {
  root: "/",
  login: "/login",
  chat: "/chat",
  chatDetail: (conversationId: number | string) => `/chat/${conversationId}`,
  contacts: "/contacts",
  contactDetail: (userId: number | string) => `/contacts/${userId}`,
  organization: "/organization",
  documents: "/documents",
} as const;
