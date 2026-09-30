import type { Notification, NotificationPage } from "@chat/shared";
import { get, post } from "./request";

export const notificationsService = {
  list: (unreadOnly = false) => get<NotificationPage>("/api/notifications", {
    params: { limit: 100, ...(unreadOnly ? { unreadOnly: true } : {}) },
  }),
  read: (id: number) => post<Notification>(`/api/notifications/${id}/read`),
  readAll: () => post<{ updatedCount: number }>("/api/notifications/read-all"),
};
