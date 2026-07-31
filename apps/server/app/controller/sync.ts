import { Controller } from "egg";
import { Op } from "sequelize";
import { fail, ok, publicUser } from "../lib/auth";
import {
  membershipMessageVisibility,
  serializeMessage,
  userDeletedMessageIds,
} from "../lib/chat";
import { serializeSyncEvent } from "../lib/sync";
import { toPlain } from "../lib/database";

export default class SyncController extends Controller {
  async health() {
    const setting = await this.app.chatDb.ServerSetting.findByPk(1);
    ok(this.ctx, {
      serviceId: "enterprise-chat",
      serverId: String(setting?.get("serverId")),
      name: String(setting?.get("name") || "企业协作服务"),
      apiVersion: "1",
      socketPath: "/socket.io",
      minDesktopVersion: "1.0.0",
      features: {
        companyRegistration: process.env.CHAT_ALLOW_COMPANY_REGISTER !== "false",
        fileUpload: true,
      },
      serverTime: new Date().toISOString(),
    });
  }

  private async conversation(row: any, membership: any) {
    const conversation = toPlain(row);
    const memberships = await this.app.chatDb.ConversationMember.findAll({
      where: { conversationId: conversation.id, leftAt: null },
    });
    const userIds = memberships.map((item: any) => Number(item.get("userId")));
    const users = await this.app.chatDb.User.findAll({ where: { id: userIds } });
    const members = users.map((item: any) => publicUser(toPlain(item)));
    const other = members.find((item: any) => item.id !== this.ctx.currentUser.id);
    const lastRead = Number(membership.get("lastReadMessageId") || 0);
    const clearedAt = Number(membership.get("clearedAtMessageId") || 0);
    const historyVisibleAfter = Number(membership.get("historyVisibleAfterMessageId") || 0);
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
    const mentionMessageId = Number(membership.get("lastMentionMessageId") || 0);
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
      lastMessage: String(latestMessage?.get("summary") || ""),
      lastMessageId,
      lastMessageAt: latestMessage?.get("createdAt") || null,
      unreadCount,
      memberCount: members.length,
      members,
      pinned: Boolean(membership.get("isPinned")),
      muted: Boolean(membership.get("isMuted")),
      hidden: Boolean(membership.get("isHidden")),
      mentioned,
      mentionMessageId: mentioned ? mentionMessageId : null,
      mentionType: mentioned ? String(membership.get("lastMentionType") || "") || null : null,
    };
  }

  async bootstrap() {
    const user = this.ctx.currentUser;
    const [userRows, departmentRows, memberships, cursor] = await Promise.all([
      this.app.chatDb.User.findAll({ where: { companyId: user.companyId }, order: [["name", "ASC"]] }),
      this.app.chatDb.Department.findAll({ where: { companyId: user.companyId }, order: [["sortOrder", "ASC"], ["id", "ASC"]] }),
      this.app.chatDb.ConversationMember.findAll({ where: { userId: user.id, leftAt: null } }),
      this.app.chatDb.SyncEvent.max("id", { where: { recipientUserId: user.id } }),
    ]);
    const conversationIds = memberships.map((item: any) => Number(item.get("conversationId")));
    const conversationRows = conversationIds.length
      ? await this.app.chatDb.Conversation.findAll({
          where: { id: conversationIds, companyId: user.companyId },
          order: [["lastMessageAt", "DESC"], ["id", "DESC"]],
        })
      : [];
    const membershipMap = new Map(memberships.map((item: any) => [Number(item.get("conversationId")), item]));
    const conversations = await Promise.all(
      conversationRows.map((row: any) => this.conversation(row, membershipMap.get(Number(row.get("id"))))),
    );
    const recentMessages: any[] = [];
    for (const conversationId of conversationIds) {
      const membership = membershipMap.get(conversationId);
      const userDeletedIds = await userDeletedMessageIds(
        this.app,
        Number(user.id),
        conversationId,
      );
      const rows = await this.app.chatDb.Message.findAll({
        where: {
          conversationId,
          deletedAt: null,
          ...membershipMessageVisibility(membership),
          ...(userDeletedIds.length ? { id: { [Op.notIn]: userDeletedIds } } : {}),
        },
        order: [["id", "DESC"]],
        limit: 50,
      });
      for (const row of rows.reverse()) recentMessages.push(await serializeMessage(this.app, row));
    }
    const counts = new Map<number, number>();
    userRows.forEach((row: any) => {
      const id = Number(row.get("departmentId"));
      counts.set(id, (counts.get(id) || 0) + 1);
    });
    ok(this.ctx, {
      cursor: Number(cursor || 0),
      users: userRows.map((row: any) => publicUser(toPlain(row))),
      departments: departmentRows.map((row: any) => {
        const department = toPlain(row);
        return { ...department, memberCount: counts.get(department.id) || 0 };
      }),
      conversations,
      messages: recentMessages,
    });
  }

  async events() {
    const userId = this.ctx.currentUser.id;
    const cursor = Math.max(Number(this.ctx.query.cursor) || 0, 0);
    const limit = Math.min(Math.max(Number(this.ctx.query.limit) || 500, 1), 500);
    const minimum = Number(await this.app.chatDb.SyncEvent.min("id", { where: { recipientUserId: userId } }) || 0);
    if (cursor > 0 && minimum > 0 && cursor < minimum - 1) {
      return fail(this.ctx, 409, "SYNC_RESET_REQUIRED", "本地同步游标已过期，请重新同步历史消息");
    }
    const rows = await this.app.chatDb.SyncEvent.findAll({
      where: { recipientUserId: userId, id: { [Op.gt]: cursor } },
      order: [["id", "ASC"]],
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(serializeSyncEvent);
    ok(this.ctx, {
      events: items,
      nextCursor: items.at(-1)?.seq || cursor,
      hasMore,
    });
  }

  async status() {
    const userId = this.ctx.currentUser.id;
    const [minimum, maximum] = await Promise.all([
      this.app.chatDb.SyncEvent.min("id", { where: { recipientUserId: userId } }),
      this.app.chatDb.SyncEvent.max("id", { where: { recipientUserId: userId } }),
    ]);
    ok(this.ctx, {
      cursor: Number(maximum || 0),
      minimumCursor: Number(minimum || 0),
      maximumCursor: Number(maximum || 0),
      historyComplete: true,
      phase: "idle",
    });
  }
}
