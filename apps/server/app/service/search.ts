import { Service } from "egg";
import { Op } from "sequelize";
import { documentText } from "../lib/document-content";
import { membershipCanAccessMessage, userDeletedMessageIds } from "../lib/chat";
import { ServiceError } from "../lib/service-error";

type SearchType = "message" | "document" | "member" | "task" | "notification";
interface SearchHit {
  type: SearchType;
  id: number;
  title: string;
  snippet: string;
  updatedAt: string;
  conversationId?: number;
  messageId?: number;
  documentId?: number;
  userId?: number;
  taskId?: number;
  notificationId?: number;
}
const searchTypes = new Set<SearchType>([
  "message",
  "document",
  "member",
  "task",
  "notification",
]);

/** 截取命中位置附近的纯文本，避免全文过长和渲染原始 HTML。 */
function snippet(text: string, keyword: string): string {
  const position = text.toLocaleLowerCase().indexOf(keyword);
  const start = Math.max(0, position - 45);
  return `${start ? "…" : ""}${text.slice(start, start + 180)}${text.length > start + 180 ? "…" : ""}`;
}

export default class SearchService extends Service {
  /** 在当前用户可见范围内搜索五类内容，按时间稳定排序并分页。 */
  async search(query: Record<string, any>) {
    const keyword = String(query.q || "")
      .trim()
      .toLocaleLowerCase();
    const type = String(query.type || "all");
    if (type !== "all" && !searchTypes.has(type as SearchType))
      throw new ServiceError(400, "INVALID_SEARCH_TYPE", "搜索类型不正确");
    if (keyword.length > 120)
      throw new ServiceError(
        400,
        "INVALID_SEARCH_QUERY",
        "搜索关键词不能超过 120 个字符",
      );
    const rawLimit = Number(query.limit);
    const rawOffset = Number(query.offset);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit) || 20, 1), 100)
      : 20;
    const offset = Number.isFinite(rawOffset)
      ? Math.max(Math.floor(rawOffset), 0)
      : 0;
    if (!keyword) return { items: [], total: 0, hasMore: false };
    const { companyId, id: userId } = this.ctx.currentUser;
    const hits: SearchHit[] = [];
    /** 只添加实际命中的记录，统一摘要与时间格式。 */
    const add = (
      kind: SearchType,
      row: any,
      title: string,
      text: string,
      target: Partial<SearchHit>,
    ) => {
      if (!`${title}\n${text}`.toLocaleLowerCase().includes(keyword)) return;
      hits.push({
        type: kind,
        id: Number(row.get("id")),
        title,
        snippet: snippet(text || title, keyword),
        updatedAt: new Date(
          row.get("updatedAt") || row.get("createdAt"),
        ).toISOString(),
        ...target,
      });
    };
    if (type === "all" || type === "message") {
      const memberships = await this.app.chatDb.ConversationMember.findAll({
        where: { userId, leftAt: null },
      });
      const conversations = await this.app.chatDb.Conversation.findAll({
        where: { companyId },
      });
      const names = new Map<number, string>(
        conversations.map((row: any) => [
          Number(row.get("id")),
          String(row.get("name") || "会话"),
        ]),
      );
      for (const member of memberships) {
        const conversationId = Number(member.get("conversationId"));
        if (!names.has(conversationId)) continue;
        const deletedIds = new Set(
          await userDeletedMessageIds(this.app, userId, conversationId),
        );
        const rows = await this.app.chatDb.Message.findAll({
          where: { companyId, conversationId, deletedAt: null },
        });
        for (const row of rows) {
          const id = Number(row.get("id"));
          if (
            deletedIds.has(id) ||
            !membershipCanAccessMessage(member, id) ||
            id <= Number(member.get("clearedAtMessageId") || 0)
          )
            continue;
          add(
            "message",
            row,
            `${row.get("senderName") || "成员"} · ${names.get(conversationId)}`,
            String(row.get("searchText") || row.get("summary") || ""),
            { conversationId, messageId: id },
          );
        }
      }
    }
    if (type === "all" || type === "document") {
      const memberships = await this.app.chatDb.CloudDocumentMember.findAll({
        where: { userId },
      });
      const ids = memberships.map((row: any) => Number(row.get("documentId")));
      const rows = ids.length
        ? await this.app.chatDb.CloudDocument.findAll({
            where: { companyId, id: { [Op.in]: ids }, trashedAt: null },
          })
        : [];
      for (const row of rows)
        add(
          "document",
          row,
          String(row.get("title")),
          documentText(row.get("yjsState") as Buffer | null),
          { documentId: Number(row.get("id")) },
        );
    }
    if (type === "all" || type === "member") {
      const rows = await this.app.chatDb.User.findAll({
        where: { companyId, status: "active" },
      });
      for (const row of rows)
        add(
          "member",
          row,
          String(row.get("name")),
          `${row.get("phone")} ${row.get("title") || ""} ${row.get("email") || ""}`,
          { userId: Number(row.get("id")) },
        );
    }
    if (type === "all" || type === "task") {
      const rows = await this.app.chatDb.Task.findAll({
        where: {
          companyId,
          [Op.or]: [{ creatorId: userId }, { assigneeId: userId }],
        },
      });
      for (const row of rows)
        add("task", row, String(row.get("title")), String(row.get("title")), {
          taskId: Number(row.get("id")),
        });
    }
    if (type === "all" || type === "notification") {
      const rows = await this.app.chatDb.Notification.findAll({
        where: { companyId, recipientUserId: userId },
      });
      for (const row of rows)
        add(
          "notification",
          row,
          String(row.get("title")),
          String(row.get("body")),
          { notificationId: Number(row.get("id")) },
        );
    }
    hits.sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.type.localeCompare(b.type) ||
        b.id - a.id,
    );
    return {
      items: hits.slice(offset, offset + limit),
      total: hits.length,
      hasMore: offset + limit < hits.length,
    };
  }
}
