import { Service } from "egg";
import { Op, QueryTypes, type Transaction } from "sequelize";
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

interface TransactionalTaskInput {
  title: string;
  priority: TaskPriority;
  dueAt: Date | null;
  conversationId: number | null;
  messageId?: number | null;
  documentId?: number;
}

/** 与 Sequelize SQLite 模型统一使用 UTC 字符串，避免宿主时区影响 SQL 日期比较。 */
function databaseDate(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", " +00:00");
}

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
  /** 扫描已到期的未完成任务，校验负责人并持久化去重后推送通知，返回新增提醒数。 */
  public async sendDueReminders(now = new Date()) {
    const rows = await this.app.chatDb.Task.findAll({
      where: {
        status: { [Op.in]: ["todo", "in_progress"] },
        dueAt: { [Op.lte]: now },
      },
      order: [["id", "ASC"]],
    });
    let sent = 0;
    for (const candidate of rows) {
      // 扫描期间任务可能已完成、延期或转交，发送前重新读取当前状态。
      const row = await this.app.chatDb.Task.findOne({
        where: {
          id: candidate.get("id"),
          status: { [Op.in]: ["todo", "in_progress"] },
          dueAt: { [Op.lte]: now },
        },
      });
      if (!row) continue;
      const companyId = Number(row.get("companyId"));
      const assigneeId = Number(row.get("assigneeId"));
      const assignee = await this.app.chatDb.User.findOne({
        where: { id: assigneeId, companyId, status: "active" },
      });
      if (!assignee) continue;
      const id = Number(row.get("id"));
      const dueAtISO = new Date(row.get("dueAt") as Date).toISOString();
      const reminderKey = `task:${id}:${dueAtISO}:${assigneeId}`;
      if (
        await this.app.chatDb.Notification.findOne({ where: { reminderKey } })
      )
        continue;
      // 状态校验和写入使用同一条 SQLite 语句，关闭重新读取后到插入前的竞态窗口。
      // 唯一键冲突不写入也不推送；任务完成、延期、转交或停用负责人同样不写入。
      const inserted = await this.app.chatDb.sequelize.query<{ id: number }>(
        `
        WITH due_task AS (
          SELECT tasks.* FROM tasks
          JOIN users ON users.id = tasks.assignee_id AND users.company_id = tasks.company_id
          WHERE tasks.id = :id AND tasks.company_id = :companyId AND tasks.assignee_id = :assigneeId
            AND tasks.status IN ('todo', 'in_progress') AND tasks.due_at = :dueAt AND tasks.due_at <= :now
            AND users.status = 'active'
        )
        INSERT INTO notifications (
          company_id, recipient_user_id, type, title, body, entity_type, entity_id,
          conversation_id, task_id, document_id, reminder_key, payload, read_at, created_at, updated_at
        )
        SELECT tasks.company_id, tasks.assignee_id, 'task_due', '任务已到期',
          '“' || tasks.title || '”已到截止时间，请及时处理', 'task', :entityId,
          tasks.conversation_id, tasks.id, NULL, :reminderKey, :payload, NULL, :createdAt, :createdAt
        FROM due_task AS tasks WHERE 1
        ON CONFLICT(reminder_key) DO NOTHING RETURNING id
      `,
        {
          type: QueryTypes.SELECT,
          raw: true,
          replacements: {
            id,
            companyId,
            assigneeId,
            entityId: String(id),
            reminderKey,
            payload: JSON.stringify({ dueAt: dueAtISO }),
            dueAt: databaseDate(new Date(dueAtISO)),
            now: databaseDate(now),
            createdAt: databaseDate(new Date()),
          },
        },
      );
      if (!inserted.length) continue;
      sent += 1;
      this.app.io
        ?.of("/")
        ?.to(`user:${assigneeId}`)
        .emit("notification:available", {
          notificationId: Number(inserted[0].id),
        });
    }
    return sent;
  }

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

  /** 查看自己关联的任务，或当前仍可访问评审的指定审批人所批准的任务。 */
  async detail(resourceId: number) {
    const row = await this.findTask(Number(resourceId));
    if (!row) throw new ServiceError(404, "NOT_FOUND", "任务不存在");
    const userId = Number(this.ctx.currentUser.id);
    if (
      ![Number(row.get("creatorId")), Number(row.get("assigneeId"))].includes(
        userId,
      )
    ) {
      const review = await this.app.chatDb.DocumentReview.findOne({
        where: {
          companyId: this.ctx.currentUser.companyId,
          taskId: row.get("id"),
          approverId: userId,
          status: "approved",
        },
      });
      if (!review) throw new ServiceError(403, "FORBIDDEN", "无权查看该任务");
      await this.service.documentReviews.detail(Number(review.get("id")));
    }
    return serializeTask(this.app, row);
  }

  /** 已完成权限校验的业务调用在外部事务中创建任务，复用通知、群消息及同步写入。 */
  async createInTransaction(
    input: TransactionalTaskInput,
    creator: any,
    assignee: any,
    transaction: Transaction,
  ) {
    const assigneeId = Number(assignee.id);
    const row = await this.app.chatDb.Task.create(
      {
        ...input,
        companyId: creator.companyId,
        creatorId: creator.id,
        assigneeId,
      },
      { transaction },
    );
    if (input.conversationId) {
      await createSystemMessage(
        this.app,
        {
          companyId: creator.companyId,
          conversationId: input.conversationId,
          event: {
            type: "task_created",
            actor: { userId: Number(creator.id), name: String(creator.name) },
            title: input.title,
            assignee: { userId: assigneeId, name: String(assignee.name) },
          },
        },
        transaction,
      );
    }
    const notification =
      assigneeId === Number(creator.id)
        ? null
        : await createNotification(
            this.app,
            {
              companyId: creator.companyId,
              recipientUserId: assigneeId,
              type: "task_assigned",
              title: "收到一项新任务",
              body: `“${input.title}”由${String(creator.name)}分配给你`,
              entityType: "task",
              entityId: String(row.get("id")),
              conversationId: input.conversationId,
              taskId: Number(row.get("id")),
              documentId: input.documentId,
            },
            transaction,
          );
    await appendUserSyncEvent(
      this.app,
      {
        companyId: creator.companyId,
        recipientUserId: assigneeId,
        type: "task.upsert",
        entityId: String(row.get("id")),
        conversationId: input.conversationId || undefined,
        payload: { id: Number(row.get("id")) },
        version: Date.now(),
      },
      transaction,
    );
    return { row, notification };
  }

  /** 事务提交后通知负责人和关联群，避免实时消费者读到尚未落库的任务。 */
  publishCreated(result: { row: any; notification: any }) {
    const taskId = Number(result.row.get("id"));
    const assigneeId = Number(result.row.get("assigneeId"));
    const conversationId = Number(result.row.get("conversationId"));
    this.app.io
      ?.of("/")
      ?.to(`user:${assigneeId}`)
      .emit("sync:available", { taskId });
    if (conversationId)
      this.app.io
        ?.of("/")
        ?.to(`conversation:${conversationId}`)
        .emit("sync:available", { conversationId, taskId });
    if (result.notification)
      this.app.io
        ?.of("/")
        ?.to(`user:${assigneeId}`)
        .emit("notification:available", {
          notificationId: Number(result.notification.get("id")),
        });
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
      const result = await this.createInTransaction(
        { title, priority, dueAt, conversationId, messageId },
        this.ctx.currentUser,
        toPlain(assignee),
        transaction,
      );
      await transaction.commit();
      this.publishCreated(result);
      return await serializeTask(this.app, result.row);
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
