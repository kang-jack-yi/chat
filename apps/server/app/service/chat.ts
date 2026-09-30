import { Service } from "egg";
import { Op } from "sequelize";
import {
  createMessage,
  createSystemMessage,
  forwardMessages,
  membershipCanAccessMessage,
  membershipMessageVisibility,
  recallMessage,
  serializeMessage,
  userDeletedMessageIds,
} from "../lib/chat";
import { publicUser } from "../lib/auth";
import { toPlain } from "../lib/database";
import { appendConversationSyncEvents, appendUserSyncEvent } from "../lib/sync";
import { ServiceError } from "../lib/service-error";

export default class ChatService extends Service {
  /** 校验 Socket 登录状态，并复用 HTTP 消息发送的业务实现。 */
  async sendFromSocket(input: Record<string, any>) {
    if (!this.ctx.currentUser) {
      throw new ServiceError(401, "UNAUTHORIZED", "登录状态已失效，请重新连接");
    }
    return this.send(input);
  }

  /** 根据连接身份生成输入状态；无有效成员或会话信息时忽略该事件。 */
  typing(socketId: string, input: Record<string, any>, typing: boolean) {
    const user = (this.app as any).socketUsers?.get(socketId) || {
      id: Number(input?.userId),
      name: String(input?.name || ""),
    };
    const conversationId = Number(input?.conversationId);
    if (!conversationId || !user.id || !user.name) return;
    return { conversationId, userId: user.id, name: user.name, typing };
  }

  /** 按成员身份同步其在线连接的会话房间。 */
  private updateSocketRoom(
    userId: number,
    conversationId: number,
    join: boolean,
  ) {
    const socketUsers: Map<string, any> | undefined = (this.app as any)
      .socketUsers;
    const namespace: any = this.app.io?.of("/");
    if (!socketUsers || !namespace) return;
    for (const [socketId, user] of socketUsers) {
      if (Number(user.id) !== userId) continue;
      const socket =
        namespace.connected?.[socketId] || namespace.sockets?.get?.(socketId);
      if (join) socket?.join?.(`conversation:${conversationId}`);
      else socket?.leave?.(`conversation:${conversationId}`);
    }
  }

  /** 读取当前用户尚未退出的会话成员关系。 */
  private async membership(conversationId: number) {
    return this.app.chatDb.ConversationMember.findOne({
      where: { conversationId, userId: this.ctx.currentUser.id, leftAt: null },
    });
  }

  /** 按当前用户的历史可见范围生成会话摘要、成员及未读状态。 */
  private async serializeConversation(row: any, membership: any) {
    const conversation = toPlain(row);
    const memberships = await this.app.chatDb.ConversationMember.findAll({
      where: { conversationId: conversation.id, leftAt: null },
    });
    const ids = memberships.map((m: any) => Number(m.get("userId")));
    const users = await this.app.chatDb.User.findAll({ where: { id: ids } });
    const plainUsers = users.map((u: any) => publicUser(toPlain(u)));
    const other = plainUsers.find((u: any) => u.id !== this.ctx.currentUser.id);
    const lastRead = Number(
      membership?.get?.("lastReadMessageId") ||
        membership?.lastReadMessageId ||
        0,
    );
    const clearedAt = Number(
      membership?.get?.("clearedAtMessageId") ||
        membership?.clearedAtMessageId ||
        0,
    );
    const historyVisibleAfter = Number(
      membership?.get?.("historyVisibleAfterMessageId") ||
        membership?.historyVisibleAfterMessageId ||
        0,
    );
    const userDeletedIds = await userDeletedMessageIds(
      this.app,
      Number(this.ctx.currentUser.id),
      Number(conversation.id),
    );
    const visibleToUser = userDeletedIds.length
      ? { id: { [Op.notIn]: userDeletedIds } }
      : {};
    const latestMessage = await this.app.chatDb.Message.findOne({
      where: {
        conversationId: conversation.id,
        deletedAt: null,
        ...membershipMessageVisibility(membership),
        ...visibleToUser,
      },
      order: [["id", "DESC"]],
    });
    const lastMessageId = latestMessage
      ? Number(latestMessage.get("id"))
      : null;
    const historyCleared = Boolean(lastMessageId && lastMessageId <= clearedAt);
    const mentionMessageId = Number(
      membership?.get?.("lastMentionMessageId") ||
        membership?.lastMentionMessageId ||
        0,
    );
    const mentioned = mentionMessageId > Math.max(lastRead, clearedAt);
    const unreadCount = await this.app.chatDb.Message.count({
      where: {
        conversationId: conversation.id,
        id: { [Op.gt]: Math.max(lastRead, clearedAt, historyVisibleAfter) },
        senderId: { [Op.ne]: this.ctx.currentUser.id },
        kind: { [Op.in]: ["user", "announcement"] },
        deletedAt: null,
        ...visibleToUser,
      },
    });
    const onlineUsers: Set<number> = (this.app as any).onlineUsers || new Set();
    const announcementMessageId = Number(
      conversation.announcementMessageId || 0,
    );
    const announcementRow = announcementMessageId
      ? await this.app.chatDb.Message.findOne({
          where: {
            id: announcementMessageId,
            conversationId: conversation.id,
            kind: "announcement",
            deletedAt: null,
            ...visibleToUser,
          },
        })
      : null;
    return {
      id: conversation.id,
      type: conversation.type,
      createdBy: conversation.createdBy,
      announcement:
        conversation.type === "group"
          ? String(conversation.announcement || "")
          : "",
      announcementMessageId: announcementMessageId || null,
      announcementMessage: announcementRow
        ? await serializeMessage(this.app, announcementRow)
        : null,
      name:
        conversation.type === "direct"
          ? other?.name || "单聊"
          : conversation.name,
      avatar:
        conversation.type === "direct"
          ? other?.avatar || "聊"
          : conversation.name?.slice(0, 1) || "群",
      lastMessage: historyCleared
        ? ""
        : latestMessage?.get("kind") === "announcement"
          ? `[群公告] ${String(latestMessage.get("summary") || "")}`
          : String(latestMessage?.get("summary") || ""),
      lastMessageId,
      lastMessageAt: historyCleared
        ? null
        : latestMessage?.get("createdAt") || null,
      unreadCount,
      memberCount: plainUsers.length,
      online:
        conversation.type === "direct" ? onlineUsers.has(other?.id) : undefined,
      members: plainUsers,
      pinned: Boolean(membership?.get?.("isPinned") ?? membership?.isPinned),
      muted: Boolean(membership?.get?.("isMuted") ?? membership?.isMuted),
      hidden: Boolean(membership?.get?.("isHidden") ?? membership?.isHidden),
      mentioned,
      mentionMessageId: mentioned ? mentionMessageId : null,
      mentionType: mentioned
        ? String(
            membership?.get?.("lastMentionType") ||
              membership?.lastMentionType ||
              "",
          ) || null
        : null,
    };
  }

