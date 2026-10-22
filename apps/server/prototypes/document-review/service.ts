// PROTOTYPE：仅在临时 SQLite 中验证固定文档评审闭环，不由正式 Egg loader 加载。
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import type { Context } from "egg";
import { DataTypes, Op, Transaction } from "sequelize";
import { createNotification } from "../../app/lib/notifications";
import { createSystemMessage, serializeMessage } from "../../app/lib/chat";
import {
  appendConversationSyncEvents,
  appendUserSyncEvent,
} from "../../app/lib/sync";
import { ServiceError } from "../../app/lib/service-error";

/** 拒绝在默认业务库或任意非专用临时目录中初始化原型。 */
export function requireScratchDatabase(databasePath: string) {
  const resolved = path.resolve(databasePath);
  const directory = path.dirname(resolved);
  if (
    path.basename(resolved) !== "PROTOTYPE-wipe-me.sqlite" ||
    !path.basename(directory).startsWith("chat-workflow-PROTOTYPE-") ||
    path.dirname(directory).toLowerCase() !==
      path.resolve(os.tmpdir()).toLowerCase()
  )
    throw new Error("原型只能使用专用临时数据库");
  return resolved;
}

/** 校验客户端幂等键，不接受缺失或过长的回调标识。 */
function requestKey(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 80)
    throw new ServiceError(400, "INVALID_REQUEST_KEY", "需要有效的请求标识");
  return value.trim();
}

/** 校验引用标识，避免把无效输入转换为默认资源。 */
function identifier(value: unknown) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new ServiceError(400, "INVALID_REFERENCE", "关联标识不正确");
  return id;
}

/** 将幂等动作内容生成固定长度摘要。 */
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** 固定版本、单人审批的原型模块，数据库状态是执行进度的唯一依据。 */
export class DocumentReviewPrototypeService {
  private Review: any;
  private Delivery: any;
  private pendingWrite: Promise<void> = Promise.resolve();

  /** 接受真实 Egg 应用；正式路由和数据库模型均不做修改。 */
  constructor(private readonly app: any) {}

