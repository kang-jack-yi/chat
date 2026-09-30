import { Controller } from "egg";
import { Op } from "sequelize";
import { fail, ok } from "../lib/auth";
import { toPlain } from "../lib/database";

function serializeNotification(row: any) {
  const notification = toPlain(row);
  return {
    id: Number(notification.id),
    type: notification.type,
    title: String(notification.title),
    body: String(notification.body || ""),
    entityType: notification.entityType,
    entityId: String(notification.entityId),
    conversationId: notification.conversationId ? Number(notification.conversationId) : null,
    taskId: notification.taskId ? Number(notification.taskId) : null,
    documentId: notification.documentId ? Number(notification.documentId) : null,
    readAt: notification.readAt ? new Date(notification.readAt).toISOString() : null,
    createdAt: new Date(notification.createdAt).toISOString(),
  };
}

export default class NotificationsController extends Controller {
  private findForUser(id: number) {
    return this.app.chatDb.Notification.findOne({
      where: {
        id,
        companyId: this.ctx.currentUser.companyId,
        recipientUserId: this.ctx.currentUser.id,
      },
    });
  }

  async list() {
    const limit = Math.min(Math.max(Number(this.ctx.query.limit) || 50, 1), 100);
    const where: any = {
      companyId: this.ctx.currentUser.companyId,
      recipientUserId: this.ctx.currentUser.id,
    };
    if (String(this.ctx.query.unreadOnly || "") === "true") where.readAt = { [Op.is]: null };
    const [rows, unreadCount] = await Promise.all([
      this.app.chatDb.Notification.findAll({ where, order: [["createdAt", "DESC"]], limit }),
      this.app.chatDb.Notification.count({
        where: {
          companyId: this.ctx.currentUser.companyId,
          recipientUserId: this.ctx.currentUser.id,
          readAt: { [Op.is]: null },
        },
      }),
    ]);
    ok(this.ctx, { items: rows.map(serializeNotification), unreadCount });
  }

  async read() {
    const row = await this.findForUser(Number(this.ctx.params.id));
    if (!row) return fail(this.ctx, 404, "NOT_FOUND", "通知不存在");
    if (!row.get("readAt")) await row.update({ readAt: new Date() });
    ok(this.ctx, serializeNotification(row));
  }

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
    ok(this.ctx, { updatedCount });
  }
}