  /** 查询当前用户可见会话，并按置顶及最近消息排序。 */
  async list(query: Record<string, any>) {
    const includeHidden = ["1", "true"].includes(
      String(query.includeHidden || "").toLowerCase(),
    );
    const memberships = await this.app.chatDb.ConversationMember.findAll({
      where: {
        userId: this.ctx.currentUser.id,
        leftAt: null,
        ...(includeHidden ? {} : { isHidden: false }),
      },
    });
    const ids = memberships.map((m: any) => Number(m.get("conversationId")));
    if (!ids.length) return [];
    const rows = await this.app.chatDb.Conversation.findAll({
      where: { id: ids, companyId: this.ctx.currentUser.companyId },
      order: [
        ["lastMessageAt", "DESC"],
        ["id", "DESC"],
      ],
    });
    const memberMap = new Map(
      memberships.map((m: any) => [Number(m.get("conversationId")), m]),
    );
    const conversations = await Promise.all(
      rows.map((row: any) =>
        this.serializeConversation(row, memberMap.get(Number(row.get("id")))),
      ),
    );
    conversations.sort(
      (left: any, right: any) =>
        Number(right.pinned) - Number(left.pinned) ||
        new Date(right.lastMessageAt || 0).getTime() -
          new Date(left.lastMessageAt || 0).getTime(),
    );
    return conversations;
  }

