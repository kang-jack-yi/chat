import type { Application } from "egg";
import type { Transaction } from "sequelize";

export type NotificationType = "task_assigned" | "task_completed" | "mention" | "comment" | "system";

export async function createNotification(
  app: Application,
  input: {
    companyId: number;
    recipientUserId: number;
    type: NotificationType;
    title: string;
    body: string;
    entityType: "task" | "message" | "document" | "system";
    entityId: string;
    conversationId?: number | null;
    taskId?: number | null;
    documentId?: number | null;
    payload?: unknown;
  },
  transaction?: Transaction,
) {
  return app.chatDb.Notification.create({
    companyId: input.companyId,
    recipientUserId: input.recipientUserId,
    type: input.type,
    title: input.title,
    body: input.body,
    entityType: input.entityType,
    entityId: input.entityId,
    conversationId: input.conversationId || null,
    taskId: input.taskId || null,
    documentId: input.documentId || null,
    payload: input.payload || {},
    readAt: null,
  }, { transaction });
}
