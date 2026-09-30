import { Service } from "egg";
import { Op } from "sequelize";
import { publicUser } from "../lib/auth";
import { toPlain } from "../lib/database";
import { createSystemMessage } from "../lib/chat";
import { appendUserSyncEvent } from "../lib/sync";
import { createNotification } from "../lib/notifications";
import { ServiceError } from "../lib/service-error";

type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";

type TaskPriority = "low" | "normal" | "high" | "urgent";

const statuses: TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];

const priorities: TaskPriority[] = ["low", "normal", "high", "urgent"];

/** 生成任务创建者或负责人的公开身份数据。 */
function actor(row: any) {
  const user = publicUser(toPlain(row));
  return {
    id: Number(user.id),
    name: String(user.name),
    avatar: String(user.avatar || ""),
  };
}

/** 补齐任务关联成员并规范时间和标识字段。 */
async function serializeTask(app: any, row: any) {
  const plain = toPlain(row);
  const [creator, assignee] = await Promise.all([
    app.chatDb.User.findByPk(plain.creatorId),
    app.chatDb.User.findByPk(plain.assigneeId),
  ]);
  return {
    id: Number(plain.id),
    companyId: Number(plain.companyId),
    creatorId: Number(plain.creatorId),
    assigneeId: Number(plain.assigneeId),
    conversationId: plain.conversationId ? Number(plain.conversationId) : null,
    messageId: plain.messageId ? Number(plain.messageId) : null,
    title: String(plain.title),
    status: plain.status,
    priority: plain.priority,
    dueAt: plain.dueAt ? new Date(plain.dueAt).toISOString() : null,
    completedAt: plain.completedAt
      ? new Date(plain.completedAt).toISOString()
      : null,
    creator: creator
      ? actor(creator)
      : { id: Number(plain.creatorId), name: "未知成员", avatar: "" },
    assignee: assignee
      ? actor(assignee)
      : { id: Number(plain.assigneeId), name: "未知成员", avatar: "" },
    createdAt: new Date(plain.createdAt).toISOString(),
    updatedAt: new Date(plain.updatedAt).toISOString(),
  };
}

export default class TasksService extends Service {
  /** 仅查找当前企业内的指定任务。 */
  private async findTask(id: number) {
    return this.app.chatDb.Task.findOne({
      where: { id, companyId: this.ctx.currentUser.companyId },
    });
  }

  /** 校验当前用户仍是所关联会话的成员。 */
  private async canAccessConversation(conversationId: number) {
    return this.app.chatDb.ConversationMember.findOne({
      where: { conversationId, userId: this.ctx.currentUser.id, leftAt: null },
    });
  }

  /** 按范围和状态查询任务，并补齐创建者及负责人资料。 */
  async list(query: Record<string, any>) {
    const userId = Number(this.ctx.currentUser.id);
    const status = String(query.status || "");
    const scope = String(query.scope || "mine");
    if (status && !statuses.includes(status as TaskStatus)) {
      throw new ServiceError(400, "INVALID_STATUS", "任务状态不正确");
    }
    const where: any = { companyId: this.ctx.currentUser.companyId };
    if (scope !== "all")
      where[Op.or] = [{ creatorId: userId }, { assigneeId: userId }];
    if (status) where.status = status;
    const rows = await this.app.chatDb.Task.findAll({
      where,
      order: [
        ["status", "ASC"],
        ["dueAt", "ASC"],
        ["createdAt", "DESC"],
      ],
    });
    return await Promise.all(
      rows.map((row: any) => serializeTask(this.app, row)),
    );
  }

