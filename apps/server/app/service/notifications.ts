import { Service } from "egg";
import { Op } from "sequelize";
import { toPlain } from "../lib/database";
import { ServiceError } from "../lib/service-error";

/** 生成通知摘要并规范关联标识及时间字段。 */
function serializeNotification(row: any) {
  const notification = toPlain(row);
  return {
    id: Number(notification.id),
    type: notification.type,
    title: String(notification.title),
    body: String(notification.body || ""),
    entityType: notification.entityType,
    entityId: String(notification.entityId),
    conversationId: notification.conversationId
      ? Number(notification.conversationId)
      : null,
    taskId: notification.taskId ? Number(notification.taskId) : null,
    documentId: notification.documentId
      ? Number(notification.documentId)
      : null,
    readAt: notification.readAt
      ? new Date(notification.readAt).toISOString()
      : null,
    createdAt: new Date(notification.createdAt).toISOString(),
  };
}

export default class NotificationsService extends Service {
  /** 仅查找属于当前企业和当前用户的通知。 */
  private findForUser(id: number) {
    return this.app.chatDb.Notification.findOne({
      where: {
        id,
        companyId: this.ctx.currentUser.companyId,
        recipientUserId: this.ctx.currentUser.id,
      },
    });
  }

  /** 分页查询当前用户通知并统计总未读数。 */
  async list(query: Record<string, any>) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const where: any = {
      companyId: this.ctx.currentUser.companyId,
      recipientUserId: this.ctx.currentUser.id,
    };
    if (String(query.unreadOnly || "") === "true")
      where.readAt = { [Op.is]: null };
    const [rows, unreadCount] = await Promise.all([
      this.app.chatDb.Notification.findAll({
        where,
        order: [["createdAt", "DESC"]],
        limit,
      }),
      this.app.chatDb.Notification.count({
        where: {
          companyId: this.ctx.currentUser.companyId,
          recipientUserId: this.ctx.currentUser.id,
          readAt: { [Op.is]: null },
        },
      }),
    ]);
    return { items: rows.map(serializeNotification), unreadCount };
  }

  /** 将当前用户的指定通知幂等地标记为已读。 */
  async read(resourceId: number) {
    const row = await this.findForUser(Number(resourceId));
    if (!row) throw new ServiceError(404, "NOT_FOUND", "通知不存在");
    if (!row.get("readAt")) await row.update({ readAt: new Date() });
    return serializeNotification(row);
  }

  /** 批量将当前用户尚未读取的通知标记为已读。 */
  async readAll() {
    const [updatedCount] = await this.app.chatDb.Notification.update(
      { readAt: new Date() },
      {
        where: {
          companyId: this.ctx.currentUser.companyId,
          recipientUserId: this.ctx.currentUser.id,
          readAt: { [Op.is]: null },
        },
      },
    );
    return { updatedCount };
  }
}
