import { Service } from "egg";
import path from "node:path";
import { Op, Transaction } from "sequelize";
import { toPlain } from "../lib/database";
import { exportCloudDocument } from "../lib/document-export";
import { importCloudDocument } from "../lib/document-import";
import { createNotification } from "../lib/notifications";
import { ServiceError } from "../lib/service-error";

type CloudDocumentType = "doc" | "sheet";

type CloudDocumentPermission = "owner" | "editor" | "viewer";

const documentTypes = new Set<CloudDocumentType>(["doc", "sheet"]);

const permissions = new Set<CloudDocumentPermission>(["editor", "viewer"]);

/** 按公开配置或当前连接信息生成协作服务地址。 */
function collaborationUrl(connection: { hostname: string; secure: boolean }) {
  const configured = String(
    process.env.CHAT_COLLABORATION_PUBLIC_URL || "",
  ).trim();
  if (configured) return configured.replace(/\/+$/, "");
  const port = Number(process.env.CHAT_COLLABORATION_PORT || 1234);
  const hostname = String(connection.hostname || "127.0.0.1");
  return `${connection.secure ? "wss" : "ws"}://${hostname}:${port}`;
}

export default class DocumentsService extends Service {
  /** 在事务中创建文档及所有者成员关系，返回文档摘要。 */
  private async createOwnedDocument(
    type: CloudDocumentType,
    title: string,
    yjsState?: Buffer,
  ) {
    const { app } = this;
    const transaction = await app.chatDb.sequelize.transaction();
    try {
      const document = await app.chatDb.CloudDocument.create(
        {
          companyId: this.ctx.currentUser.companyId,
          ownerId: this.ctx.currentUser.id,
          lastEditorId: this.ctx.currentUser.id,
          title,
          type,
          icon: type,
          color: type === "sheet" ? "#13a36f" : "#1677ff",
          ...(yjsState ? { yjsState } : {}),
        },
        { transaction },
      );
      const member = await app.chatDb.CloudDocumentMember.create(
        {
          documentId: document.get("id"),
          userId: this.ctx.currentUser.id,
          permission: "owner",
          lastOpenedAt: new Date(),
        },
        { transaction },
      );
      await this.service.documentVersions.saveSnapshot(
        document,
        yjsState || null,
        this.ctx.currentUser.id,
        "创建文档",
        transaction,
      );
      await transaction.commit();
      const [payload] = await this.serializeDocuments([document], [member]);
      return payload;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /** 校验当前用户的文档成员关系、企业归属及未删除状态。 */
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

  /** 批量补齐文档成员、权限、收藏及最近编辑者资料。 */
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
    const userMap = new Map<number, any>(
      users.map((row: any) => [Number(row.get("id")), toPlain(row)]),
    );
    const ownMembership = new Map<number, any>(
      memberships.map((row: any) => [
        Number(row.get("documentId")),
        toPlain(row),
      ]),
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
          ? {
              id: lastEditor.id,
              name: lastEditor.name,
              avatar: lastEditor.avatar,
            }
          : null,
        createdAt: new Date(item.createdAt).toISOString(),
        updatedAt: new Date(item.updatedAt).toISOString(),
      };
    });
  }

  /** 补齐评论作者和解决状态，生成统一的评论数据。 */
  private async serializeComments(rows: any[]) {
    if (!rows.length) return [];
    const userIds = [
      ...new Set(
        rows
          .flatMap((row: any) => [
            Number(row.get("authorId")),
            Number(row.get("resolvedById") || 0),
          ])
          .filter(Boolean),
      ),
    ];
    const users = await this.app.chatDb.User.findAll({
      where: {
        id: { [Op.in]: userIds },
        companyId: this.ctx.currentUser.companyId,
      },
    });
    const userMap = new Map<number, any>(
      users.map((row: any) => [Number(row.get("id")), toPlain(row)]),
    );
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
        resolvedAt: comment.resolvedAt
          ? new Date(comment.resolvedAt).toISOString()
          : null,
        resolvedById: comment.resolvedById
          ? Number(comment.resolvedById)
          : null,
        createdAt: new Date(comment.createdAt).toISOString(),
        updatedAt: new Date(comment.updatedAt).toISOString(),
      };
    });
  }

  /** 校验文档访问权限后按时间读取评论。 */
  async comments(resourceId: number) {
    const access = await this.membership(Number(resourceId));
    if (!access)
      throw new ServiceError(
        404,
        "DOCUMENT_NOT_FOUND",
        "文档不存在或你没有访问权限",
      );
    const rows = await this.app.chatDb.CloudDocumentComment.findAll({
      where: {
        documentId: access.document.get("id"),
        companyId: this.ctx.currentUser.companyId,
      },
      order: [
        ["createdAt", "ASC"],
        ["id", "ASC"],
      ],
    });
    return await this.serializeComments(rows);
  }

  /** 在事务中创建评论及成员通知，提交后推送通知。 */
  async createComment(resourceId: number, input: Record<string, any>) {
    const access = await this.membership(Number(resourceId));
    if (!access)
      throw new ServiceError(
        404,
        "DOCUMENT_NOT_FOUND",
        "文档不存在或你没有访问权限",
      );
    const content = String(input?.content || "").trim();
    if (!content || content.length > 2_000) {
      throw new ServiceError(
        400,
        "INVALID_COMMENT",
        "评论不能为空且不能超过 2000 个字符",
      );
    }
    const anchor = input?.anchor
      ? String(input.anchor).trim().slice(0, 120)
      : null;
    const rawParentId = input?.parentId;
    let parentId =
      rawParentId === undefined || rawParentId === null || rawParentId === ""
        ? null
        : Number(rawParentId);
    if (
      parentId !== null &&
      (!Number.isSafeInteger(parentId) || parentId <= 0)
    ) {
      throw new ServiceError(400, "INVALID_COMMENT_PARENT", "回复目标不正确");
    }
    if (parentId !== null) {
      let parent = await this.app.chatDb.CloudDocumentComment.findOne({
        where: {
          id: parentId,
          documentId: access.document.get("id"),
          companyId: this.ctx.currentUser.companyId,
        },
      });
      if (!parent)
        throw new ServiceError(400, "INVALID_COMMENT_PARENT", "回复目标不存在");
      const visited = new Set<number>();
      while (parent.get("parentId")) {
        if (visited.has(Number(parent.get("id"))))
          throw new ServiceError(
            400,
            "INVALID_COMMENT_PARENT",
            "评论线程关系无效",
          );
        visited.add(Number(parent.get("id")));
        parent = await this.app.chatDb.CloudDocumentComment.findOne({
          where: {
            id: parent.get("parentId"),
            documentId: resourceId,
            companyId: this.ctx.currentUser.companyId,
          },
        });
        if (!parent)
          throw new ServiceError(
            400,
            "INVALID_COMMENT_PARENT",
            "评论线程不存在",
          );
      }
      if (parent.get("resolvedAt"))
        throw new ServiceError(
          409,
          "COMMENT_THREAD_RESOLVED",
          "请先重新打开该评论线程再回复",
        );
      parentId = Number(parent.get("id"));
    }
    // 回复读取根状态前取得写锁，避免 DEFERRED 事务从读锁升级时与解决操作互相阻塞。
    const transaction = await this.app.chatDb.sequelize.transaction({
      type: Transaction.TYPES.IMMEDIATE,
    });
    const recipientIds: number[] = [];
    try {
      if (parentId !== null) {
        const parent = await this.app.chatDb.CloudDocumentComment.findOne({
          where: {
            id: parentId,
            documentId: resourceId,
            companyId: this.ctx.currentUser.companyId,
          },
          transaction,
        });
        if (!parent || parent.get("resolvedAt"))
          throw new ServiceError(
            409,
            "COMMENT_THREAD_RESOLVED",
            "请先重新打开该评论线程再回复",
          );
      }
      const comment = await this.app.chatDb.CloudDocumentComment.create(
        {
          companyId: this.ctx.currentUser.companyId,
          documentId: access.document.get("id"),
          authorId: this.ctx.currentUser.id,
          parentId,
          anchor,
          content,
        },
        { transaction },
      );
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
        await createNotification(
          this.app,
          {
            companyId: this.ctx.currentUser.companyId,
            recipientUserId: recipientId,
            type: "comment",
            title: "文档收到新评论",
            body: `${String(this.ctx.currentUser.name)}评论了“${String(access.document.get("title"))}”：${content}`,
            entityType: "document",
            entityId: String(access.document.get("id")),
            documentId: Number(access.document.get("id")),
            payload: { commentId: Number(comment.get("id")), anchor },
          },
          transaction,
        );
        recipientIds.push(recipientId);
      }
      await transaction.commit();
      for (const recipientId of recipientIds) {
        this.app.io
          ?.of("/")
          ?.to(`user:${recipientId}`)
          .emit("notification:available", {
            documentId: Number(access.document.get("id")),
            commentId: Number(comment.get("id")),
          });
      }
      const [serialized] = await this.serializeComments([comment]);
      return serialized;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /** 校验作者或编辑权限后更新评论解决状态。 */
  async updateComment(
    resourceId: number,
    targetCommentId: number,
    input: Record<string, any>,
  ) {
    const access = await this.membership(Number(resourceId));
    if (!access)
      throw new ServiceError(
        404,
        "DOCUMENT_NOT_FOUND",
        "文档不存在或你没有访问权限",
      );
    const comment = await this.app.chatDb.CloudDocumentComment.findOne({
      where: {
        id: Number(targetCommentId),
        documentId: access.document.get("id"),
        companyId: this.ctx.currentUser.companyId,
      },
    });
    if (!comment)
      throw new ServiceError(404, "COMMENT_NOT_FOUND", "评论不存在");
    if (typeof input?.resolved !== "boolean") {
      throw new ServiceError(
        400,
        "INVALID_COMMENT_UPDATE",
        "只支持更新评论解决状态",
      );
    }
    const permission = String(access.member.get("permission"));
    const threadRows = await this.app.chatDb.CloudDocumentComment.findAll({
      where: {
        documentId: resourceId,
        companyId: this.ctx.currentUser.companyId,
      },
    });
    const byId = new Map<number, any>(
      threadRows.map((row: any) => [Number(row.get("id")), row]),
    );
    let root = comment;
    const visited = new Set<number>();
    while (root.get("parentId") && !visited.has(Number(root.get("id")))) {
      visited.add(Number(root.get("id")));
      const parent = byId.get(Number(root.get("parentId")));
      if (!parent) break;
      root = parent;
    }
    if (
      Number(root.get("authorId")) !== Number(this.ctx.currentUser.id) &&
      !["owner", "editor"].includes(permission)
    )
      throw new ServiceError(
        403,
        "COMMENT_RESOLVE_FORBIDDEN",
        "只有线程作者或文档编辑者可以解决线程",
      );
    const ids = new Set<number>([Number(root.get("id"))]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of threadRows) {
        const id = Number(row.get("id"));
        if (!ids.has(id) && ids.has(Number(row.get("parentId")))) {
          ids.add(id);
          changed = true;
        }
      }
    }
    const resolved = input.resolved;
    await this.app.chatDb.CloudDocumentComment.update(
      {
        resolvedAt: resolved ? new Date() : null,
        resolvedById: resolved ? this.ctx.currentUser.id : null,
      },
      {
        where: {
          // 新回复一律归根；写入时一并匹配根下回复，避免漏掉读取集合后刚提交的回复。
          [Op.or]: [
            { id: { [Op.in]: [...ids] } },
            { parentId: Number(root.get("id")) },
          ],
          documentId: resourceId,
          companyId: this.ctx.currentUser.companyId,
        },
      },
    );
    await comment.reload();
    const [serialized] = await this.serializeComments([comment]);
    return serialized;
  }

  /** 按当前用户权限查询最近、我的、共享或收藏文档。 */
  async list(query: Record<string, any>) {
    const { app } = this;
    const userId = this.ctx.currentUser.id;
    const view = String(query.view || "recent");
    const keyword = String(query.q || "").trim();
    const memberships = await app.chatDb.CloudDocumentMember.findAll({
      where: {
        userId,
        ...(view === "favorite" ? { isFavorite: true } : {}),
      },
    });
    const documentIds = memberships.map((row: any) =>
      Number(row.get("documentId")),
    );
    if (!documentIds.length) return [];
    const where: any = {
      id: { [Op.in]: documentIds },
      companyId: this.ctx.currentUser.companyId,
      trashedAt: null,
    };
    if (view === "mine") where.ownerId = userId;
    if (view === "shared") where.ownerId = { [Op.ne]: userId };
    if (keyword) where.title = { [Op.like]: `%${keyword}%` };
    const rows = await app.chatDb.CloudDocument.findAll({
      where,
      order: [
        ["updatedAt", "DESC"],
        ["id", "DESC"],
      ],
    });
    return await this.serializeDocuments(rows, memberships);
  }

  /** 校验文档类型并创建当前用户拥有的文档。 */
  async create(input: Record<string, any>) {
    const type = String(input?.type || "doc") as CloudDocumentType;
    if (!documentTypes.has(type))
      throw new ServiceError(400, "INVALID_DOCUMENT_TYPE", "文档类型不正确");
    const fallbackTitle = type === "sheet" ? "未命名表格" : "未命名文档";
    const title = String(input?.title || fallbackTitle)
      .trim()
      .slice(0, 120);
    try {
      return await this.createOwnedDocument(type, title);
    } catch (error) {
      throw error;
    }
  }

  /** 限制导入大小并解析本地文件，创建对应的云文档。 */
  async importFile(getStream: () => Promise<any>) {
    const stream: any = await getStream();
    const filename = path.basename(String(stream.filename || ""));
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += value.length;
      if (size > 20 * 1024 * 1024) {
        stream.destroy();
        throw new ServiceError(
          413,
          "DOCUMENT_IMPORT_TOO_LARGE",
          "导入文件不能超过 20 MB",
        );
      }
      chunks.push(value);
    }
    try {
      const imported = await importCloudDocument(
        filename,
        Buffer.concat(chunks),
      );
      return await this.createOwnedDocument(
        imported.type,
        imported.title,
        imported.state,
      );
    } catch (error) {
      throw new ServiceError(
        400,
        "DOCUMENT_IMPORT_FAILED",
        error instanceof Error ? error.message : "文档导入失败",
      );
    }
  }

  /** 记录最近打开时间并返回文档及协作连接地址。 */
  async detail(
    resourceId: number,
    connection: { hostname: string; secure: boolean },
  ) {
    const access = await this.membership(Number(resourceId));
    if (!access)
      throw new ServiceError(
        404,
        "DOCUMENT_NOT_FOUND",
        "文档不存在或你没有访问权限",
      );
    await access.member.update({ lastOpenedAt: new Date() });
    const [document] = await this.serializeDocuments(
      [access.document],
      [access.member],
    );
    return { document, collaborationUrl: collaborationUrl(connection) };
  }

  /** 校验访问权限并导出 Office 文件及下载元数据。 */
  async download(resourceId: number) {
    const access = await this.membership(Number(resourceId));
    if (!access)
      throw new ServiceError(
        404,
        "DOCUMENT_NOT_FOUND",
        "文档不存在或你没有访问权限",
      );
    const type = String(access.document.get("type")) as CloudDocumentType;
    const exported = exportCloudDocument(
      type,
      access.document.get("yjsState") as Buffer | null,
    );
    const title = String(access.document.get("title") || "未命名文档");
    return {
      mimeType: exported.mimeType,
      data: exported.data,
      filename: `${title}.${exported.extension}`,
      fallbackFilename: `document-${access.document.get("id")}.${exported.extension}`,
    };
  }

  /** 按成员权限更新文档资料及个人收藏状态。 */
  async update(resourceId: number, input: Record<string, any>) {
    const access = await this.membership(Number(resourceId));
    if (!access)
      throw new ServiceError(
        404,
        "DOCUMENT_NOT_FOUND",
        "文档不存在或你没有访问权限",
      );
    const permission = String(access.member.get("permission"));
    const body = input || {};
    if (
      (body.title !== undefined ||
        body.color !== undefined ||
        body.icon !== undefined) &&
      permission === "viewer"
    ) {
      throw new ServiceError(403, "DOCUMENT_READ_ONLY", "你只有查看权限");
    }
    if (body.title !== undefined && !String(body.title).trim()) {
      throw new ServiceError(400, "INVALID_DOCUMENT_TITLE", "文档标题不能为空");
    }
    await access.document.update({
      ...(body.title !== undefined
        ? { title: String(body.title).trim().slice(0, 120) }
        : {}),
      ...(body.color !== undefined
        ? { color: String(body.color).slice(0, 16) }
        : {}),
      ...(body.icon !== undefined
        ? { icon: String(body.icon).slice(0, 20) }
        : {}),
      ...(body.title !== undefined ||
      body.color !== undefined ||
      body.icon !== undefined
        ? { lastEditorId: this.ctx.currentUser.id }
        : {}),
    });
    if (body.favorite !== undefined) {
      await access.member.update({ isFavorite: Boolean(body.favorite) });
    }
    const [document] = await this.serializeDocuments(
      [access.document],
      [access.member],
    );
    return document;
  }

  /** 仅允许所有者在事务中更新同企业内的共享成员权限。 */
  async share(resourceId: number, input: Record<string, any>) {
    const access = await this.membership(Number(resourceId));
    if (!access)
      throw new ServiceError(
        404,
        "DOCUMENT_NOT_FOUND",
        "文档不存在或你没有访问权限",
      );
    if (String(access.member.get("permission")) !== "owner") {
      throw new ServiceError(
        403,
        "DOCUMENT_OWNER_REQUIRED",
        "只有文档所有者可以管理共享成员",
      );
    }
    const requested = Array.isArray(input?.members) ? input.members : [];
    const normalized = requested
      .map((item: any) => ({
        userId: Number(item.userId),
        permission: String(item.permission) as CloudDocumentPermission,
      }))
      .filter(
        (item: any) =>
          Number.isSafeInteger(item.userId) && permissions.has(item.permission),
      );
    const users = await this.app.chatDb.User.findAll({
      where: {
        id: { [Op.in]: normalized.map((item: any) => item.userId) },
        companyId: this.ctx.currentUser.companyId,
        status: "active",
      },
    });
    if (
      users.length !== new Set(normalized.map((item: any) => item.userId)).size
    ) {
      throw new ServiceError(
        400,
        "INVALID_DOCUMENT_MEMBER",
        "共享成员不属于当前企业或已停用",
      );
    }
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      const keep = [
        this.ctx.currentUser.id,
        ...normalized.map((item: any) => item.userId),
      ];
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
        await this.app.chatDb.CloudDocumentMember.upsert(
          {
            documentId: access.document.get("id"),
            userId: item.userId,
            permission: item.permission,
          },
          { transaction },
        );
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    const memberships = await this.app.chatDb.CloudDocumentMember.findAll({
      where: { documentId: access.document.get("id") },
    });
    const own = memberships.find(
      (row: any) => Number(row.get("userId")) === this.ctx.currentUser.id,
    )!;
    const [document] = await this.serializeDocuments([access.document], [own]);
    return document;
  }

  /** 仅允许文档所有者将文档移入回收状态。 */
  async remove(resourceId: number) {
    const access = await this.membership(Number(resourceId));
    if (!access)
      throw new ServiceError(
        404,
        "DOCUMENT_NOT_FOUND",
        "文档不存在或你没有访问权限",
      );
    if (String(access.member.get("permission")) !== "owner") {
      throw new ServiceError(
        403,
        "DOCUMENT_OWNER_REQUIRED",
        "只有文档所有者可以删除文档",
      );
    }
    await access.document.update({ trashedAt: new Date() });
    return true;
  }
}
