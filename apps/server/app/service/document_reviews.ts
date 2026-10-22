import { Service } from "egg";
import { createHash } from "node:crypto";
import { Op, type Transaction } from "sequelize";
import * as Y from "yjs";
import { serializeMessage } from "../lib/chat";
import { createNotification } from "../lib/notifications";
import { appendConversationSyncEvents } from "../lib/sync";
import { ServiceError } from "../lib/service-error";
import { writeTransaction } from "../lib/write-transaction";

/** 严格校验资源标识，不允许无效输入回退为其他资源。 */
function identifier(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new ServiceError(400, "INVALID_REFERENCE", "关联标识不正确");
  return id;
}

/** 校验幂等请求标识，供客户端超时后安全重试原请求。 */
function requestKey(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 80)
    throw new ServiceError(400, "INVALID_REQUEST_KEY", "需要有效的请求标识");
  return value.trim();
}

/** 生成固定长度的内容指纹或群消息幂等标识。 */
function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export default class DocumentReviewsService extends Service {
  /** 从认证上下文重读有效身份，忽略请求体里的用户与企业字段。 */
  private async actor(transaction?: Transaction) {
    const identity = this.ctx.currentUser;
    const row =
      identity &&
      (await this.app.chatDb.User.findOne({
        where: {
          id: identity.id,
          companyId: identity.companyId,
          status: "active",
        },
        transaction,
      }));
    if (!row) throw new ServiceError(401, "UNAUTHORIZED", "登录身份不可用");
    return row.get({ plain: true });
  }

  /** 只查当前企业的评审，跨企业和不存在使用相同错误。 */
  private async findReview(
    companyId: number,
    id: number,
    transaction?: Transaction,
  ) {
    const row = await this.app.chatDb.DocumentReview.findOne({
      where: { id, companyId },
      transaction,
    });
    if (!row) throw new ServiceError(404, "REVIEW_NOT_FOUND", "评审不存在");
    return row;
  }

  /** 校验参与者仍有文档和群聊访问权，历史评审不能绕过权限撤销。 */
  private async visible(row: any, actor: any) {
    const value = row.get({ plain: true });
    if (
      ![value.submitterId, value.approverId, value.assigneeId].includes(
        actor.id,
      )
    )
      throw new ServiceError(403, "REVIEW_FORBIDDEN", "无权查看该评审");
    const [document, member, group, groupMember] = await Promise.all([
      this.app.chatDb.CloudDocument.findOne({
        where: {
          id: value.documentId,
          companyId: actor.companyId,
          trashedAt: null,
        },
      }),
      this.app.chatDb.CloudDocumentMember.findOne({
        where: { documentId: value.documentId, userId: actor.id },
      }),
      this.app.chatDb.Conversation.findOne({
        where: {
          id: value.conversationId,
          companyId: actor.companyId,
          type: "group",
        },
      }),
      this.app.chatDb.ConversationMember.findOne({
        where: {
          conversationId: value.conversationId,
          userId: actor.id,
          leftAt: null,
        },
      }),
    ]);
    if (!document || !member || !group || !groupMember)
      throw new ServiceError(
        403,
        "REVIEW_FORBIDDEN",
        "文档或群聊访问权限已变更",
      );
  }

  /** 写入前在同一事务里验证所有参与成员，关闭身份、权限与写入之间的竞态。 */
  private async targets(value: any, transaction: Transaction) {
    const db = this.app.chatDb;
    const document = await db.CloudDocument.findOne({
      where: {
        id: value.documentId,
        companyId: value.companyId,
        trashedAt: null,
      },
      transaction,
    });
    if (!document)
      throw new ServiceError(404, "DOCUMENT_NOT_FOUND", "文档不存在");
    const group = await db.Conversation.findOne({
      where: {
        id: value.conversationId,
        companyId: value.companyId,
        type: "group",
      },
      transaction,
    });
    if (!group) throw new ServiceError(403, "GROUP_FORBIDDEN", "群聊不可访问");
    const users = new Map<number, any>();
    for (const id of new Set<number>([
      value.submitterId,
      value.approverId,
      value.assigneeId,
    ])) {
      const user = await db.User.findOne({
        where: { id, companyId: value.companyId, status: "active" },
        transaction,
      });
      const member = await db.CloudDocumentMember.findOne({
        where: { documentId: value.documentId, userId: id },
        transaction,
      });
      const groupMember = await db.ConversationMember.findOne({
        where: {
          conversationId: value.conversationId,
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
        id === value.submitterId &&
        !["owner", "editor"].includes(String(member.get("permission")))
      )
        throw new ServiceError(
          403,
          "DOCUMENT_READ_ONLY",
          "只读成员不能发起评审",
        );
      users.set(id, user.get({ plain: true }));
    }
    return { document, group, users };
  }

  /** 生成公开评审摘要，不暴露请求指纹、幂等键或协作二进制内容。 */
  private async serialize(row: any, transaction?: Transaction) {
    const value = row.get({ plain: true });
    const users = await this.app.chatDb.User.findAll({
      where: {
        id: {
          [Op.in]: [value.submitterId, value.approverId, value.assigneeId],
        },
        companyId: value.companyId,
      },
      transaction,
    });
    const version = await this.app.chatDb.CloudDocumentVersion.findOne({
      where: {
        id: value.documentVersionId,
        documentId: value.documentId,
        companyId: value.companyId,
      },
      transaction,
    });
    const group = await this.app.chatDb.Conversation.findOne({
      where: { id: value.conversationId, companyId: value.companyId },
      transaction,
    });
    /** 转换参与者资料，避免返回手机号或认证字段。 */
    function member(id: number) {
      const user = users.find((item) => Number(item.get("id")) === id);
      return {
        id,
        name: String(user?.get("name") || "已停用成员"),
        avatar: String(user?.get("avatar") || ""),
      };
    }
    return {
      id: Number(value.id),
      documentId: Number(value.documentId),
      documentVersionId: Number(value.documentVersionId),
      documentTitle: String(version?.get("title") || "文档不可用"),
      conversationId: Number(value.conversationId),
      conversationName: String(group?.get("name") || "群聊不可用"),
      submitterId: Number(value.submitterId),
      approverId: Number(value.approverId),
      assigneeId: Number(value.assigneeId),
      submitter: member(value.submitterId),
      approver: member(value.approverId),
      assignee: member(value.assigneeId),
      title: String(value.title),
      dueAt: new Date(value.dueAt).toISOString(),
      status: value.status,
      taskId: value.taskId ? Number(value.taskId) : null,
      decisionComment: String(value.decisionComment || ""),
      decidedAt: value.decidedAt
        ? new Date(value.decidedAt).toISOString()
        : null,
      createdAt: new Date(value.createdAt).toISOString(),
    };
  }

  /** 给编辑者返回可发起评审的群聊，以及同时有文档权限的有效成员。 */
  async options(documentId: number) {
    const actor = await this.actor();
    const id = identifier(documentId);
    const document = await this.app.chatDb.CloudDocument.findOne({
      where: { id, companyId: actor.companyId, trashedAt: null },
    });
    const members = await this.app.chatDb.CloudDocumentMember.findAll({
      where: { documentId: id },
    });
    const own = members.find((row) => Number(row.get("userId")) === actor.id);
    if (!document || !own)
      throw new ServiceError(
        404,
        "DOCUMENT_NOT_FOUND",
        "文档不存在或你没有访问权限",
      );
    if (own.get("permission") === "viewer")
      throw new ServiceError(403, "DOCUMENT_READ_ONLY", "只读成员不能发起评审");
    const users = await this.app.chatDb.User.findAll({
      where: {
        id: { [Op.in]: members.map((row) => row.get("userId")) },
        companyId: actor.companyId,
        status: "active",
      },
    });
    const ownGroups = await this.app.chatDb.ConversationMember.findAll({
      where: { userId: actor.id, leftAt: null },
    });
    const groups = await this.app.chatDb.Conversation.findAll({
      where: {
        id: { [Op.in]: ownGroups.map((row) => row.get("conversationId")) },
        companyId: actor.companyId,
        type: "group",
      },
      order: [["id", "ASC"]],
    });
    const memberships = await this.app.chatDb.ConversationMember.findAll({
      where: {
        conversationId: { [Op.in]: groups.map((row) => row.get("id")) },
        leftAt: null,
      },
    });
    return {
      groups: groups.map((group) => ({
        id: Number(group.get("id")),
        name: String(group.get("name")),
        members: users
          .filter((user) =>
            memberships.some(
              (membership) =>
                membership.get("conversationId") === group.get("id") &&
                membership.get("userId") === user.get("id"),
            ),
          )
          .map((user) => ({
            id: Number(user.get("id")),
            name: String(user.get("name")),
            avatar: String(user.get("avatar") || ""),
          })),
      })),
    };
  }

  /** 查询当前用户可访问的待审批、我发起或全部参与记录，最多返回最近一百条。 */
  async list(query: Record<string, any>) {
    const actor = await this.actor();
    const scope = String(query.scope || "pending");
    if (!["pending", "submitted", "all"].includes(scope))
      throw new ServiceError(400, "INVALID_SCOPE", "评审范围不正确");
    const members = await this.app.chatDb.CloudDocumentMember.findAll({
      where: { userId: actor.id },
    });
    const documents = await this.app.chatDb.CloudDocument.findAll({
      where: {
        id: { [Op.in]: members.map((row) => row.get("documentId")) },
        companyId: actor.companyId,
        trashedAt: null,
      },
    });
    const memberships = await this.app.chatDb.ConversationMember.findAll({
      where: { userId: actor.id, leftAt: null },
    });
    const groups = await this.app.chatDb.Conversation.findAll({
      where: {
        id: { [Op.in]: memberships.map((row) => row.get("conversationId")) },
        companyId: actor.companyId,
        type: "group",
      },
    });
    const where: any = {
      companyId: actor.companyId,
      documentId: { [Op.in]: documents.map((row) => row.get("id")) },
      conversationId: { [Op.in]: groups.map((row) => row.get("id")) },
      ...(scope === "pending"
        ? { approverId: actor.id, status: "pending_review" }
        : scope === "submitted"
          ? { submitterId: actor.id }
          : {
              [Op.or]: [
                { submitterId: actor.id },
                { approverId: actor.id },
                { assigneeId: actor.id },
              ],
            }),
    };
    if (query.documentId) {
      const id = identifier(query.documentId);
      if (!documents.some((row) => Number(row.get("id")) === id)) return [];
      where.documentId = id;
    }
    const rows = await this.app.chatDb.DocumentReview.findAll({
      where,
      limit: 100,
      order: [["id", "DESC"]],
    });
    return Promise.all(rows.map((row) => this.serialize(row)));
  }

  /** 返回参与者可访问的详情及提交时版本预览，绝不使用后来修改的文档正文。 */
  async detail(id: number) {
    const actor = await this.actor();
    const row = await this.findReview(actor.companyId, identifier(id));
    await this.visible(row, actor);
    const result = await this.serialize(row);
    return {
      ...result,
      version: await this.service.documentVersions.preview(
        result.documentId,
        result.documentVersionId,
      ),
    };
  }

  /** 事务内保存评审快照和待办通知；相同请求标识只产生一条评审。 */
  async submit(input: Record<string, any>) {
    const key = requestKey(input.requestKey);
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const dueAt = new Date(String(input.dueAt || ""));
    if (!title || title.length > 180 || !Number.isFinite(dueAt.getTime()))
      throw new ServiceError(
        400,
        "INVALID_REVIEW",
        "需要有效标题和任务截止时间",
      );
    const result = await writeTransaction(this.app, async (transaction) => {
      const actor = await this.actor(transaction);
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
      const targets = await this.targets(value, transaction);
      const hash = digest(JSON.stringify(value));
      let row = await this.app.chatDb.DocumentReview.findOne({
        where: {
          companyId: actor.companyId,
          submitterId: actor.id,
          requestKey: key,
        },
        transaction,
      });
      if (row && row.get("requestHash") !== hash)
        throw new ServiceError(
          409,
          "REQUEST_KEY_CONFLICT",
          "相同请求标识不能提交不同内容",
        );
      let notification: any = null;
      if (!row) {
        const name = `document:${value.documentId}`;
        const instance = this.app.collaborationServer?.hocuspocus;
        if (
          this.app.documentRestores?.has(value.documentId) ||
          instance?.loadingDocuments.has(name) ||
          instance?.unloadingDocuments.has(name)
        )
          throw new ServiceError(
            409,
            "DOCUMENT_COLLABORATION_ACTIVE",
            "文档正在保存或恢复，请稍后提交评审",
          );
        const active = instance?.documents.get(name);
        const state = active
          ? Buffer.from(Y.encodeStateAsUpdate(active))
          : (targets.document.get("yjsState") as Buffer | null);
        const version = await this.service.documentVersions.saveSnapshot(
          targets.document,
          state,
          actor.id,
          "提交评审",
          transaction,
          true,
        );
        row = await this.app.chatDb.DocumentReview.create(
          {
            ...value,
            documentVersionId: version.get("id"),
            requestKey: key,
            requestHash: hash,
          },
          { transaction },
        );
        notification = await createNotification(
          this.app,
          {
            companyId: actor.companyId,
            recipientUserId: value.approverId,
            type: "system",
            title: "文档评审待审批",
            body: `${actor.name}提交了“${title}”`,
            entityType: "document_review",
            entityId: String(row.get("id")),
            documentId: value.documentId,
          },
          transaction,
        );
      }
      return { review: await this.serialize(row, transaction), notification };
    });
    this.publish(result.review, result.notification);
    return result.review;
  }

  /** 指定审批人在同一写事务内定案并创建任务，失败全部回滚，重试不重复执行。 */
  async decide(id: number, input: Record<string, any>) {
    const key = requestKey(input.requestKey);
    if (!["approve", "reject"].includes(input.decision))
      throw new ServiceError(400, "INVALID_DECISION", "审批决定不正确");
    const comment =
      typeof input.comment === "string" ? input.comment.trim() : "";
    if (
      comment.length > 500 ||
      (input.comment !== undefined && typeof input.comment !== "string")
    )
      throw new ServiceError(
        400,
        "INVALID_COMMENT",
        "审批意见不能超过 500 个字符",
      );
    const status = input.decision === "approve" ? "approved" : "rejected";
    const result = await writeTransaction(this.app, async (transaction) => {
      const actor = await this.actor(transaction);
      const row = await this.findReview(
        actor.companyId,
        identifier(id),
        transaction,
      );
      const value = row.get({ plain: true });
      if (value.approverId !== actor.id)
        throw new ServiceError(403, "NOT_APPROVER", "只有指定审批人可操作");
      const targets = await this.targets(value, transaction);
      if (value.decisionKey === key && value.decisionComment !== comment)
        throw new ServiceError(
          409,
          "REQUEST_KEY_CONFLICT",
          "相同请求标识不能提交不同审批意见",
        );
      if (value.status !== "pending_review" && value.status !== status)
        throw new ServiceError(
          409,
          "REVIEW_ALREADY_DECIDED",
          "评审已经得到另一项决定",
        );
      let task: any = null;
      let notification: any = null;
      if (value.status === "pending_review") {
        if (status === "approved") {
          task = await this.service.tasks.createInTransaction(
            {
              title: value.title,
              priority: "high",
              dueAt: new Date(value.dueAt),
              conversationId: value.conversationId,
              documentId: value.documentId,
            },
            targets.users.get(value.submitterId),
            targets.users.get(value.assigneeId),
            transaction,
          );
        }
        await row.update(
          {
            status,
            decisionKey: key,
            decisionComment: comment,
            decidedAt: new Date(),
            taskId: task ? Number(task.row.get("id")) : null,
          },
          { transaction },
        );
        notification = await createNotification(
          this.app,
          {
            companyId: value.companyId,
            recipientUserId: value.submitterId,
            type: "system",
            title: status === "approved" ? "文档评审已通过" : "文档评审已驳回",
            body: `${actor.name}${status === "approved" ? "通过" : "驳回"}了“${value.title}”${comment ? `：${comment}` : ""}`.slice(
              0,
              500,
            ),
            entityType: "document_review",
            entityId: String(value.id),
            documentId: value.documentId,
          },
          transaction,
        );
        await this.app.chatDb.Notification.update(
          { readAt: new Date() },
          {
            where: {
              companyId: value.companyId,
              recipientUserId: actor.id,
              entityType: "document_review",
              entityId: String(value.id),
              readAt: null,
            },
            transaction,
          },
        );
      }
      return {
        review: await this.serialize(row, transaction),
        task,
        notification,
      };
    });
    if (result.task) this.service.tasks.publishCreated(result.task);
    if (result.notification) this.publish(result.review, result.notification);
    return result.review;
  }

  /** 提交后向评审参与者刷新待办，并只向实际通知接收者推送通知提示。 */
  private publish(review: any, notification: any) {
    if (!notification) return;
    for (const id of new Set([
      review.submitterId,
      review.approverId,
      review.assigneeId,
    ]))
      this.app.io
        ?.of("/")
        ?.to(`user:${id}`)
        .emit("review:updated", { reviewId: review.id });
    this.app.io
      ?.of("/")
      ?.to(`user:${Number(notification.get("recipientUserId"))}`)
      .emit("notification:available", {
        notificationId: Number(notification.get("id")),
      });
  }

  /** 扫描已持久化的到期通知，群消息和投递凭据同事务写入，重启后可补投且不重复。 */
  async sendDueGroupReminders(now = new Date()) {
    const rows = await this.app.chatDb.DocumentReview.findAll({
      where: { status: "approved", taskId: { [Op.ne]: null } },
      order: [["id", "ASC"]],
    });
    let sent = 0;
    for (const candidate of rows) {
      const message = await writeTransaction(this.app, async (transaction) => {
        const db = this.app.chatDb;
        const row = await db.DocumentReview.findByPk(
          candidate.get("id") as number,
          { transaction },
        );
        if (!row || row.get("status") !== "approved") return null;
        const value = row.get({ plain: true });
        const task = await db.Task.findOne({
          where: {
            id: value.taskId,
            companyId: value.companyId,
            conversationId: value.conversationId,
            status: { [Op.in]: ["todo", "in_progress"] },
            dueAt: { [Op.lte]: now },
          },
          transaction,
        });
        if (!task) return null;
        const assigneeId = Number(task.get("assigneeId"));
        const reminderKey = `task:${value.taskId}:${new Date(task.get("dueAt") as Date).toISOString()}:${assigneeId}`;
        const reminder = await db.Notification.findOne({
          where: {
            companyId: value.companyId,
            recipientUserId: assigneeId,
            type: "task_due",
            reminderKey,
          },
          transaction,
        });
        if (
          !reminder ||
          (await db.DocumentReviewDelivery.findOne({
            where: { reviewId: value.id, reminderKey },
            transaction,
          }))
        )
          return null;
        const group = await db.Conversation.findOne({
          where: {
            id: value.conversationId,
            companyId: value.companyId,
            type: "group",
          },
          transaction,
        });
        const document = await db.CloudDocument.findOne({
          where: {
            id: value.documentId,
            companyId: value.companyId,
            trashedAt: null,
          },
          transaction,
        });
        const assignee = await db.User.findOne({
          where: {
            id: assigneeId,
            companyId: value.companyId,
            status: "active",
          },
          transaction,
        });
        const member = await db.CloudDocumentMember.findOne({
          where: { documentId: value.documentId, userId: assigneeId },
          transaction,
        });
        const groupMember = await db.ConversationMember.findOne({
          where: {
            conversationId: value.conversationId,
            userId: assigneeId,
            leftAt: null,
          },
          transaction,
        });
        if (!group || !document || !assignee || !member || !groupMember)
          return null;
        const text = `任务“${task.get("title")}”已到期，负责人：${assignee.get("name")}，请及时处理。`;
        const message = await db.Message.create(
          {
            companyId: value.companyId,
            conversationId: value.conversationId,
            senderId: 0,
            clientId: `review-due:${digest(`${value.id}:${reminderKey}`)}`,
            kind: "system",
            schemaVersion: 1,
            payloadJson: [{ type: "text", text }],
            summary: text.slice(0, 200),
            searchText: text,
            version: 1,
          },
          { transaction },
        );
        await group.update(
          {
            lastMessage: text.slice(0, 200),
            lastMessageAt: message.get("createdAt"),
          },
          { transaction },
        );
        await db.ConversationMember.update(
          { isHidden: false, hiddenAtMessageId: null },
          {
            where: { conversationId: value.conversationId, leftAt: null },
            transaction,
          },
        );
        await appendConversationSyncEvents(
          this.app,
          {
            companyId: value.companyId,
            conversationId: value.conversationId,
            type: "message.upsert",
            entityId: String(message.get("id")),
            version: 1,
            payload: await serializeMessage(this.app, message, transaction),
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
            version: Date.now(),
            payload: { id: value.conversationId },
          },
          transaction,
        );
        await db.DocumentReviewDelivery.create(
          {
            reviewId: value.id,
            reminderKey,
            messageId: Number(message.get("id")),
          },
          { transaction },
        );
        return {
          conversationId: value.conversationId,
          messageId: Number(message.get("id")),
        };
      });
      if (!message) continue;
      sent += 1;
      this.app.io
        ?.of("/")
        ?.to(`conversation:${message.conversationId}`)
        .emit("sync:available", message);
    }
    return sent;
  }
}
