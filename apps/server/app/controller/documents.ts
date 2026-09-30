import { Controller } from "egg";
import path from "node:path";
import { Op } from "sequelize";
import { fail, ok } from "../lib/auth";
import { toPlain } from "../lib/database";
import { exportCloudDocument } from "../lib/document-export";
import { importCloudDocument } from "../lib/document-import";
import { createNotification } from "../lib/notifications";

type CloudDocumentType = "doc" | "sheet";
type CloudDocumentPermission = "owner" | "editor" | "viewer";
const documentTypes = new Set<CloudDocumentType>(["doc", "sheet"]);
const permissions = new Set<CloudDocumentPermission>(["editor", "viewer"]);

function collaborationUrl(ctx: any) {
  const configured = String(process.env.CHAT_COLLABORATION_PUBLIC_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const port = Number(process.env.CHAT_COLLABORATION_PORT || 1234);
  const hostname = String(ctx.hostname || "127.0.0.1");
  return `${ctx.secure ? "wss" : "ws"}://${hostname}:${port}`;
}

export default class DocumentsController extends Controller {
  private async createOwnedDocument(
    type: CloudDocumentType,
    title: string,
    yjsState?: Buffer,
  ) {
    const { app, ctx } = this;
    const transaction = await app.chatDb.sequelize.transaction();
    try {
      const document = await app.chatDb.CloudDocument.create({
        companyId: ctx.currentUser.companyId,
        ownerId: ctx.currentUser.id,
        lastEditorId: ctx.currentUser.id,
        title,
        type,
        icon: type,
        color: type === "sheet" ? "#13a36f" : "#1677ff",
        ...(yjsState ? { yjsState } : {}),
      }, { transaction });
      const member = await app.chatDb.CloudDocumentMember.create({
        documentId: document.get("id"),
        userId: ctx.currentUser.id,
        permission: "owner",
        lastOpenedAt: new Date(),
      }, { transaction });
      await transaction.commit();
      const [payload] = await this.serializeDocuments([document], [member]);
      return payload;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  private async membership(documentId: number) {
    const member = await this.app.chatDb.CloudDocumentMember.findOne({
      where: { documentId, userId: this.ctx.currentUser.id },
    });
    if (!member) return null;
    const document = await this.app.chatDb.CloudDocument.findOne({
      where: {
        id: documentId,
        companyId: this.ctx.currentUser.companyId,
        trashedAt: null,
      },
    });
    return document ? { document, member } : null;
  }

  private async serializeDocuments(rows: any[], memberships: any[]) {
    if (!rows.length) return [];
    const ids = rows.map((row) => Number(row.get("id")));
    const allMembers = await this.app.chatDb.CloudDocumentMember.findAll({
      where: { documentId: { [Op.in]: ids } },
    });
    const userIds = new Set<number>();
    rows.forEach((row) => {
      userIds.add(Number(row.get("ownerId")));
      if (row.get("lastEditorId")) userIds.add(Number(row.get("lastEditorId")));
    });
    allMembers.forEach((row: any) => userIds.add(Number(row.get("userId"))));
    const users = await this.app.chatDb.User.findAll({
      where: {
        id: { [Op.in]: [...userIds] },
        companyId: this.ctx.currentUser.companyId,
      },
    });
    const userMap = new Map<number, any>(users.map((row: any) => [Number(row.get("id")), toPlain(row)]));
    const ownMembership = new Map<number, any>(
      memberships.map((row: any) => [Number(row.get("documentId")), toPlain(row)]),
    );

    return rows.map((row: any) => {
      const item = toPlain<any>(row);
      const member = ownMembership.get(item.id);
      const lastEditor = userMap.get(Number(item.lastEditorId));
      const members = allMembers
        .filter((entry: any) => Number(entry.get("documentId")) === item.id)
        .map((entry: any) => {
          const membership = toPlain<any>(entry);
          const user = userMap.get(membership.userId);
          return {
            userId: membership.userId,
            name: user?.name || "已停用成员",
            avatar: user?.avatar || "",
            permission: membership.permission,
          };
        });
      return {
        id: item.id,
        companyId: item.companyId,
        ownerId: item.ownerId,
        title: item.title,
        type: item.type,
        icon: item.icon,
        color: item.color,
        permission: member?.permission || "viewer",
        favorite: Boolean(member?.isFavorite),
        members,
        lastEditor: lastEditor
          ? { id: lastEditor.id, name: lastEditor.name, avatar: lastEditor.avatar }
          : null,
        createdAt: new Date(item.createdAt).toISOString(),
        updatedAt: new Date(item.updatedAt).toISOString(),
      };
    });
  }

  private async serializeComments(rows: any[]) {
    if (!rows.length) return [];
    const userIds = [...new Set(rows.flatMap((row: any) => [
      Number(row.get("authorId")),
      Number(row.get("resolvedById") || 0),
    ]).filter(Boolean))];
    const users = await this.app.chatDb.User.findAll({
      where: { id: { [Op.in]: userIds }, companyId: this.ctx.currentUser.companyId },
    });
    const userMap = new Map<number, any>(users.map((row: any) => [Number(row.get("id")), toPlain(row)]));
    return rows.map((row: any) => {
      const comment = toPlain(row);
      const author = userMap.get(Number(comment.authorId));
      return {
        id: Number(comment.id),
        documentId: Number(comment.documentId),
        parentId: comment.parentId ? Number(comment.parentId) : null,
        anchor: comment.anchor ? String(comment.anchor) : null,
        content: String(comment.content),
        authorId: Number(comment.authorId),
        author: {
          id: Number(comment.authorId),
          name: String(author?.name || "已停用成员"),
          avatar: String(author?.avatar || ""),
        },
        resolved: Boolean(comment.resolvedAt),
        resolvedAt: comment.resolvedAt ? new Date(comment.resolvedAt).toISOString() : null,
        resolvedById: comment.resolvedById ? Number(comment.resolvedById) : null,
        createdAt: new Date(comment.createdAt).toISOString(),
        updatedAt: new Date(comment.updatedAt).toISOString(),
      };
    });
  }

  async comments() {
    const access = await this.membership(Number(this.ctx.params.id));
    if (!access) return fail(this.ctx, 404, "DOCUMENT_NOT_FOUND", "文档不存在或你没有访问权限");
    const rows = await this.app.chatDb.CloudDocumentComment.findAll({
      where: {
        documentId: access.document.get("id"),
        companyId: this.ctx.currentUser.companyId,
      },
      order: [["createdAt", "ASC"], ["id", "ASC"]],
    });
    ok(this.ctx, await this.serializeComments(rows));
  }

  async createComment() {
    const access = await this.membership(Number(this.ctx.params.id));
    if (!access) return fail(this.ctx, 404, "DOCUMENT_NOT_FOUND", "文档不存在或你没有访问权限");
    const content = String(this.ctx.request.body?.content || "").trim();
    if (!content || content.length > 2_000) {
      return fail(this.ctx, 400, "INVALID_COMMENT", "评论不能为空且不能超过 2000 个字符");
    }
    const anchor = this.ctx.request.body?.anchor
      ? String(this.ctx.request.body.anchor).trim().slice(0, 120)
      : null;
    const rawParentId = this.ctx.request.body?.parentId;
    const parentId = rawParentId === undefined || rawParentId === null || rawParentId === ""
      ? null
      : Number(rawParentId);
    if (parentId !== null && (!Number.isSafeInteger(parentId) || parentId <= 0)) {
      return fail(this.ctx, 400, "INVALID_COMMENT_PARENT", "回复目标不正确");
    }
    if (parentId !== null) {
      const parent = await this.app.chatDb.CloudDocumentComment.findOne({
        where: { id: parentId, documentId: access.document.get("id"), companyId: this.ctx.currentUser.companyId },
      });
      if (!parent) return fail(this.ctx, 400, "INVALID_COMMENT_PARENT", "回复目标不存在");
    }
    const transaction = await this.app.chatDb.sequelize.transaction();
    const recipientIds: number[] = [];
    try {
      const comment = await this.app.chatDb.CloudDocumentComment.create({
        companyId: this.ctx.currentUser.companyId,
        documentId: access.document.get("id"),
        authorId: this.ctx.currentUser.id,
        parentId,
        anchor,
        content,
      }, { transaction });
      const members = await this.app.chatDb.CloudDocumentMember.findAll({
        where: { documentId: access.document.get("id") },
        transaction,
      });
      const memberIds = members
        .map((row: any) => Number(row.get("userId")))
        .filter((id: number) => id !== Number(this.ctx.currentUser.id));
      const activeUsers = memberIds.length
        ? await this.app.chatDb.User.findAll({
            where: {
              id: { [Op.in]: memberIds },
              companyId: this.ctx.currentUser.companyId,
              status: "active",
            },
            attributes: ["id"],
            transaction,
          })
        : [];
      for (const user of activeUsers) {
        const recipientId = Number(user.get("id"));
        await createNotification(this.app, {
          companyId: this.ctx.currentUser.companyId,
          recipientUserId: recipientId,
          type: "comment",
          title: "文档收到新评论",
          body: `${String(this.ctx.currentUser.name)}评论了“${String(access.document.get("title"))}”：${content}`,
          entityType: "document",
          entityId: String(access.document.get("id")),
          documentId: Number(access.document.get("id")),
          payload: { commentId: Number(comment.get("id")), anchor },
        }, transaction);
        recipientIds.push(recipientId);
      }
      await transaction.commit();
      for (const recipientId of recipientIds) {
        this.app.io?.of("/")?.to(`user:${recipientId}`).emit("notification:available", {
          documentId: Number(access.document.get("id")),
          commentId: Number(comment.get("id")),
        });
      }
      const [serialized] = await this.serializeComments([comment]);
      ok(this.ctx, serialized);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async updateComment() {
    const access = await this.membership(Number(this.ctx.params.id));
    if (!access) return fail(this.ctx, 404, "DOCUMENT_NOT_FOUND", "文档不存在或你没有访问权限");
    const comment = await this.app.chatDb.CloudDocumentComment.findOne({
      where: {
        id: Number(this.ctx.params.commentId),
        documentId: access.document.get("id"),
        companyId: this.ctx.currentUser.companyId,
      },
    });
    if (!comment) return fail(this.ctx, 404, "COMMENT_NOT_FOUND", "评论不存在");
    if (typeof this.ctx.request.body?.resolved !== "boolean") {
      return fail(this.ctx, 400, "INVALID_COMMENT_UPDATE", "只支持更新评论解决状态");
    }
    const permission = String(access.member.get("permission"));
    const canResolve = Number(comment.get("authorId")) === Number(this.ctx.currentUser.id)
      || ["owner", "editor"].includes(permission);
    if (!canResolve) return fail(this.ctx, 403, "COMMENT_RESOLVE_FORBIDDEN", "无权解决该评论");
    const resolved = this.ctx.request.body.resolved;
    await comment.update({
      resolvedAt: resolved ? new Date() : null,
      resolvedById: resolved ? this.ctx.currentUser.id : null,
    });
    const [serialized] = await this.serializeComments([comment]);
    ok(this.ctx, serialized);
  }

  async list() {
    const { ctx, app } = this;
    const userId = ctx.currentUser.id;
    const view = String(ctx.query.view || "recent");
    const keyword = String(ctx.query.q || "").trim();
    const memberships = await app.chatDb.CloudDocumentMember.findAll({
      where: {
        userId,
        ...(view === "favorite" ? { isFavorite: true } : {}),
      },
    });
    const documentIds = memberships.map((row: any) => Number(row.get("documentId")));
    if (!documentIds.length) return ok(ctx, []);
    const where: any = {
      id: { [Op.in]: documentIds },
      companyId: ctx.currentUser.companyId,
      trashedAt: null,
    };
    if (view === "mine") where.ownerId = userId;
    if (view === "shared") where.ownerId = { [Op.ne]: userId };
    if (keyword) where.title = { [Op.like]: `%${keyword}%` };
    const rows = await app.chatDb.CloudDocument.findAll({
      where,
      order: [["updatedAt", "DESC"], ["id", "DESC"]],
    });
    ok(ctx, await this.serializeDocuments(rows, memberships));
  }

  async create() {
    const { ctx } = this;
    const type = String(ctx.request.body?.type || "doc") as CloudDocumentType;
    if (!documentTypes.has(type)) return fail(ctx, 400, "INVALID_DOCUMENT_TYPE", "文档类型不正确");
    const fallbackTitle = type === "sheet" ? "未命名表格" : "未命名文档";
    const title = String(ctx.request.body?.title || fallbackTitle).trim().slice(0, 120);
    try {
      ok(ctx, await this.createOwnedDocument(type, title));
    } catch (error) {
      throw error;
    }
  }

  async importFile() {
    const { ctx } = this;
    const stream: any = await ctx.getFileStream();
    const filename = path.basename(String(stream.filename || ""));
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += value.length;
      if (size > 20 * 1024 * 1024) {
        stream.destroy();
        return fail(ctx, 413, "DOCUMENT_IMPORT_TOO_LARGE", "导入文件不能超过 20 MB");
      }
      chunks.push(value);
    }
    try {
      const imported = await importCloudDocument(filename, Buffer.concat(chunks));
      ok(ctx, await this.createOwnedDocument(imported.type, imported.title, imported.state));
    } catch (error) {
      return fail(
        ctx,
        400,
        "DOCUMENT_IMPORT_FAILED",
        error instanceof Error ? error.message : "文档导入失败",
      );
    }
  }

  async detail() {
    const access = await this.membership(Number(this.ctx.params.id));
    if (!access) return fail(this.ctx, 404, "DOCUMENT_NOT_FOUND", "文档不存在或你没有访问权限");
    await access.member.update({ lastOpenedAt: new Date() });
    const [document] = await this.serializeDocuments([access.document], [access.member]);
    ok(this.ctx, { document, collaborationUrl: collaborationUrl(this.ctx) });
  }

  async download() {
    const access = await this.membership(Number(this.ctx.params.id));
    if (!access) return fail(this.ctx, 404, "DOCUMENT_NOT_FOUND", "文档不存在或你没有访问权限");
    const type = String(access.document.get("type")) as CloudDocumentType;
    const exported = exportCloudDocument(type, access.document.get("yjsState") as Buffer | null);
    const title = String(access.document.get("title") || "未命名文档");
    const encodedName = encodeURIComponent(`${title}.${exported.extension}`);
    this.ctx.set("Content-Type", exported.mimeType);
    this.ctx.set("Content-Length", String(exported.data.length));
    this.ctx.set(
      "Content-Disposition",
      `attachment; filename="document-${access.document.get("id")}.${exported.extension}"; filename*=UTF-8''${encodedName}`,
    );
    this.ctx.body = exported.data;
  }

  async update() {
    const access = await this.membership(Number(this.ctx.params.id));
    if (!access) return fail(this.ctx, 404, "DOCUMENT_NOT_FOUND", "文档不存在或你没有访问权限");
    const permission = String(access.member.get("permission"));
    const body = this.ctx.request.body || {};
    if (
      (body.title !== undefined || body.color !== undefined || body.icon !== undefined)
      && permission === "viewer"
    ) {
      return fail(this.ctx, 403, "DOCUMENT_READ_ONLY", "你只有查看权限");
    }
    if (body.title !== undefined && !String(body.title).trim()) {
      return fail(this.ctx, 400, "INVALID_DOCUMENT_TITLE", "文档标题不能为空");
    }
    await access.document.update({
      ...(body.title !== undefined ? { title: String(body.title).trim().slice(0, 120) } : {}),
      ...(body.color !== undefined ? { color: String(body.color).slice(0, 16) } : {}),
      ...(body.icon !== undefined ? { icon: String(body.icon).slice(0, 20) } : {}),
      ...((body.title !== undefined || body.color !== undefined || body.icon !== undefined)
        ? { lastEditorId: this.ctx.currentUser.id }
        : {}),
    });
    if (body.favorite !== undefined) {
      await access.member.update({ isFavorite: Boolean(body.favorite) });
    }
    const [document] = await this.serializeDocuments([access.document], [access.member]);
    ok(this.ctx, document);
  }

  async share() {
    const access = await this.membership(Number(this.ctx.params.id));
    if (!access) return fail(this.ctx, 404, "DOCUMENT_NOT_FOUND", "文档不存在或你没有访问权限");
    if (String(access.member.get("permission")) !== "owner") {
      return fail(this.ctx, 403, "DOCUMENT_OWNER_REQUIRED", "只有文档所有者可以管理共享成员");
    }
    const requested = Array.isArray(this.ctx.request.body?.members)
      ? this.ctx.request.body.members
      : [];
    const normalized = requested
      .map((item: any) => ({
        userId: Number(item.userId),
        permission: String(item.permission) as CloudDocumentPermission,
      }))
      .filter((item: any) => Number.isSafeInteger(item.userId) && permissions.has(item.permission));
    const users = await this.app.chatDb.User.findAll({
      where: {
        id: { [Op.in]: normalized.map((item: any) => item.userId) },
        companyId: this.ctx.currentUser.companyId,
        status: "active",
      },
    });
    if (users.length !== new Set(normalized.map((item: any) => item.userId)).size) {
      return fail(this.ctx, 400, "INVALID_DOCUMENT_MEMBER", "共享成员不属于当前企业或已停用");
    }
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      const keep = [this.ctx.currentUser.id, ...normalized.map((item: any) => item.userId)];
      await this.app.chatDb.CloudDocumentMember.destroy({
        where: {
          documentId: access.document.get("id"),
          userId: { [Op.notIn]: keep },
          permission: { [Op.ne]: "owner" },
        },
        transaction,
      });
      for (const item of normalized) {
        if (item.userId === this.ctx.currentUser.id) continue;
        await this.app.chatDb.CloudDocumentMember.upsert({
          documentId: access.document.get("id"),
          userId: item.userId,
          permission: item.permission,
        }, { transaction });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    const memberships = await this.app.chatDb.CloudDocumentMember.findAll({
      where: { documentId: access.document.get("id") },
    });
    const own = memberships.find((row: any) => Number(row.get("userId")) === this.ctx.currentUser.id)!;
    const [document] = await this.serializeDocuments([access.document], [own]);
    ok(this.ctx, document);
  }

  async remove() {
    const access = await this.membership(Number(this.ctx.params.id));
    if (!access) return fail(this.ctx, 404, "DOCUMENT_NOT_FOUND", "文档不存在或你没有访问权限");
    if (String(access.member.get("permission")) !== "owner") {
      return fail(this.ctx, 403, "DOCUMENT_OWNER_REQUIRED", "只有文档所有者可以删除文档");
    }
    await access.document.update({ trashedAt: new Date() });
    ok(this.ctx, true);
  }
}