  /** 校验任务及关联对象，在事务中创建任务、通知和同步事件。 */
  async create(input: Record<string, any>) {
    const body = input || {};
    const title = String(body.title || "").trim();
    if (!title || title.length > 200)
      throw new ServiceError(
        400,
        "INVALID_TITLE",
        "任务标题不能为空且不能超过 200 个字符",
      );
    const priority = String(body.priority || "normal") as TaskPriority;
    if (!priorities.includes(priority))
      throw new ServiceError(400, "INVALID_PRIORITY", "任务优先级不正确");
    const assigneeId = Number(body.assigneeId || this.ctx.currentUser.id);
    const assignee = await this.app.chatDb.User.findOne({
      where: {
        id: assigneeId,
        companyId: this.ctx.currentUser.companyId,
        status: "active",
      },
    });
    if (!assignee)
      throw new ServiceError(400, "INVALID_ASSIGNEE", "负责人不存在或已停用");
    const conversationId = body.conversationId
      ? Number(body.conversationId)
      : null;
    const messageId = body.messageId ? Number(body.messageId) : null;
    if (conversationId) {
      if (
        !Number.isSafeInteger(conversationId) ||
        !(await this.canAccessConversation(conversationId))
      ) {
        throw new ServiceError(403, "FORBIDDEN", "无权关联该会话");
      }
    }
    if (
      messageId &&
      (!conversationId ||
        !(await this.app.chatDb.Message.findOne({
          where: { id: messageId, conversationId, deletedAt: null },
        })))
    ) {
      throw new ServiceError(400, "INVALID_MESSAGE", "关联消息不存在");
    }
    const dueAt = body.dueAt ? new Date(String(body.dueAt)) : null;
    if (dueAt && Number.isNaN(dueAt.getTime()))
      throw new ServiceError(400, "INVALID_DUE_AT", "截止时间不正确");
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      const row = await this.app.chatDb.Task.create(
        {
          companyId: this.ctx.currentUser.companyId,
          creatorId: this.ctx.currentUser.id,
          assigneeId,
          conversationId,
          messageId,
          title,
          priority,
          dueAt,
        },
        { transaction },
      );
      if (conversationId) {
        await createSystemMessage(
          this.app,
          {
            companyId: this.ctx.currentUser.companyId,
            conversationId,
            event: {
              type: "task_created",
              actor: {
                userId: Number(this.ctx.currentUser.id),
                name: String(this.ctx.currentUser.name),
              },
              title,
              assignee: {
                userId: Number(assignee.get("id")),
                name: String(assignee.get("name")),
              },
            },
          },
          transaction,
        );
      }
      const notification =
        assigneeId === Number(this.ctx.currentUser.id)
          ? null
          : await createNotification(
              this.app,
              {
                companyId: this.ctx.currentUser.companyId,
                recipientUserId: assigneeId,
                type: "task_assigned",
                title: "收到一项新任务",
                body: `“${title}”由${String(this.ctx.currentUser.name)}分配给你`,
                entityType: "task",
                entityId: String(row.get("id")),
                conversationId,
                taskId: Number(row.get("id")),
              },
              transaction,
            );
      await appendUserSyncEvent(
        this.app,
        {
          companyId: this.ctx.currentUser.companyId,
          recipientUserId: assigneeId,
          type: "task.upsert",
          entityId: String(row.get("id")),
          conversationId: conversationId || undefined,
          payload: { id: Number(row.get("id")) },
          version: Date.now(),
        },
        transaction,
      );
      await transaction.commit();
      this.app.io
        ?.of("/")
        ?.to(`user:${assigneeId}`)
        .emit("sync:available", { taskId: Number(row.get("id")) });
      if (notification) {
        this.app.io
          ?.of("/")
          ?.to(`user:${assigneeId}`)
          .emit("notification:available", {
            notificationId: Number(notification.get("id")),
          });
      }
      return await serializeTask(this.app, row);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /** 按创建者和负责人权限更新任务，事务内记录通知及完成系统消息。 */
  async update(resourceId: number, input: Record<string, any>) {
    const row = await this.findTask(Number(resourceId));
    if (!row) throw new ServiceError(404, "NOT_FOUND", "任务不存在");
    const currentUserId = Number(this.ctx.currentUser.id);
    if (
      ![Number(row.get("creatorId")), Number(row.get("assigneeId"))].includes(
        currentUserId,
      )
    ) {
      throw new ServiceError(403, "FORBIDDEN", "无权修改该任务");
    }
    const body = input || {};
    const previousAssigneeId = Number(row.get("assigneeId"));
    const updates: Record<string, unknown> = {};
    if (body.title !== undefined) {
      const title = String(body.title || "").trim();
      if (!title || title.length > 200)
        throw new ServiceError(
          400,
          "INVALID_TITLE",
          "任务标题不能为空且不能超过 200 个字符",
        );
      updates.title = title;
    }
    if (body.priority !== undefined) {
      if (!priorities.includes(String(body.priority) as TaskPriority))
        throw new ServiceError(400, "INVALID_PRIORITY", "任务优先级不正确");
      updates.priority = String(body.priority);
    }
    if (body.assigneeId !== undefined) {
      if (currentUserId !== Number(row.get("creatorId")))
        throw new ServiceError(
          403,
          "CREATOR_REQUIRED",
          "只有任务创建者可以更换负责人",
        );
      const assignee = await this.app.chatDb.User.findOne({
        where: {
          id: Number(body.assigneeId),
          companyId: this.ctx.currentUser.companyId,
          status: "active",
        },
      });
      if (!assignee)
        throw new ServiceError(400, "INVALID_ASSIGNEE", "负责人不存在或已停用");
      updates.assigneeId = Number(body.assigneeId);
    }
    if (body.dueAt !== undefined) {
      const dueAt = body.dueAt ? new Date(String(body.dueAt)) : null;
      if (dueAt && Number.isNaN(dueAt.getTime()))
        throw new ServiceError(400, "INVALID_DUE_AT", "截止时间不正确");
      updates.dueAt = dueAt;
    }
    const nextStatus =
      body.status === undefined
        ? String(row.get("status"))
        : (String(body.status) as TaskStatus);
    if (!statuses.includes(nextStatus as TaskStatus))
      throw new ServiceError(400, "INVALID_STATUS", "任务状态不正确");
    updates.status = nextStatus;
    if (nextStatus === "done")
      updates.completedAt = row.get("completedAt") || new Date();
    else if (String(row.get("status")) === "done") updates.completedAt = null;
    const becameDone =
      String(row.get("status")) !== "done" && nextStatus === "done";
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      await row.update(updates, { transaction });
      const conversationId = Number(row.get("conversationId") || 0);
      const notificationIds: number[] = [];
      const nextAssigneeId = Number(row.get("assigneeId"));
      if (
        nextAssigneeId !== previousAssigneeId &&
        nextAssigneeId !== currentUserId
      ) {
        const notification = await createNotification(
          this.app,
          {
            companyId: this.ctx.currentUser.companyId,
            recipientUserId: nextAssigneeId,
            type: "task_assigned",
            title: "收到一项新任务",
            body: `“${String(row.get("title"))}”由${String(this.ctx.currentUser.name)}分配给你`,
            entityType: "task",
            entityId: String(row.get("id")),
            conversationId: conversationId || null,
            taskId: Number(row.get("id")),
          },
          transaction,
        );
        notificationIds.push(Number(notification.get("id")));
      }
      if (becameDone && conversationId) {
        await createSystemMessage(
          this.app,
          {
            companyId: this.ctx.currentUser.companyId,
            conversationId,
            event: {
              type: "task_completed",
              actor: {
                userId: currentUserId,
                name: String(this.ctx.currentUser.name),
              },
              title: String(row.get("title")),
            },
          },
          transaction,
        );
      }
      if (becameDone && Number(row.get("creatorId")) !== currentUserId) {
        const notification = await createNotification(
          this.app,
          {
            companyId: this.ctx.currentUser.companyId,
            recipientUserId: Number(row.get("creatorId")),
            type: "task_completed",
            title: "任务已完成",
            body: `“${String(row.get("title"))}”已由${String(this.ctx.currentUser.name)}完成`,
            entityType: "task",
            entityId: String(row.get("id")),
            conversationId: conversationId || null,
            taskId: Number(row.get("id")),
          },
          transaction,
        );
        notificationIds.push(Number(notification.get("id")));
      }
      await appendUserSyncEvent(
        this.app,
        {
          companyId: this.ctx.currentUser.companyId,
          recipientUserId: Number(row.get("assigneeId")),
          type: "task.upsert",
          entityId: String(row.get("id")),
          conversationId: conversationId || undefined,
          payload: { id: Number(row.get("id")) },
          version: Date.now(),
        },
        transaction,
      );
      await transaction.commit();
      this.app.io
        ?.of("/")
        ?.to(`user:${Number(row.get("assigneeId"))}`)
        .emit("sync:available", { taskId: Number(row.get("id")) });
      for (const notificationId of notificationIds) {
        const notification =
          await this.app.chatDb.Notification.findByPk(notificationId);
        if (notification) {
          this.app.io
            ?.of("/")
            ?.to(`user:${Number(notification.get("recipientUserId"))}`)
            .emit("notification:available", { notificationId });
        }
      }
      return await serializeTask(this.app, row);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /** 仅允许任务创建者删除当前企业内的任务。 */
  async remove(resourceId: number) {
    const row = await this.findTask(Number(resourceId));
    if (!row) throw new ServiceError(404, "NOT_FOUND", "任务不存在");
    if (Number(row.get("creatorId")) !== Number(this.ctx.currentUser.id))
      throw new ServiceError(
        403,
        "CREATOR_REQUIRED",
        "只有任务创建者可以删除任务",
      );
    await row.destroy();
    return true;
  }
}
