import { Controller } from "egg";
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
import { fail, ok, publicUser } from "../lib/auth";
import { toPlain } from "../lib/database";
import { appendConversationSyncEvents, appendUserSyncEvent } from "../lib/sync";

export default class ChatController extends Controller {
  private updateSocketRoom(userId: number, conversationId: number, join: boolean) {
    const socketUsers: Map<string, any> | undefined = (this.app as any).socketUsers;
    const namespace: any = this.app.io?.of("/");
    if (!socketUsers || !namespace) return;
    for (const [socketId, user] of socketUsers) {
      if (Number(user.id) !== userId) continue;
      const socket = namespace.connected?.[socketId] || namespace.sockets?.get?.(socketId);
      if (join) socket?.join?.(`conversation:${conversationId}`);
      else socket?.leave?.(`conversation:${conversationId}`);
    }
  }

  private async membership(conversationId: number) {
    return this.app.chatDb.ConversationMember.findOne({
      where: { conversationId, userId: this.ctx.currentUser.id, leftAt: null },
    });
  }

  private async serializeConversation(row: any, membership: any) {
    const conversation = toPlain(row);
    const memberships = await this.app.chatDb.ConversationMember.findAll({ where: { conversationId: conversation.id, leftAt: null } });
    const ids = memberships.map((m: any) => Number(m.get("userId")));
    const users = await this.app.chatDb.User.findAll({ where: { id: ids } });
    const plainUsers = users.map((u: any) => publicUser(toPlain(u)));
    const other = plainUsers.find((u: any) => u.id !== this.ctx.currentUser.id);
    const lastRead = Number(membership?.get?.("lastReadMessageId") || membership?.lastReadMessageId || 0);
    const clearedAt = Number(membership?.get?.("clearedAtMessageId") || membership?.clearedAtMessageId || 0);
    const historyVisibleAfter = Number(
      membership?.get?.("historyVisibleAfterMessageId")
      || membership?.historyVisibleAfterMessageId
      || 0,
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
    const lastMessageId = latestMessage ? Number(latestMessage.get("id")) : null;
    const historyCleared = Boolean(lastMessageId && lastMessageId <= clearedAt);
    const mentionMessageId = Number(
      membership?.get?.("lastMentionMessageId") || membership?.lastMentionMessageId || 0,
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
    const announcementMessageId = Number(conversation.announcementMessageId || 0);
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
      announcement: conversation.type === "group" ? String(conversation.announcement || "") : "",
      announcementMessageId: announcementMessageId || null,
      announcementMessage: announcementRow
        ? await serializeMessage(this.app, announcementRow)
        : null,
      name: conversation.type === "direct" ? other?.name || "单聊" : conversation.name,
      avatar: conversation.type === "direct" ? other?.avatar || "聊" : conversation.name?.slice(0, 1) || "群",
      lastMessage: historyCleared
        ? ""
        : latestMessage?.get("kind") === "announcement"
          ? `[群公告] ${String(latestMessage.get("summary") || "")}`
          : String(latestMessage?.get("summary") || ""),
      lastMessageId,
      lastMessageAt: historyCleared ? null : latestMessage?.get("createdAt") || null,
      unreadCount,
      memberCount: plainUsers.length,
      online: conversation.type === "direct" ? onlineUsers.has(other?.id) : undefined,
      members: plainUsers,
      pinned: Boolean(membership?.get?.("isPinned") ?? membership?.isPinned),
      muted: Boolean(membership?.get?.("isMuted") ?? membership?.isMuted),
      hidden: Boolean(membership?.get?.("isHidden") ?? membership?.isHidden),
      mentioned,
      mentionMessageId: mentioned ? mentionMessageId : null,
      mentionType: mentioned
        ? String(membership?.get?.("lastMentionType") || membership?.lastMentionType || "") || null
        : null,
    };
  }

  async list() {
    const includeHidden = ["1", "true"].includes(String(this.ctx.query.includeHidden || "").toLowerCase());
    const memberships = await this.app.chatDb.ConversationMember.findAll({
      where: {
        userId: this.ctx.currentUser.id,
        leftAt: null,
        ...(includeHidden ? {} : { isHidden: false }),
      },
    });
    const ids = memberships.map((m: any) => Number(m.get("conversationId")));
    if (!ids.length) return ok(this.ctx, []);
    const rows = await this.app.chatDb.Conversation.findAll({
      where: { id: ids, companyId: this.ctx.currentUser.companyId },
      order: [["lastMessageAt", "DESC"], ["id", "DESC"]],
    });
    const memberMap = new Map(memberships.map((m: any) => [Number(m.get("conversationId")), m]));
    const conversations = await Promise.all(rows.map((row: any) => this.serializeConversation(row, memberMap.get(Number(row.get("id"))))));
    conversations.sort((left: any, right: any) =>
      Number(right.pinned) - Number(left.pinned)
      || new Date(right.lastMessageAt || 0).getTime() - new Date(left.lastMessageAt || 0).getTime());
    ok(this.ctx, conversations);
  }

  async create() {
    const { type, userId, name, memberIds = [] } = this.ctx.request.body || {};
    const current = this.ctx.currentUser;
    if (type === "direct") {
      const target = await this.app.chatDb.User.findOne({ where: { id: Number(userId), companyId: current.companyId, status: "active" } });
      if (!target || Number(userId) === current.id) return fail(this.ctx, 400, "INVALID_MEMBER", "请选择有效的企业成员");
      const pair = [current.id, Number(userId)].sort((a, b) => a - b);
      const directKey = `${current.companyId}:${pair[0]}:${pair[1]}`;
      let conversation = await this.app.chatDb.Conversation.findOne({ where: { directKey } });
      if (!conversation) {
        const transaction = await this.app.chatDb.sequelize.transaction();
        try {
          conversation = await this.app.chatDb.Conversation.create({
            companyId: current.companyId, type: "direct", name: "", createdBy: current.id, directKey,
          }, { transaction });
          for (const id of pair) {
            await this.app.chatDb.ConversationMember.create({ conversationId: conversation.get("id"), userId: id }, { transaction });
          }
          await appendConversationSyncEvents(this.app, {
            companyId: current.companyId,
            conversationId: Number(conversation.get("id")),
            type: "conversation.upsert",
            entityId: String(conversation.get("id")),
            payload: { id: Number(conversation.get("id")) },
          }, transaction);
          await transaction.commit();
          for (const id of pair) {
            this.updateSocketRoom(id, Number(conversation.get("id")), true);
            this.app.io?.of("/")?.to(`user:${id}`).emit("sync:available", {
              conversationId: Number(conversation.get("id")),
            });
          }
        } catch (error) {
          await transaction.rollback();
          throw error;
        }
      }
      const member = await this.app.chatDb.ConversationMember.findOne({ where: { conversationId: conversation.get("id"), userId: current.id } });
      return ok(this.ctx, await this.serializeConversation(conversation, member));
    }
    if (type !== "group" || !String(name || "").trim()) return fail(this.ctx, 400, "INVALID_GROUP", "请填写群聊名称");
    const uniqueIds = [...new Set([current.id, ...memberIds.map(Number)])];
    const validUsers = await this.app.chatDb.User.findAll({
      where: { id: uniqueIds, companyId: current.companyId, status: "active" },
    });
    if (validUsers.length !== uniqueIds.length || uniqueIds.length < 2) {
      return fail(this.ctx, 400, "INVALID_MEMBERS", "群成员选择不正确");
    }
    const userMap = new Map(validUsers.map((user: any) => {
      const plain = toPlain(user);
      return [Number(plain.id), plain];
    }));
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      const conversation = await this.app.chatDb.Conversation.create({
        companyId: current.companyId, type: "group", name: String(name).trim(), createdBy: current.id,
      }, { transaction });
      for (const id of uniqueIds) {
        await this.app.chatDb.ConversationMember.create({ conversationId: conversation.get("id"), userId: id }, { transaction });
      }
      await createSystemMessage(this.app, {
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
      }, transaction);
      await transaction.commit();
      for (const id of uniqueIds) {
        this.updateSocketRoom(id, Number(conversation.get("id")), true);
        this.app.io?.of("/")?.to(`user:${id}`).emit("sync:available", {
          conversationId: Number(conversation.get("id")),
        });
      }
      const member = await this.app.chatDb.ConversationMember.findOne({ where: { conversationId: conversation.get("id"), userId: current.id } });
      ok(this.ctx, await this.serializeConversation(conversation, member));
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async detail() {
    const id = Number(this.ctx.params.id);
    const member = await this.membership(id);
    const row = await this.app.chatDb.Conversation.findOne({ where: { id, companyId: this.ctx.currentUser.companyId } });
    if (!member || !row) return fail(this.ctx, 404, "NOT_FOUND", "会话不存在");
    ok(this.ctx, await this.serializeConversation(row, member));
  }

  async update() {
    const id = Number(this.ctx.params.id);
    const member = await this.membership(id);
    const row = await this.app.chatDb.Conversation.findOne({ where: { id, companyId: this.ctx.currentUser.companyId, type: "group" } });
    if (!member || !row) return fail(this.ctx, 404, "NOT_FOUND", "群聊不存在");
    const body = this.ctx.request.body || {};
    const hasName = Object.prototype.hasOwnProperty.call(body, "name");
    if (!hasName) {
      return fail(this.ctx, 400, "EMPTY_UPDATE", "没有需要更新的群资料");
    }
    const name = hasName ? String(body.name || "").trim() : String(row.get("name") || "");
    if (hasName && (!name || name.length > 80)) {
      return fail(this.ctx, 400, "INVALID_NAME", "群聊名称应为 1 至 80 个字符");
    }
    const oldName = String(row.get("name") || "");
    const nameChanged = hasName && name !== oldName;
    if (!nameChanged) {
      return ok(this.ctx, await this.serializeConversation(row, member));
    }
    const systemMessages: any[] = [];
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      await row.update({
        ...(nameChanged ? { name } : {}),
      }, { transaction });
      if (nameChanged) {
        systemMessages.push(await createSystemMessage(this.app, {
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
        }, transaction));
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    this.app.io?.of("/")?.to(`conversation:${id}`).emit("conversation:updated", {
      conversationId: id,
      ...(nameChanged ? { name } : {}),
    });
    for (const systemMessage of systemMessages) {
      this.app.io?.of("/")?.to(`conversation:${id}`).emit("message:new", systemMessage);
    }
    this.app.io?.of("/")?.to(`conversation:${id}`).emit("sync:available", { conversationId: id });
    ok(this.ctx, await this.serializeConversation(row, member));
  }

  async publishAnnouncement() {
    try {
      const conversationId = Number(this.ctx.params.id);
      const message = await createMessage(
        this.app,
        this.ctx.currentUser,
        { ...this.ctx.request.body, conversationId },
        { kind: "announcement", ownerOnly: true },
      );
      this.app.io?.of("/")?.to(`conversation:${conversationId}`).emit("message:new", message);
      this.app.io?.of("/")?.to(`conversation:${conversationId}`).emit(
        "conversation:updated",
        { conversationId },
      );
      this.app.io?.of("/")?.to(`conversation:${conversationId}`).emit(
        "sync:available",
        { conversationId },
      );
      ok(this.ctx, message);
    } catch (error: any) {
      fail(
        this.ctx,
        error.status || 400,
        error.code || "ANNOUNCEMENT_FAILED",
        error.message || "群公告发布失败",
      );
    }
  }

  async transferOwner() {
    const id = Number(this.ctx.params.id);
    const member = await this.membership(id);
    const conversation = await this.app.chatDb.Conversation.findOne({
      where: { id, companyId: this.ctx.currentUser.companyId, type: "group" },
    });
    if (!member || !conversation) return fail(this.ctx, 404, "NOT_FOUND", "群聊不存在");
    if (Number(conversation.get("createdBy")) !== Number(this.ctx.currentUser.id)) {
      return fail(this.ctx, 403, "OWNER_REQUIRED", "只有群主可以转移群主");
    }
    const userId = Number(this.ctx.request.body?.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0 || userId === Number(this.ctx.currentUser.id)) {
      return fail(this.ctx, 400, "INVALID_NEW_OWNER", "请选择新的群主");
    }
    const [targetMembership, targetUser] = await Promise.all([
      this.app.chatDb.ConversationMember.findOne({
        where: { conversationId: id, userId, leftAt: null },
      }),
      this.app.chatDb.User.findOne({
        where: { id: userId, companyId: this.ctx.currentUser.companyId, status: "active" },
      }),
    ]);
    if (!targetMembership || !targetUser) {
      return fail(this.ctx, 400, "INVALID_NEW_OWNER", "新群主必须是当前群聊中的正常成员");
    }

    let systemMessage: any;
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      await conversation.update({ createdBy: userId }, { transaction });
      systemMessage = await createSystemMessage(this.app, {
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
      }, transaction);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    this.app.io?.of("/")?.to(`conversation:${id}`).emit("conversation:updated", {
      conversationId: id,
      createdBy: userId,
    });
    this.app.io?.of("/")?.to(`conversation:${id}`).emit("message:new", systemMessage);
    this.app.io?.of("/")?.to(`conversation:${id}`).emit("sync:available", { conversationId: id });
    ok(this.ctx, await this.serializeConversation(conversation, member));
  }

  async dissolve() {
    const id = Number(this.ctx.params.id);
    const member = await this.membership(id);
    const conversation = await this.app.chatDb.Conversation.findOne({
      where: { id, companyId: this.ctx.currentUser.companyId, type: "group" },
    });
    if (!member || !conversation) return fail(this.ctx, 404, "NOT_FOUND", "群聊不存在");
    if (Number(conversation.get("createdBy")) !== Number(this.ctx.currentUser.id)) {
      return fail(this.ctx, 403, "OWNER_REQUIRED", "只有群主可以解散群聊");
    }
    const memberships = await this.app.chatDb.ConversationMember.findAll({
      where: { conversationId: id, leftAt: null },
    });
    const memberIds = memberships.map((item: any) => Number(item.get("userId")));
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      for (const membership of memberships) {
        const recipientUserId = Number(membership.get("userId"));
        await appendUserSyncEvent(this.app, {
          companyId: this.ctx.currentUser.companyId,
          recipientUserId,
          conversationId: id,
          type: "conversation.delete",
          entityId: String(id),
          version: Date.now(),
          payload: { id },
        }, transaction);
        await membership.update({ leftAt: new Date() }, { transaction });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    for (const userId of memberIds) {
      this.updateSocketRoom(userId, id, false);
      this.app.io?.of("/")?.to(`user:${userId}`).emit("sync:available", { conversationId: id });
    }
    ok(this.ctx, true);
  }

  async addMembers() {
    const id = Number(this.ctx.params.id);
    const inviterMembership = await this.membership(id);
    if (!inviterMembership) return fail(this.ctx, 403, "NOT_A_MEMBER", "你不在该会话中");
    const row = await this.app.chatDb.Conversation.findOne({ where: { id, companyId: this.ctx.currentUser.companyId, type: "group" } });
    if (!row) return fail(this.ctx, 404, "NOT_FOUND", "群聊不存在");
    const ids = [...new Set((this.ctx.request.body?.userIds || []).map(Number))] as number[];
    const requestedHistoryIds = [
      ...new Set<number>(
        (this.ctx.request.body?.historyMessageIds || [])
          .map((value: unknown) => Number(value)),
      ),
    ].filter((messageId) => Number.isSafeInteger(messageId) && messageId > 0);
    if (requestedHistoryIds.length > 30) {
      return fail(this.ctx, 400, "TOO_MANY_HISTORY_MESSAGES", "最多附带 30 条聊天记录");
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
      recentHistoryRows.map((message: any) => [Number(message.get("id")), message]),
    );
    const historyRows = requestedHistoryIds
      .map((messageId) => recentHistoryMap.get(messageId))
      .filter(Boolean);
    if (historyRows.length !== requestedHistoryIds.length) {
      return fail(this.ctx, 400, "INVALID_HISTORY_MESSAGES", "只能附带最近 30 条未撤回的普通消息");
    }
    const visibleAfterMessageId = Number(
      await this.app.chatDb.Message.max("id", { where: { conversationId: id } }) || 0,
    );
    const joinedIds: number[] = [];
    const joinedMembers: Array<{ userId: number; name: string }> = [];
    let systemMessage: any;
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      for (const userId of ids) {
        const user = await this.app.chatDb.User.findOne({
          where: { id: userId, companyId: this.ctx.currentUser.companyId, status: "active" },
          transaction,
        });
        if (user) {
          const [membership, created] = await this.app.chatDb.ConversationMember.findOrCreate({
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
            await membership.update({
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
            }, { transaction });
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
          historyRows.map((historyRow: any) => serializeMessage(this.app, historyRow)),
        );
        for (const userId of joinedIds) {
          for (const message of historyMessages) {
            await appendUserSyncEvent(this.app, {
              companyId: this.ctx.currentUser.companyId,
              recipientUserId: userId,
              conversationId: id,
              type: "message.upsert",
              entityId: String(message.id),
              version: message.version,
              payload: message,
            }, transaction);
          }
        }
      }
      if (joinedMembers.length) {
        systemMessage = await createSystemMessage(this.app, {
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
        }, transaction);
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    joinedIds.forEach((userId) => this.updateSocketRoom(userId, id, true));
    if (joinedIds.length) {
      this.app.io?.of("/")?.to(`conversation:${id}`).emit("conversation:updated", { conversationId: id });
      this.app.io?.of("/")?.to(`conversation:${id}`).emit("message:new", systemMessage);
      this.app.io?.of("/")?.to(`conversation:${id}`).emit("sync:available", { conversationId: id });
    }
    ok(this.ctx, true);
  }

  async removeMember() {
    const id = Number(this.ctx.params.id);
    const userId = Number(this.ctx.params.userId);
    if (!(await this.membership(id))) return fail(this.ctx, 403, "NOT_A_MEMBER", "你不在该会话中");
    const conversation = await this.app.chatDb.Conversation.findOne({
      where: { id, companyId: this.ctx.currentUser.companyId, type: "group" },
    });
    if (!conversation) return fail(this.ctx, 404, "NOT_FOUND", "群聊不存在");
    if (userId !== this.ctx.currentUser.id && Number(conversation.get("createdBy")) !== this.ctx.currentUser.id) {
      return fail(this.ctx, 403, "FORBIDDEN", "仅群主可以移除群成员");
    }
    if (userId === Number(conversation.get("createdBy"))) {
      return fail(this.ctx, 400, "OWNER_CANNOT_LEAVE", "群主暂不能退出群聊");
    }
    const row = await this.app.chatDb.ConversationMember.findOne({ where: { conversationId: id, userId, leftAt: null } });
    if (!row) return fail(this.ctx, 404, "NOT_FOUND", "群成员不存在");
    const targetUser = await this.app.chatDb.User.findOne({
      where: { id: userId, companyId: this.ctx.currentUser.companyId },
    });
    if (!targetUser) return fail(this.ctx, 404, "NOT_FOUND", "群成员不存在");
    let systemMessage: any;
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      await row.update({ leftAt: new Date() }, { transaction });
      await appendUserSyncEvent(this.app, {
        companyId: this.ctx.currentUser.companyId,
        recipientUserId: userId,
        conversationId: id,
        type: "conversation.delete",
        entityId: String(id),
        version: Date.now(),
        payload: { id },
      }, transaction);
      systemMessage = await createSystemMessage(this.app, {
        companyId: this.ctx.currentUser.companyId,
        conversationId: id,
        event: userId === Number(this.ctx.currentUser.id)
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
      }, transaction);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    this.updateSocketRoom(userId, id, false);
    this.app.io?.of("/")?.to(`user:${userId}`).emit("sync:available", { conversationId: id });
    this.app.io?.of("/")?.to(`conversation:${id}`).emit("conversation:updated", { conversationId: id });
    this.app.io?.of("/")?.to(`conversation:${id}`).emit("message:new", systemMessage);
    this.app.io?.of("/")?.to(`conversation:${id}`).emit("sync:available", { conversationId: id });
    ok(this.ctx, true);
  }

  async messages() {
    const id = Number(this.ctx.params.id);
    const membership = await this.membership(id);
    if (!membership) return fail(this.ctx, 403, "NOT_A_MEMBER", "你不在该会话中");
    const limit = Math.min(Math.max(Number(this.ctx.query.limit) || 30, 1), 100);
    const before = Number(this.ctx.query.beforeId || this.ctx.query.before) || Number.MAX_SAFE_INTEGER;
    const clearedAt = Number(membership.get("clearedAtMessageId") || 0);
    const keyword = String(this.ctx.query.q || "").trim().slice(0, 60);
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
        ...(userDeletedIds.length ? { id: { [Op.notIn]: userDeletedIds } } : {}),
        ...(keyword ? { searchText: { [Op.like]: `%${keyword.replace(/[%_]/g, "\\$&")}%` } } : {}),
      },
      order: [["id", "DESC"]],
      limit,
    });
    const memberships = await this.app.chatDb.ConversationMember.findAll({ where: { conversationId: id, leftAt: null } });
    const items = await Promise.all(rows.reverse().map(async (row: any) => {
      const message = await serializeMessage(this.app, row);
      const recipients = memberships.filter((item: any) => Number(item.get("userId")) !== message.senderId);
      const readCount = recipients.filter((item: any) => Number(item.get("lastReadMessageId") || 0) >= message.id).length;
      return { ...message, readCount, recipientCount: recipients.length };
    }));
    ok(this.ctx, { items, nextCursor: rows.length === limit ? rows[0]?.get("id") : null });
  }

  async forward() {
    const sourceConversationId = Number(this.ctx.params.id);
    try {
      const result = await forwardMessages(
        this.app,
        this.ctx.currentUser,
        sourceConversationId,
        this.ctx.request.body,
      );
      for (const delivery of result.deliveries) {
        for (const message of delivery.messages) {
          this.app.io?.of("/")?.to(`conversation:${delivery.conversationId}`)
            .emit("message:new", message);
        }
        this.app.io?.of("/")?.to(`conversation:${delivery.conversationId}`)
          .emit("conversation:updated", { conversationId: delivery.conversationId });
        this.app.io?.of("/")?.to(`conversation:${delivery.conversationId}`)
          .emit("sync:available", { conversationId: delivery.conversationId });
      }
      ok(this.ctx, result);
    } catch (error: any) {
      fail(
        this.ctx,
        error.status || 400,
        error.code || "FORWARD_FAILED",
        error.message || "消息转发失败",
      );
    }
  }

  async deleteForMe() {
    const conversationId = Number(this.ctx.params.id);
    const membership = await this.membership(conversationId);
    if (!membership) return fail(this.ctx, 403, "NOT_A_MEMBER", "你不在该会话中");
    const messageIds: number[] = [...new Set<number>(
      (this.ctx.request.body?.messageIds || []).map((value: unknown) => Number(value)),
    )]
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    if (!messageIds.length || messageIds.length > 30) {
      return fail(this.ctx, 400, "INVALID_MESSAGES", "请选择 1 至 30 条消息");
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
      rows.length !== messageIds.length
      || rows.some((row: any) =>
        !membershipCanAccessMessage(membership, Number(row.get("id")))
        || Number(row.get("id")) <= Number(membership.get("clearedAtMessageId") || 0))
    ) {
      return fail(this.ctx, 400, "INVALID_MESSAGES", "部分消息不存在或不可删除");
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
      await appendUserSyncEvent(this.app, {
        companyId: this.ctx.currentUser.companyId,
        recipientUserId: this.ctx.currentUser.id,
        conversationId,
        type: "message.user-delete",
        entityId: `${conversationId}:${deletedAt.getTime()}`,
        version: deletedAt.getTime(),
        payload: { conversationId, messageIds, deletedAt: deletedAt.toISOString() },
      }, transaction);
      await appendUserSyncEvent(this.app, {
        companyId: this.ctx.currentUser.companyId,
        recipientUserId: this.ctx.currentUser.id,
        conversationId,
        type: "conversation.upsert",
        entityId: String(conversationId),
        version: deletedAt.getTime(),
        payload: { id: conversationId },
      }, transaction);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    const event = { conversationId, deletedMessageIds: messageIds };
    this.app.io?.of("/")?.to(`user:${this.ctx.currentUser.id}`)
      .emit("message:removed-for-me", event);
    this.app.io?.of("/")?.to(`user:${this.ctx.currentUser.id}`)
      .emit("conversation:updated", { conversationId });
    this.app.io?.of("/")?.to(`user:${this.ctx.currentUser.id}`)
      .emit("sync:available", { conversationId });
    ok(this.ctx, event);
  }

  async recall() {
    const conversationId = Number(this.ctx.params.id);
    const messageId = Number(this.ctx.params.messageId);
    try {
      const result = await recallMessage(
        this.app,
        this.ctx.currentUser,
        conversationId,
        messageId,
      );
      const event = { conversationId, ...result };
      this.app.io?.of("/")?.to(`conversation:${conversationId}`).emit("message:recalled", event);
      this.app.io?.of("/")?.to(`conversation:${conversationId}`).emit("sync:available", {
        conversationId,
      });
      ok(this.ctx, result);
    } catch (error: any) {
      fail(
        this.ctx,
        error.status || 400,
        error.code || "RECALL_FAILED",
        error.message || "消息撤回失败",
      );
    }
  }

  async read() {
    const id = Number(this.ctx.params.id);
    const member = await this.membership(id);
    if (!member) return fail(this.ctx, 403, "NOT_A_MEMBER", "你不在该会话中");
    const messageId = Number(this.ctx.request.body?.messageId);
    if (!messageId) return fail(this.ctx, 400, "INVALID_MESSAGE", "消息位置不正确");
    const message = await this.app.chatDb.Message.findOne({ where: { id: messageId, conversationId: id } });
    if (!message) return fail(this.ctx, 400, "INVALID_MESSAGE", "消息位置不正确");
    const currentRead = Number(member.get("lastReadMessageId") || 0);
    if (messageId > currentRead) {
      const transaction = await this.app.chatDb.sequelize.transaction();
      try {
        const mentionMessageId = Number(member.get("lastMentionMessageId") || 0);
        const clearsMention = mentionMessageId > 0 && messageId >= mentionMessageId;
        await member.update({
          lastReadMessageId: messageId,
          ...(clearsMention
            ? { lastMentionMessageId: null, lastMentionType: null }
            : {}),
        }, { transaction });
        await appendConversationSyncEvents(this.app, {
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
        }, transaction);
        if (clearsMention) {
          await appendUserSyncEvent(this.app, {
            companyId: this.ctx.currentUser.companyId,
            recipientUserId: this.ctx.currentUser.id,
            conversationId: id,
            type: "conversation.upsert",
            entityId: String(id),
            version: Date.now(),
            payload: { id },
          }, transaction);
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
      this.app.io?.of("/")?.to(`conversation:${id}`).emit("sync:available", { conversationId: id });
    }
    ok(this.ctx, { messageId: Math.max(currentRead, messageId) });
  }

  async settings() {
    const id = Number(this.ctx.params.id);
    const member = await this.membership(id);
    const conversation = await this.app.chatDb.Conversation.findOne({
      where: { id, companyId: this.ctx.currentUser.companyId },
    });
    if (!member || !conversation) return fail(this.ctx, 404, "NOT_FOUND", "会话不存在");
    const { pinned, muted, hidden, clearHistory } = this.ctx.request.body || {};
    const updates: Record<string, unknown> = {};
    if (typeof pinned === "boolean") updates.isPinned = pinned;
    if (typeof muted === "boolean") updates.isMuted = muted;
    if (typeof hidden === "boolean") {
      updates.isHidden = hidden;
      updates.hiddenAtMessageId = hidden
        ? Number(await this.app.chatDb.Message.max("id", { where: { conversationId: id } }) || 0)
        : null;
    }
    if (clearHistory === true) {
      const latest = await this.app.chatDb.Message.max("id", { where: { conversationId: id } });
      const latestId = Number(latest || 0);
      updates.clearedAtMessageId = latestId;
      updates.lastReadMessageId = Math.max(Number(member.get("lastReadMessageId") || 0), latestId);
      updates.lastMentionMessageId = null;
      updates.lastMentionType = null;
    }
    if (!Object.keys(updates).length) return fail(this.ctx, 400, "INVALID_SETTINGS", "没有可更新的聊天设置");
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      await member.update(updates, { transaction });
      await appendUserSyncEvent(this.app, {
        companyId: this.ctx.currentUser.companyId,
        recipientUserId: this.ctx.currentUser.id,
        conversationId: id,
        type: "conversation.upsert",
        entityId: String(id),
        version: Date.now(),
        payload: { id },
      }, transaction);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    this.app.io?.of("/")?.to(`user:${this.ctx.currentUser.id}`).emit("conversation:updated", { conversationId: id });
    this.app.io?.of("/")?.to(`user:${this.ctx.currentUser.id}`).emit("sync:available", { conversationId: id });
    ok(this.ctx, await this.serializeConversation(conversation, member));
  }

  async send() {
    try {
      const message = await createMessage(this.app, this.ctx.currentUser, this.ctx.request.body);
      this.app.io?.of("/")?.to(`conversation:${message.conversationId}`).emit("message:new", message);
      this.app.io?.of("/")?.to(`conversation:${message.conversationId}`).emit("sync:available", {
        conversationId: message.conversationId,
      });
      ok(this.ctx, message);
    } catch (error: any) {
      fail(this.ctx, error.status || 400, error.code || "SEND_FAILED", error.message || "消息发送失败");
    }
  }
}