  /** 创建或复用单聊，或在事务中创建群聊及成员并通知客户端。 */
  async create(input: Record<string, any>) {
    const { type, userId, name, memberIds = [] } = input || {};
    const current = this.ctx.currentUser;
    if (type === "direct") {
      const target = await this.app.chatDb.User.findOne({
        where: {
          id: Number(userId),
          companyId: current.companyId,
          status: "active",
        },
      });
      if (!target || Number(userId) === current.id)
        throw new ServiceError(400, "INVALID_MEMBER", "请选择有效的企业成员");
      const pair = [current.id, Number(userId)].sort((a, b) => a - b);
      const directKey = `${current.companyId}:${pair[0]}:${pair[1]}`;
      let conversation = await this.app.chatDb.Conversation.findOne({
        where: { directKey },
      });
      if (!conversation) {
        const transaction = await this.app.chatDb.sequelize.transaction();
        try {
          conversation = await this.app.chatDb.Conversation.create(
            {
              companyId: current.companyId,
              type: "direct",
              name: "",
              createdBy: current.id,
              directKey,
            },
            { transaction },
          );
          for (const id of pair) {
            await this.app.chatDb.ConversationMember.create(
              { conversationId: conversation.get("id"), userId: id },
              { transaction },
            );
          }
          await appendConversationSyncEvents(
            this.app,
            {
              companyId: current.companyId,
              conversationId: Number(conversation.get("id")),
              type: "conversation.upsert",
              entityId: String(conversation.get("id")),
              payload: { id: Number(conversation.get("id")) },
            },
            transaction,
          );
          await transaction.commit();
          for (const id of pair) {
            this.updateSocketRoom(id, Number(conversation.get("id")), true);
            this.app.io
              ?.of("/")
              ?.to(`user:${id}`)
              .emit("sync:available", {
                conversationId: Number(conversation.get("id")),
              });
          }
        } catch (error) {
          await transaction.rollback();
          throw error;
        }
      }
      const member = await this.app.chatDb.ConversationMember.findOne({
        where: { conversationId: conversation.get("id"), userId: current.id },
      });
      return await this.serializeConversation(conversation, member);
    }
    if (type !== "group" || !String(name || "").trim())
      throw new ServiceError(400, "INVALID_GROUP", "请填写群聊名称");
    const uniqueIds = [...new Set([current.id, ...memberIds.map(Number)])];
    const validUsers = await this.app.chatDb.User.findAll({
      where: { id: uniqueIds, companyId: current.companyId, status: "active" },
    });
    if (validUsers.length !== uniqueIds.length || uniqueIds.length < 2) {
      throw new ServiceError(400, "INVALID_MEMBERS", "群成员选择不正确");
    }
    const userMap = new Map(
      validUsers.map((user: any) => {
        const plain = toPlain(user);
        return [Number(plain.id), plain];
      }),
    );
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      const conversation = await this.app.chatDb.Conversation.create(
        {
          companyId: current.companyId,
          type: "group",
          name: String(name).trim(),
          createdBy: current.id,
        },
        { transaction },
      );
      for (const id of uniqueIds) {
        await this.app.chatDb.ConversationMember.create(
          { conversationId: conversation.get("id"), userId: id },
          { transaction },
        );
      }
      await createSystemMessage(
        this.app,
        {
          companyId: current.companyId,
          conversationId: Number(conversation.get("id")),
          event: {
            type: "group_created",
            actor: { userId: Number(current.id), name: String(current.name) },
            invitedMembers: uniqueIds
              .filter((id) => id !== Number(current.id))
              .map((id) => ({
                userId: id,
                name: String(userMap.get(id)?.name || ""),
              })),
          },
        },
        transaction,
      );
      await transaction.commit();
      for (const id of uniqueIds) {
        this.updateSocketRoom(id, Number(conversation.get("id")), true);
        this.app.io
          ?.of("/")
          ?.to(`user:${id}`)
          .emit("sync:available", {
            conversationId: Number(conversation.get("id")),
          });
      }
      const member = await this.app.chatDb.ConversationMember.findOne({
        where: { conversationId: conversation.get("id"), userId: current.id },
      });
      return await this.serializeConversation(conversation, member);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /** 校验成员身份后读取会话详情。 */
  async detail(resourceId: number) {
    const id = Number(resourceId);
    const member = await this.membership(id);
    const row = await this.app.chatDb.Conversation.findOne({
      where: { id, companyId: this.ctx.currentUser.companyId },
    });
    if (!member || !row) throw new ServiceError(404, "NOT_FOUND", "会话不存在");
    return await this.serializeConversation(row, member);
  }

  /** 校验并更新群资料，在事务中记录系统消息和同步事件。 */
  async update(resourceId: number, input: Record<string, any>) {
    const id = Number(resourceId);
    const member = await this.membership(id);
    const row = await this.app.chatDb.Conversation.findOne({
      where: { id, companyId: this.ctx.currentUser.companyId, type: "group" },
    });
    if (!member || !row) throw new ServiceError(404, "NOT_FOUND", "群聊不存在");
    const body = input || {};
    const hasName = Object.prototype.hasOwnProperty.call(body, "name");
    if (!hasName) {
      throw new ServiceError(400, "EMPTY_UPDATE", "没有需要更新的群资料");
    }
    const name = hasName
      ? String(body.name || "").trim()
      : String(row.get("name") || "");
    if (hasName && (!name || name.length > 80)) {
      throw new ServiceError(
        400,
        "INVALID_NAME",
        "群聊名称应为 1 至 80 个字符",
      );
    }
    const oldName = String(row.get("name") || "");
    const nameChanged = hasName && name !== oldName;
    if (!nameChanged) {
      return await this.serializeConversation(row, member);
    }
    const systemMessages: any[] = [];
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      await row.update(
        {
          ...(nameChanged ? { name } : {}),
        },
        { transaction },
      );
      if (nameChanged) {
        systemMessages.push(
          await createSystemMessage(
            this.app,
            {
              companyId: this.ctx.currentUser.companyId,
              conversationId: id,
              event: {
                type: "group_renamed",
                actor: {
                  userId: Number(this.ctx.currentUser.id),
                  name: String(this.ctx.currentUser.name),
                },
                oldName,
                newName: name,
              },
            },
            transaction,
          ),
        );
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    this.app.io
      ?.of("/")
      ?.to(`conversation:${id}`)
      .emit("conversation:updated", {
        conversationId: id,
        ...(nameChanged ? { name } : {}),
      });
    for (const systemMessage of systemMessages) {
      this.app.io
        ?.of("/")
        ?.to(`conversation:${id}`)
        .emit("message:new", systemMessage);
    }
    this.app.io
      ?.of("/")
      ?.to(`conversation:${id}`)
      .emit("sync:available", { conversationId: id });
    return await this.serializeConversation(row, member);
  }

  /** 校验群主权限并发布群公告，通知会话成员同步。 */
  async publishAnnouncement(resourceId: number, input: Record<string, any>) {
    try {
      const conversationId = Number(resourceId);
      const message = await createMessage(
        this.app,
        this.ctx.currentUser,
        { ...input, conversationId },
        { kind: "announcement", ownerOnly: true },
      );
      this.app.io
        ?.of("/")
        ?.to(`conversation:${conversationId}`)
        .emit("message:new", message);
      this.app.io
        ?.of("/")
        ?.to(`conversation:${conversationId}`)
        .emit("conversation:updated", { conversationId });
      this.app.io
        ?.of("/")
        ?.to(`conversation:${conversationId}`)
        .emit("sync:available", { conversationId });
      return message;
    } catch (error: any) {
      throw new ServiceError(
        error.status || 400,
        error.code || "ANNOUNCEMENT_FAILED",
        error.message || "群公告发布失败",
      );
    }
  }

  /** 仅允许群主将所有权转移给当前群内的正常成员。 */
  async transferOwner(resourceId: number, input: Record<string, any>) {
    const id = Number(resourceId);
    const member = await this.membership(id);
    const conversation = await this.app.chatDb.Conversation.findOne({
      where: { id, companyId: this.ctx.currentUser.companyId, type: "group" },
    });
    if (!member || !conversation)
      throw new ServiceError(404, "NOT_FOUND", "群聊不存在");
    if (
      Number(conversation.get("createdBy")) !== Number(this.ctx.currentUser.id)
    ) {
      throw new ServiceError(403, "OWNER_REQUIRED", "只有群主可以转移群主");
    }
    const userId = Number(input?.userId);
    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0 ||
      userId === Number(this.ctx.currentUser.id)
    ) {
      throw new ServiceError(400, "INVALID_NEW_OWNER", "请选择新的群主");
    }
    const [targetMembership, targetUser] = await Promise.all([
      this.app.chatDb.ConversationMember.findOne({
        where: { conversationId: id, userId, leftAt: null },
      }),
      this.app.chatDb.User.findOne({
        where: {
          id: userId,
          companyId: this.ctx.currentUser.companyId,
          status: "active",
        },
      }),
    ]);
    if (!targetMembership || !targetUser) {
      throw new ServiceError(
        400,
        "INVALID_NEW_OWNER",
        "新群主必须是当前群聊中的正常成员",
      );
    }

    let systemMessage: any;
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      await conversation.update({ createdBy: userId }, { transaction });
      systemMessage = await createSystemMessage(
        this.app,
        {
          companyId: this.ctx.currentUser.companyId,
          conversationId: id,
          event: {
            type: "owner_transferred",
            actor: {
              userId: Number(this.ctx.currentUser.id),
              name: String(this.ctx.currentUser.name),
            },
            newOwner: {
              userId,
              name: String(targetUser.get("name")),
            },
          },
        },
        transaction,
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    this.app.io
      ?.of("/")
      ?.to(`conversation:${id}`)
      .emit("conversation:updated", {
        conversationId: id,
        createdBy: userId,
      });
    this.app.io
      ?.of("/")
      ?.to(`conversation:${id}`)
      .emit("message:new", systemMessage);
    this.app.io
      ?.of("/")
      ?.to(`conversation:${id}`)
      .emit("sync:available", { conversationId: id });
    return await this.serializeConversation(conversation, member);
  }

  /** 仅允许群主解散群聊，事务提交后移除房间并通知成员。 */
  async dissolve(resourceId: number) {
    const id = Number(resourceId);
    const member = await this.membership(id);
    const conversation = await this.app.chatDb.Conversation.findOne({
      where: { id, companyId: this.ctx.currentUser.companyId, type: "group" },
    });
    if (!member || !conversation)
      throw new ServiceError(404, "NOT_FOUND", "群聊不存在");
    if (
      Number(conversation.get("createdBy")) !== Number(this.ctx.currentUser.id)
    ) {
      throw new ServiceError(403, "OWNER_REQUIRED", "只有群主可以解散群聊");
    }
    const memberships = await this.app.chatDb.ConversationMember.findAll({
      where: { conversationId: id, leftAt: null },
    });
    const memberIds = memberships.map((item: any) =>
      Number(item.get("userId")),
    );
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      for (const membership of memberships) {
        const recipientUserId = Number(membership.get("userId"));
        await appendUserSyncEvent(
          this.app,
          {
            companyId: this.ctx.currentUser.companyId,
            recipientUserId,
            conversationId: id,
            type: "conversation.delete",
            entityId: String(id),
            version: Date.now(),
            payload: { id },
          },
          transaction,
        );
        await membership.update({ leftAt: new Date() }, { transaction });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    for (const userId of memberIds) {
      this.updateSocketRoom(userId, id, false);
      this.app.io
        ?.of("/")
        ?.to(`user:${userId}`)
        .emit("sync:available", { conversationId: id });
    }
    return true;
  }

  /** 邀请企业成员入群，并按约定限制附带历史消息的可见范围。 */
  async addMembers(resourceId: number, input: Record<string, any>) {
    const id = Number(resourceId);
    const inviterMembership = await this.membership(id);
    if (!inviterMembership)
      throw new ServiceError(403, "NOT_A_MEMBER", "你不在该会话中");
    const row = await this.app.chatDb.Conversation.findOne({
      where: { id, companyId: this.ctx.currentUser.companyId, type: "group" },
    });
    if (!row) throw new ServiceError(404, "NOT_FOUND", "群聊不存在");
    const ids = [...new Set((input?.userIds || []).map(Number))] as number[];
    const requestedHistoryIds = [
      ...new Set<number>(
        (input?.historyMessageIds || []).map((value: unknown) => Number(value)),
      ),
    ].filter((messageId) => Number.isSafeInteger(messageId) && messageId > 0);
    if (requestedHistoryIds.length > 30) {
      throw new ServiceError(
        400,
        "TOO_MANY_HISTORY_MESSAGES",
        "最多附带 30 条聊天记录",
      );
    }
    const recentHistoryRows = requestedHistoryIds.length
      ? await this.app.chatDb.Message.findAll({
          where: {
            conversationId: id,
            companyId: this.ctx.currentUser.companyId,
            kind: "user",
            deletedAt: null,
            ...membershipMessageVisibility(inviterMembership),
          },
          order: [["id", "DESC"]],
          limit: 30,
        })
      : [];
    const recentHistoryMap = new Map(
      recentHistoryRows.map((message: any) => [
        Number(message.get("id")),
        message,
      ]),
    );
    const historyRows = requestedHistoryIds
      .map((messageId) => recentHistoryMap.get(messageId))
      .filter(Boolean);
    if (historyRows.length !== requestedHistoryIds.length) {
      throw new ServiceError(
        400,
        "INVALID_HISTORY_MESSAGES",
        "只能附带最近 30 条未撤回的普通消息",
      );
    }
    const visibleAfterMessageId = Number(
      (await this.app.chatDb.Message.max("id", {
        where: { conversationId: id },
      })) || 0,
    );
    const joinedIds: number[] = [];
    const joinedMembers: Array<{ userId: number; name: string }> = [];
    let systemMessage: any;
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      for (const userId of ids) {
        const user = await this.app.chatDb.User.findOne({
          where: {
            id: userId,
            companyId: this.ctx.currentUser.companyId,
            status: "active",
          },
          transaction,
        });
        if (user) {
          const [membership, created] =
            await this.app.chatDb.ConversationMember.findOrCreate({
              where: { conversationId: id, userId },
              defaults: {
                leftAt: null,
                joinedAt: new Date(),
                lastReadMessageId: visibleAfterMessageId || null,
                historyVisibleAfterMessageId: visibleAfterMessageId || null,
                invitedHistoryMessageIds: requestedHistoryIds,
              },
              transaction,
            });
          let joined = created;
          if (!created && membership.get("leftAt")) {
            await membership.update(
              {
                leftAt: null,
                joinedAt: new Date(),
                lastReadMessageId: visibleAfterMessageId || null,
                clearedAtMessageId: null,
                isHidden: false,
                hiddenAtMessageId: null,
                lastMentionMessageId: null,
                lastMentionType: null,
                historyVisibleAfterMessageId: visibleAfterMessageId || null,
                invitedHistoryMessageIds: requestedHistoryIds,
              },
              { transaction },
            );
            joined = true;
          }
          if (joined) {
            joinedIds.push(userId);
            joinedMembers.push({
              userId,
              name: String(user.get("name")),
            });
          }
        }
      }
      if (joinedIds.length && historyRows.length) {
        const historyMessages = await Promise.all(
          historyRows.map((historyRow: any) =>
            serializeMessage(this.app, historyRow),
          ),
        );
        for (const userId of joinedIds) {
          for (const message of historyMessages) {
            await appendUserSyncEvent(
              this.app,
              {
                companyId: this.ctx.currentUser.companyId,
                recipientUserId: userId,
                conversationId: id,
                type: "message.upsert",
                entityId: String(message.id),
                version: message.version,
                payload: message,
              },
              transaction,
            );
          }
        }
      }
      if (joinedMembers.length) {
        systemMessage = await createSystemMessage(
          this.app,
          {
            companyId: this.ctx.currentUser.companyId,
            conversationId: id,
            event: {
              type: "members_invited",
              actor: {
                userId: Number(this.ctx.currentUser.id),
                name: String(this.ctx.currentUser.name),
              },
              members: joinedMembers,
            },
          },
          transaction,
        );
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    joinedIds.forEach((userId) => this.updateSocketRoom(userId, id, true));
    if (joinedIds.length) {
      this.app.io
        ?.of("/")
        ?.to(`conversation:${id}`)
        .emit("conversation:updated", { conversationId: id });
      this.app.io
        ?.of("/")
        ?.to(`conversation:${id}`)
        .emit("message:new", systemMessage);
      this.app.io
        ?.of("/")
        ?.to(`conversation:${id}`)
        .emit("sync:available", { conversationId: id });
    }
    return true;
  }

  /** 处理成员主动退出或群主移除成员，更新历史与同步事件。 */
  async removeMember(resourceId: number, targetUserId: number) {
    const id = Number(resourceId);
    const userId = Number(targetUserId);
    if (!(await this.membership(id)))
      throw new ServiceError(403, "NOT_A_MEMBER", "你不在该会话中");
    const conversation = await this.app.chatDb.Conversation.findOne({
      where: { id, companyId: this.ctx.currentUser.companyId, type: "group" },
    });
    if (!conversation) throw new ServiceError(404, "NOT_FOUND", "群聊不存在");
    if (
      userId !== this.ctx.currentUser.id &&
      Number(conversation.get("createdBy")) !== this.ctx.currentUser.id
    ) {
      throw new ServiceError(403, "FORBIDDEN", "仅群主可以移除群成员");
    }
    if (userId === Number(conversation.get("createdBy"))) {
      throw new ServiceError(400, "OWNER_CANNOT_LEAVE", "群主暂不能退出群聊");
    }
    const row = await this.app.chatDb.ConversationMember.findOne({
      where: { conversationId: id, userId, leftAt: null },
    });
    if (!row) throw new ServiceError(404, "NOT_FOUND", "群成员不存在");
    const targetUser = await this.app.chatDb.User.findOne({
      where: { id: userId, companyId: this.ctx.currentUser.companyId },
    });
    if (!targetUser) throw new ServiceError(404, "NOT_FOUND", "群成员不存在");
    let systemMessage: any;
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      await row.update({ leftAt: new Date() }, { transaction });
      await appendUserSyncEvent(
        this.app,
        {
          companyId: this.ctx.currentUser.companyId,
          recipientUserId: userId,
          conversationId: id,
          type: "conversation.delete",
          entityId: String(id),
          version: Date.now(),
          payload: { id },
        },
        transaction,
      );
      systemMessage = await createSystemMessage(
        this.app,
        {
          companyId: this.ctx.currentUser.companyId,
          conversationId: id,
          event:
            userId === Number(this.ctx.currentUser.id)
              ? {
                  type: "member_left",
                  actor: {
                    userId,
                    name: String(targetUser.get("name")),
                  },
                }
              : {
                  type: "member_removed",
                  actor: {
                    userId: Number(this.ctx.currentUser.id),
                    name: String(this.ctx.currentUser.name),
                  },
                  member: {
                    userId,
                    name: String(targetUser.get("name")),
                  },
                },
        },
        transaction,
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    this.updateSocketRoom(userId, id, false);
    this.app.io
      ?.of("/")
      ?.to(`user:${userId}`)
      .emit("sync:available", { conversationId: id });
    this.app.io
      ?.of("/")
      ?.to(`conversation:${id}`)
      .emit("conversation:updated", { conversationId: id });
    this.app.io
      ?.of("/")
      ?.to(`conversation:${id}`)
      .emit("message:new", systemMessage);
    this.app.io
      ?.of("/")
      ?.to(`conversation:${id}`)
      .emit("sync:available", { conversationId: id });
    return true;
  }

  /** 按成员历史权限查询、搜索和分页读取消息，并计算回执数量。 */
  async messages(resourceId: number, query: Record<string, any>) {
    const id = Number(resourceId);
    const membership = await this.membership(id);
    if (!membership)
      throw new ServiceError(403, "NOT_A_MEMBER", "你不在该会话中");
    const limit = Math.min(Math.max(Number(query.limit) || 30, 1), 100);
    const before =
      Number(query.beforeId || query.before) || Number.MAX_SAFE_INTEGER;
    const clearedAt = Number(membership.get("clearedAtMessageId") || 0);
    const keyword = String(query.q || "")
      .trim()
      .slice(0, 60);
    const userDeletedIds = await userDeletedMessageIds(
      this.app,
      Number(this.ctx.currentUser.id),
      id,
    );
    const idCondition: any = { [Op.lt]: before };
    if (clearedAt) idCondition[Op.gt] = clearedAt;
    const rows = await this.app.chatDb.Message.findAll({
      where: {
        conversationId: id,
        [Op.and]: [
          { id: idCondition },
          membershipMessageVisibility(membership),
        ],
        deletedAt: null,
        ...(userDeletedIds.length
          ? { id: { [Op.notIn]: userDeletedIds } }
          : {}),
        ...(keyword
          ? {
              searchText: {
                [Op.like]: `%${keyword.replace(/[%_]/g, "\\$&")}%`,
              },
            }
          : {}),
      },
      order: [["id", "DESC"]],
      limit,
    });
    const memberships = await this.app.chatDb.ConversationMember.findAll({
      where: { conversationId: id, leftAt: null },
    });
    const items = await Promise.all(
      rows.reverse().map(async (row: any) => {
        const message = await serializeMessage(this.app, row);
        const recipients = memberships.filter(
          (item: any) => Number(item.get("userId")) !== message.senderId,
        );
        const readCount = recipients.filter(
          (item: any) =>
            Number(item.get("lastReadMessageId") || 0) >= message.id,
        ).length;
        return { ...message, readCount, recipientCount: recipients.length };
      }),
    );
    return {
      items,
      nextCursor: rows.length === limit ? rows[0]?.get("id") : null,
    };
  }

  /** 仅允许发送者查看自己消息的已读及未读成员。 */
  async messageReceipts(resourceId: number, targetMessageId: number) {
    const conversationId = Number(resourceId);
    const messageId = Number(targetMessageId);
    if (!Number.isSafeInteger(messageId) || messageId <= 0) {
      throw new ServiceError(400, "INVALID_MESSAGE", "消息参数不正确");
    }
    const membership = await this.membership(conversationId);
    if (!membership)
      throw new ServiceError(403, "NOT_A_MEMBER", "你不在该会话中");
    const message = await this.app.chatDb.Message.findOne({
      where: { id: messageId, conversationId, deletedAt: null },
    });
    if (!message)
      throw new ServiceError(404, "MESSAGE_NOT_FOUND", "消息不存在");
    if (Number(message.get("senderId")) !== Number(this.ctx.currentUser.id)) {
      throw new ServiceError(
        403,
        "RECEIPTS_FORBIDDEN",
        "只能查看自己发送消息的接收状态",
      );
    }

    const memberships = await this.app.chatDb.ConversationMember.findAll({
      where: {
        conversationId,
        leftAt: null,
        userId: { [Op.ne]: this.ctx.currentUser.id },
      },
    });
    const userIds = memberships.map((item: any) => Number(item.get("userId")));
    const users = userIds.length
      ? await this.app.chatDb.User.findAll({
          where: { id: userIds, companyId: this.ctx.currentUser.companyId },
        })
      : [];
    const userMap = new Map(
      users.map((user: any) => {
        const item = publicUser(toPlain(user));
        return [Number(item.id), item];
      }),
    );
    const receipts = memberships
      .map((item: any) => ({
        user: userMap.get(Number(item.get("userId"))),
        read: Number(item.get("lastReadMessageId") || 0) >= messageId,
      }))
      .filter((item: any) => Boolean(item.user))
      .sort((left: any, right: any) =>
        String(left.user.name).localeCompare(String(right.user.name), "zh-CN"),
      );

    return {
      messageId,
      read: receipts
        .filter((item: any) => item.read)
        .map((item: any) => item.user),
      unread: receipts
        .filter((item: any) => !item.read)
        .map((item: any) => item.user),
    };
  }

  /** 按请求幂等地转发消息，完成后推送新消息及会话更新。 */
  async forward(
    resourceId: number,
    input: Parameters<typeof forwardMessages>[3],
  ) {
    const sourceConversationId = Number(resourceId);
    try {
      const result = await forwardMessages(
        this.app,
        this.ctx.currentUser,
        sourceConversationId,
        input,
      );
      for (const delivery of result.deliveries) {
        for (const message of delivery.messages) {
          this.app.io
            ?.of("/")
            ?.to(`conversation:${delivery.conversationId}`)
            .emit("message:new", message);
        }
        this.app.io
          ?.of("/")
          ?.to(`conversation:${delivery.conversationId}`)
          .emit("conversation:updated", {
            conversationId: delivery.conversationId,
          });
        this.app.io
          ?.of("/")
          ?.to(`conversation:${delivery.conversationId}`)
          .emit("sync:available", { conversationId: delivery.conversationId });
      }
      return result;
    } catch (error: any) {
      throw new ServiceError(
        error.status || 400,
        error.code || "FORWARD_FAILED",
        error.message || "消息转发失败",
      );
    }
  }

  /** 只删除当前账号中的消息视图，不影响其他会话成员。 */
  async deleteForMe(resourceId: number, input: Record<string, any>) {
    const conversationId = Number(resourceId);
    const membership = await this.membership(conversationId);
    if (!membership)
      throw new ServiceError(403, "NOT_A_MEMBER", "你不在该会话中");
    const messageIds: number[] = [
      ...new Set<number>(
        (input?.messageIds || []).map((value: unknown) => Number(value)),
      ),
    ].filter((id) => Number.isSafeInteger(id) && id > 0);
    if (!messageIds.length || messageIds.length > 30) {
      throw new ServiceError(400, "INVALID_MESSAGES", "请选择 1 至 30 条消息");
    }
    const rows = await this.app.chatDb.Message.findAll({
      where: {
        id: { [Op.in]: messageIds },
        conversationId,
        kind: { [Op.in]: ["user", "announcement"] },
        deletedAt: null,
      },
    });
    if (
      rows.length !== messageIds.length ||
      rows.some(
        (row: any) =>
          !membershipCanAccessMessage(membership, Number(row.get("id"))) ||
          Number(row.get("id")) <=
            Number(membership.get("clearedAtMessageId") || 0),
      )
    ) {
      throw new ServiceError(
        400,
        "INVALID_MESSAGES",
        "部分消息不存在或不可删除",
      );
    }
    const deletedAt = new Date();
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      for (const messageId of messageIds) {
        await this.app.chatDb.MessageUserState.findOrCreate({
          where: { userId: this.ctx.currentUser.id, messageId },
          defaults: {
            companyId: this.ctx.currentUser.companyId,
            userId: this.ctx.currentUser.id,
            conversationId,
            messageId,
            deletedAt,
          },
          transaction,
        });
      }
      await appendUserSyncEvent(
        this.app,
        {
          companyId: this.ctx.currentUser.companyId,
          recipientUserId: this.ctx.currentUser.id,
          conversationId,
          type: "message.user-delete",
          entityId: `${conversationId}:${deletedAt.getTime()}`,
          version: deletedAt.getTime(),
          payload: {
            conversationId,
            messageIds,
            deletedAt: deletedAt.toISOString(),
          },
        },
        transaction,
      );
      await appendUserSyncEvent(
        this.app,
        {
          companyId: this.ctx.currentUser.companyId,
          recipientUserId: this.ctx.currentUser.id,
          conversationId,
          type: "conversation.upsert",
          entityId: String(conversationId),
          version: deletedAt.getTime(),
          payload: { id: conversationId },
        },
        transaction,
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    const event = { conversationId, deletedMessageIds: messageIds };
    this.app.io
      ?.of("/")
      ?.to(`user:${this.ctx.currentUser.id}`)
      .emit("message:removed-for-me", event);
    this.app.io
      ?.of("/")
      ?.to(`user:${this.ctx.currentUser.id}`)
      .emit("conversation:updated", { conversationId });
    this.app.io
      ?.of("/")
      ?.to(`user:${this.ctx.currentUser.id}`)
      .emit("sync:available", { conversationId });
    return event;
  }

  /** 按撤回权限和时限撤回消息，并推送撤回与同步事件。 */
  async recall(resourceId: number, targetMessageId: number) {
    const conversationId = Number(resourceId);
    const messageId = Number(targetMessageId);
    try {
      const result = await recallMessage(
        this.app,
        this.ctx.currentUser,
        conversationId,
        messageId,
      );
      const event = { conversationId, ...result };
      this.app.io
        ?.of("/")
        ?.to(`conversation:${conversationId}`)
        .emit("message:recalled", event);
      this.app.io
        ?.of("/")
        ?.to(`conversation:${conversationId}`)
        .emit("sync:available", {
          conversationId,
        });
      return result;
    } catch (error: any) {
      throw new ServiceError(
        error.status || 400,
        error.code || "RECALL_FAILED",
        error.message || "消息撤回失败",
      );
    }
  }

  /** 单调推进当前成员的已读位置，并按需要清除提及提醒。 */
  async read(resourceId: number, input: Record<string, any>) {
    const id = Number(resourceId);
    const member = await this.membership(id);
    if (!member) throw new ServiceError(403, "NOT_A_MEMBER", "你不在该会话中");
    const messageId = Number(input?.messageId);
    if (!messageId)
      throw new ServiceError(400, "INVALID_MESSAGE", "消息位置不正确");
    const message = await this.app.chatDb.Message.findOne({
      where: { id: messageId, conversationId: id },
    });
    if (!message)
      throw new ServiceError(400, "INVALID_MESSAGE", "消息位置不正确");
    const currentRead = Number(member.get("lastReadMessageId") || 0);
    if (messageId > currentRead) {
      const transaction = await this.app.chatDb.sequelize.transaction();
      try {
        const mentionMessageId = Number(
          member.get("lastMentionMessageId") || 0,
        );
        const clearsMention =
          mentionMessageId > 0 && messageId >= mentionMessageId;
        await member.update(
          {
            lastReadMessageId: messageId,
            ...(clearsMention
              ? { lastMentionMessageId: null, lastMentionType: null }
              : {}),
          },
          { transaction },
        );
        await appendConversationSyncEvents(
          this.app,
          {
            companyId: this.ctx.currentUser.companyId,
            conversationId: id,
            type: "read.updated",
            entityId: `${id}:${this.ctx.currentUser.id}`,
            version: messageId,
            payload: {
              conversationId: id,
              userId: this.ctx.currentUser.id,
              messageId,
            },
          },
          transaction,
        );
        if (clearsMention) {
          await appendUserSyncEvent(
            this.app,
            {
              companyId: this.ctx.currentUser.companyId,
              recipientUserId: this.ctx.currentUser.id,
              conversationId: id,
              type: "conversation.upsert",
              entityId: String(id),
              version: Date.now(),
              payload: { id },
            },
            transaction,
          );
        }
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
      this.app.io?.of("/")?.to(`conversation:${id}`).emit("message:read", {
        conversationId: id,
        userId: this.ctx.currentUser.id,
        previousMessageId: currentRead,
        messageId,
      });
      this.app.io
        ?.of("/")
        ?.to(`conversation:${id}`)
        .emit("sync:available", { conversationId: id });
    }
    return { messageId: Math.max(currentRead, messageId) };
  }

  /** 更新个人会话设置或清空本账号历史，并记录同步事件。 */
  async settings(resourceId: number, input: Record<string, any>) {
    const id = Number(resourceId);
    const member = await this.membership(id);
    const conversation = await this.app.chatDb.Conversation.findOne({
      where: { id, companyId: this.ctx.currentUser.companyId },
    });
    if (!member || !conversation)
      throw new ServiceError(404, "NOT_FOUND", "会话不存在");
    const { pinned, muted, hidden, clearHistory } = input || {};
    const updates: Record<string, unknown> = {};
    if (typeof pinned === "boolean") updates.isPinned = pinned;
    if (typeof muted === "boolean") updates.isMuted = muted;
    if (typeof hidden === "boolean") {
      updates.isHidden = hidden;
      updates.hiddenAtMessageId = hidden
        ? Number(
            (await this.app.chatDb.Message.max("id", {
              where: { conversationId: id },
            })) || 0,
          )
        : null;
    }
    if (clearHistory === true) {
      const latest = await this.app.chatDb.Message.max("id", {
        where: { conversationId: id },
      });
      const latestId = Number(latest || 0);
      updates.clearedAtMessageId = latestId;
      updates.lastReadMessageId = Math.max(
        Number(member.get("lastReadMessageId") || 0),
        latestId,
      );
      updates.lastMentionMessageId = null;
      updates.lastMentionType = null;
    }
    if (!Object.keys(updates).length)
      throw new ServiceError(400, "INVALID_SETTINGS", "没有可更新的聊天设置");
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      await member.update(updates, { transaction });
      await appendUserSyncEvent(
        this.app,
        {
          companyId: this.ctx.currentUser.companyId,
          recipientUserId: this.ctx.currentUser.id,
          conversationId: id,
          type: "conversation.upsert",
          entityId: String(id),
          version: Date.now(),
          payload: { id },
        },
        transaction,
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    this.app.io
      ?.of("/")
      ?.to(`user:${this.ctx.currentUser.id}`)
      .emit("conversation:updated", { conversationId: id });
    this.app.io
      ?.of("/")
      ?.to(`user:${this.ctx.currentUser.id}`)
      .emit("sync:available", { conversationId: id });
    return await this.serializeConversation(conversation, member);
  }

  /** 校验并保存消息，向会话成员推送新消息与同步通知。 */
  async send(input: Record<string, any>) {
    try {
      const message = await createMessage(
        this.app,
        this.ctx.currentUser,
        input,
      );
      this.app.io
        ?.of("/")
        ?.to(`conversation:${message.conversationId}`)
        .emit("message:new", message);
      this.app.io
        ?.of("/")
        ?.to(`conversation:${message.conversationId}`)
        .emit("sync:available", {
          conversationId: message.conversationId,
        });
      return message;
    } catch (error: any) {
      throw new ServiceError(
        error.status || 400,
        error.code || "SEND_FAILED",
        error.message || "消息发送失败",
      );
    }
  }
}