  /** 单进程原型按序占用 SQLite 写锁；失败仍归还执行顺序，不吞掉调用者错误。 */
  private write<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pendingWrite.then(operation);
    this.pendingWrite = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** 只在专用临时库创建两个原型模型，不执行生产库迁移。 */
  async initialize() {
    requireScratchDatabase(this.app.chatDb.sequelize.options.storage);
    const common = { timestamps: true, underscored: true };
    this.Review = this.app.chatDb.sequelize.define(
      "PrototypeDocumentReview",
      {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        companyId: { type: DataTypes.INTEGER, allowNull: false },
        documentId: { type: DataTypes.INTEGER, allowNull: false },
        conversationId: { type: DataTypes.INTEGER, allowNull: false },
        submitterId: { type: DataTypes.INTEGER, allowNull: false },
        approverId: { type: DataTypes.INTEGER, allowNull: false },
        assigneeId: { type: DataTypes.INTEGER, allowNull: false },
        title: { type: DataTypes.STRING(180), allowNull: false },
        dueAt: { type: DataTypes.DATE, allowNull: false },
        definitionVersion: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
        },
        status: {
          type: DataTypes.STRING(20),
          allowNull: false,
          defaultValue: "pending_review",
        },
        requestKey: { type: DataTypes.STRING(80), allowNull: false },
        requestHash: { type: DataTypes.STRING(64), allowNull: false },
        decisionKey: { type: DataTypes.STRING(80), allowNull: true },
        taskId: { type: DataTypes.INTEGER, allowNull: true },
      },
      {
        ...common,
        tableName: "prototype_document_reviews",
        indexes: [
          {
            unique: true,
            fields: ["company_id", "submitter_id", "request_key"],
          },
        ],
      },
    );
    this.Delivery = this.app.chatDb.sequelize.define(
      "PrototypeReviewDelivery",
      {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        reviewId: { type: DataTypes.INTEGER, allowNull: false },
        reminderKey: { type: DataTypes.STRING(160), allowNull: false },
        messageId: { type: DataTypes.INTEGER, allowNull: false },
      },
      {
        ...common,
        tableName: "prototype_review_deliveries",
        indexes: [{ unique: true, fields: ["review_id", "reminder_key"] }],
      },
    );
    await this.Review.sync();
    await this.Delivery.sync();
  }

  /** 从认证上下文重新校验活跃用户，不读取 body 中的身份或企业字段。 */
  private async actor(ctx: Context, transaction?: Transaction) {
    const identity = ctx.currentUser;
    const user =
      identity &&
      (await this.app.chatDb.User.findOne({
        where: {
          id: identity.id,
          companyId: identity.companyId,
          status: "active",
        },
        transaction,
      }));
    if (!user) throw new ServiceError(401, "UNAUTHORIZED", "登录身份不可用");
    return user.get({ plain: true });
  }

  /** 在当前企业查找实例，跨企业与不存在实例返回相同结果。 */
  private async findReview(
    companyId: number,
    id: number,
    transaction?: Transaction,
  ) {
    const review = await this.Review.findOne({
      where: { id, companyId },
      transaction,
    });
    if (!review) throw new ServiceError(404, "REVIEW_NOT_FOUND", "评审不存在");
    return review;
  }

  /** 重新校验文档、成员和群聊权限，避免引用或审批后的权限变更被绕过。 */
  private async targets(review: any, transaction: Transaction) {
    const db = this.app.chatDb;
    const document = await db.CloudDocument.findOne({
      where: {
        id: review.documentId,
        companyId: review.companyId,
        trashedAt: null,
      },
      transaction,
    });
    if (!document)
      throw new ServiceError(404, "DOCUMENT_NOT_FOUND", "文档不存在");
    const conversation = await db.Conversation.findOne({
      where: {
        id: review.conversationId,
        companyId: review.companyId,
        type: "group",
      },
      transaction,
    });
    if (!conversation)
      throw new ServiceError(403, "GROUP_FORBIDDEN", "群聊不可访问");
    const users = new Map<number, any>();
    for (const id of new Set<number>([
      review.submitterId,
      review.approverId,
      review.assigneeId,
    ])) {
      const user = await db.User.findOne({
        where: { id, companyId: review.companyId, status: "active" },
        transaction,
      });
      const member = await db.CloudDocumentMember.findOne({
        where: { documentId: review.documentId, userId: id },
        transaction,
      });
      const groupMember = await db.ConversationMember.findOne({
        where: {
          conversationId: review.conversationId,
          userId: id,
          leftAt: null,
        },
        transaction,
      });
      if (!user || !member || !groupMember)
        throw new ServiceError(
          403,
          "REVIEW_TARGET_FORBIDDEN",
          "参与成员无权访问文档或群聊",
        );
      if (
        id === review.submitterId &&
        !["owner", "editor"].includes(member.get("permission"))
      )
        throw new ServiceError(
          403,
          "DOCUMENT_READ_ONLY",
          "只读成员不能发起评审",
        );
      users.set(id, user.get({ plain: true }));
    }
    return { document, conversation, users };
  }

  /** 返回可观察的状态与投递标识，不暴露内部指纹和其他企业的实例。 */
  private async snapshot(review: any, transaction?: Transaction) {
    const value = review.get({ plain: true });
    const deliveries = await this.Delivery.findAll({
      where: { reviewId: value.id },
      transaction,
    });
    return {
      id: Number(value.id),
      companyId: Number(value.companyId),
      documentId: Number(value.documentId),
      conversationId: Number(value.conversationId),
      submitterId: Number(value.submitterId),
      approverId: Number(value.approverId),
      assigneeId: Number(value.assigneeId),
      title: value.title,
      status: value.status,
      definitionVersion: value.definitionVersion,
      taskId: value.taskId ? Number(value.taskId) : null,
      dueAt: new Date(value.dueAt).toISOString(),
      dueMessageIds: deliveries.map((item: any) =>
        Number(item.get("messageId")),
      ),
    };
  }

  /** 原型查询入口，仅允许该实例的提交者、审批人和负责人查看。 */
  async detail(ctx: Context, id: number) {
    const actor = await this.actor(ctx);
    const review = await this.findReview(actor.companyId, identifier(id));
    if (
      !["submitterId", "approverId", "assigneeId"].some(
        (key) => review.get(key) === actor.id,
      )
    )
      throw new ServiceError(403, "REVIEW_FORBIDDEN", "无权查看该评审");
    return this.snapshot(review);
  }

  /** 提交固定版本评审，同一请求重复提交不重复创建实例或审批通知。 */
  async submit(ctx: Context, input: Record<string, any>) {
    return this.write(() => this.submitReview(ctx, input));
  }

  /** 在串行写队列中校验并持久化新实例与指定审批通知。 */
  private async submitReview(ctx: Context, input: Record<string, any>) {
    const actor = await this.actor(ctx);
    const key = requestKey(input.requestKey);
    const dueAt = new Date(String(input.dueAt || ""));
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title || title.length > 180 || !Number.isFinite(dueAt.getTime()))
      throw new ServiceError(
        400,
        "INVALID_REVIEW",
        "需要有效标题和任务截止时间",
      );
    const value = {
      companyId: actor.companyId,
      submitterId: actor.id,
      documentId: identifier(input.documentId),
      conversationId: identifier(input.conversationId),
      approverId: identifier(input.approverId),
      assigneeId: identifier(input.assigneeId),
      title,
      dueAt: dueAt.toISOString(),
    };
    const hash = digest(JSON.stringify(value));
    const transaction = await this.app.chatDb.sequelize.transaction({
      type: Transaction.TYPES.IMMEDIATE,
    });
    let notificationId: number | null = null;
    try {
      await this.actor(ctx, transaction);
      await this.targets(value, transaction);
      let review = await this.Review.findOne({
        where: {
          companyId: actor.companyId,
          submitterId: actor.id,
          requestKey: key,
        },
        transaction,
      });
      if (review && review.get("requestHash") !== hash)
        throw new ServiceError(
          409,
          "REQUEST_KEY_CONFLICT",
          "相同请求标识不能提交不同内容",
        );
      if (!review) {
        review = await this.Review.create(
          { ...value, requestKey: key, requestHash: hash },
          { transaction },
        );
        const notification = await createNotification(
          this.app,
          {
            companyId: value.companyId,
            recipientUserId: value.approverId,
            type: "system",
            title: "文档评审待审批",
            body: `【工作流原型】${actor.name}提交了“${title}”`,
            entityType: "document",
            entityId: String(value.documentId),
            documentId: value.documentId,
            payload: { prototypeReviewId: Number(review.get("id")) },
          },
          transaction,
        );
        notificationId = Number(notification.get("id"));
      }
      const result = await this.snapshot(review, transaction);
      await transaction.commit();
      if (notificationId)
        this.app.io
          ?.of("/")
          ?.to(`user:${value.approverId}`)
          .emit("notification:available", { notificationId });
      return result;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /** 仅指定审批人可决定；状态变更与任务、通知、系统消息在同一事务中写入。 */
  async decide(ctx: Context, id: number, input: Record<string, any>) {
    return this.write(() => this.decideReview(ctx, id, input));
  }

  /** 在串行写队列中执行最终决定，避免并发 BEGIN 占满 SQLite 写等待。 */
  private async decideReview(
    ctx: Context,
    id: number,
    input: Record<string, any>,
  ) {
    const actor = await this.actor(ctx);
    const key = requestKey(input.requestKey);
    if (!["approve", "reject"].includes(input.decision))
      throw new ServiceError(400, "INVALID_DECISION", "审批决定不正确");
    const status = input.decision === "approve" ? "approved" : "rejected";
    const transaction = await this.app.chatDb.sequelize.transaction({
      type: Transaction.TYPES.IMMEDIATE,
    });
    let taskCreated = false;
    let assignmentNotificationId: number | null = null;
    try {
      await this.actor(ctx, transaction);
      const review = await this.findReview(
        actor.companyId,
        identifier(id),
        transaction,
      );
      const value = review.get({ plain: true });
      if (value.approverId !== actor.id)
        throw new ServiceError(403, "NOT_APPROVER", "只有指定审批人可操作");
      const targets = await this.targets(value, transaction);
      if (value.status !== "pending_review" && value.status !== status)
        throw new ServiceError(
          409,
          "REVIEW_ALREADY_DECIDED",
          "评审已经得到另一项决定",
        );
      if (value.status === "pending_review") {
        await review.update({ status, decisionKey: key }, { transaction });
        if (status === "approved") {
          const submitter = targets.users.get(value.submitterId);
          const assignee = targets.users.get(value.assigneeId);
          // 仅原型使用模型+现有领域 helper 保证原子性，不假设 TasksService.create 支持外部事务。
          const task = await this.app.chatDb.Task.create(
            {
              companyId: value.companyId,
              creatorId: value.submitterId,
              assigneeId: value.assigneeId,
              conversationId: value.conversationId,
              title: value.title,
              priority: "high",
              dueAt: value.dueAt,
            },
            { transaction },
          );
          await review.update(
            { taskId: Number(task.get("id")) },
            { transaction },
          );
          if (value.submitterId !== value.assigneeId) {
            const notification = await createNotification(
              this.app,
              {
                companyId: value.companyId,
                recipientUserId: value.assigneeId,
                type: "task_assigned",
                title: "收到一项新任务",
                body: `【工作流原型】评审通过：“${value.title}”`,
                entityType: "task",
                entityId: String(task.get("id")),
                taskId: Number(task.get("id")),
                conversationId: value.conversationId,
                documentId: value.documentId,
              },
              transaction,
            );
            assignmentNotificationId = Number(notification.get("id"));
          }
          await createSystemMessage(
            this.app,
            {
              companyId: value.companyId,
              conversationId: value.conversationId,
              event: {
                type: "task_created",
                actor: { userId: submitter.id, name: submitter.name },
                title: value.title,
                assignee: { userId: assignee.id, name: assignee.name },
              },
            },
            transaction,
          );
          await appendUserSyncEvent(
            this.app,
            {
              companyId: value.companyId,
              recipientUserId: value.assigneeId,
              type: "task.upsert",
              entityId: String(task.get("id")),
              conversationId: value.conversationId,
              payload: { id: Number(task.get("id")) },
              version: 1,
            },
            transaction,
          );
          taskCreated = true;
        }
      }
      const result = await this.snapshot(review, transaction);
      await transaction.commit();
      if (taskCreated)
        this.app.io
          ?.of("/")
          ?.to(`conversation:${result.conversationId}`)
          .emit("sync:available", {
            conversationId: result.conversationId,
            taskId: result.taskId,
          });
      if (assignmentNotificationId)
        this.app.io
          ?.of("/")
          ?.to(`user:${result.assigneeId}`)
          .emit("notification:available", {
            notificationId: assignmentNotificationId,
          });
      return result;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /** 复用真实到期扫描，并把尚未投递的提醒原子地转换为群消息及同步事件。 */
  async scan(now = new Date()) {
    return this.write(() => this.scanDueReviews(now));
  }

  /** 在串行写队列中扫描待投递动作；通知已提交而群消息未提交时可重试恢复。 */
  private async scanDueReviews(now: Date) {
    const remindersCreated = await this.app
      .createAnonymousContext()
      .service.tasks.sendDueReminders(now);
    let groupMessagesCreated = 0;
    let blocked = 0;
    const reviews = await this.Review.findAll({
      where: { status: "approved" },
      order: [["id", "ASC"]],
    });
    for (const candidate of reviews) {
      const transaction = await this.app.chatDb.sequelize.transaction({
        type: Transaction.TYPES.IMMEDIATE,
      });
      try {
        const review = await this.Review.findByPk(candidate.get("id"), {
          transaction,
        });
        const value = review.get({ plain: true });
        const task = await this.app.chatDb.Task.findOne({
          where: {
            id: value.taskId,
            companyId: value.companyId,
            status: { [Op.in]: ["todo", "in_progress"] },
            dueAt: { [Op.lte]: now },
          },
          transaction,
        });
        if (!task) {
          await transaction.commit();
          continue;
        }
        const assigneeId = Number(task.get("assigneeId"));
        const dueAt = new Date(task.get("dueAt")).toISOString();
        const reminderKey = `task:${value.taskId}:${dueAt}:${assigneeId}`;
        const targets = await this.targets(
          { ...value, assigneeId },
          transaction,
        );
        const reminder = await this.app.chatDb.Notification.findOne({
          where: {
            companyId: value.companyId,
            recipientUserId: assigneeId,
            type: "task_due",
            reminderKey,
          },
          transaction,
        });
        const delivered = await this.Delivery.findOne({
          where: { reviewId: value.id, reminderKey },
          transaction,
        });
        if (!reminder || delivered) {
          await transaction.commit();
          continue;
        }
        const assignee = targets.users.get(assigneeId);
        const text = `【工作流原型】“${task.get("title")}”已到期，负责人：${assignee.name}，请及时处理。`;
        const message = await this.app.chatDb.Message.create(
          {
            companyId: value.companyId,
            conversationId: value.conversationId,
            senderId: value.submitterId,
            clientId: `prototype-due:${digest(`${value.id}:${reminderKey}`)}`,
            kind: "user",
            schemaVersion: 1,
            payloadJson: [{ type: "text", text }],
            summary: text.slice(0, 200),
            searchText: text,
            version: 1,
          },
          { transaction },
        );
        await targets.conversation.update(
          {
            lastMessage: text.slice(0, 200),
            lastMessageAt: message.get("createdAt"),
          },
          { transaction },
        );
        await appendConversationSyncEvents(
          this.app,
          {
            companyId: value.companyId,
            conversationId: value.conversationId,
            type: "message.upsert",
            entityId: String(message.get("id")),
            payload: await serializeMessage(this.app, message, transaction),
            version: 1,
          },
          transaction,
        );
        await appendConversationSyncEvents(
          this.app,
          {
            companyId: value.companyId,
            conversationId: value.conversationId,
            type: "conversation.upsert",
            entityId: String(value.conversationId),
            payload: { id: value.conversationId },
            version: Date.now(),
          },
          transaction,
        );
        await this.Delivery.create(
          {
            reviewId: value.id,
            reminderKey,
            messageId: Number(message.get("id")),
          },
          { transaction },
        );
        await transaction.commit();
        groupMessagesCreated += 1;
        this.app.io
          ?.of("/")
          ?.to(`conversation:${value.conversationId}`)
          .emit("sync:available", {
            conversationId: value.conversationId,
            messageId: Number(message.get("id")),
          });
      } catch (error) {
        await transaction.rollback();
        if (error instanceof ServiceError) {
          blocked += 1;
          continue;
        }
        throw error;
      }
    }
    return { remindersCreated, groupMessagesCreated, blocked };
  }
}
