import { Service } from "egg";
import { createHash } from "node:crypto";
import { Op, type Transaction } from "sequelize";
import * as Y from "yjs";
import { documentText } from "../lib/document-content";
import { ServiceError } from "../lib/service-error";

export default class DocumentVersionsService extends Service {
  /** 校验文档归属、成员访问权限，以及需要时的编辑权限。 */
  private async access(documentId: number, edit = false) {
    const document = await this.app.chatDb.CloudDocument.findOne({
      where: {
        id: documentId,
        companyId: this.ctx.currentUser.companyId,
        trashedAt: null,
      },
    });
    const member = await this.app.chatDb.CloudDocumentMember.findOne({
      where: { documentId, userId: this.ctx.currentUser.id },
    });
    if (!document || !member)
      throw new ServiceError(
        404,
        "DOCUMENT_NOT_FOUND",
        "文档不存在或你没有访问权限",
      );
    if (edit && member.get("permission") === "viewer")
      throw new ServiceError(403, "DOCUMENT_READ_ONLY", "你只有查看权限");
    return document;
  }

  /** 将版本记录转换为摘要，不向列表暴露完整协作二进制数据。 */
  private async serialize(rows: any[]) {
    const users = await this.app.chatDb.User.findAll({
      where: {
        id: { [Op.in]: rows.map((row) => row.get("authorId")) },
        companyId: this.ctx.currentUser.companyId,
      },
    });
    const names = new Map<number, any>(
      users.map((row: any) => [Number(row.get("id")), row]),
    );
    return rows.map((row) => {
      const author = names.get(Number(row.get("authorId")));
      return {
        id: Number(row.get("id")),
        documentId: Number(row.get("documentId")),
        title: String(row.get("title")),
        label: String(row.get("label")),
        author: {
          id: Number(row.get("authorId")),
          name: String(author?.get("name") || "已停用成员"),
          avatar: String(author?.get("avatar") || ""),
        },
        createdAt: new Date(row.get("createdAt")).toISOString(),
      };
    });
  }

  /** 保存不可变快照；自动保存只在标题或内容确实变化时新增版本。 */
  async saveSnapshot(
    document: any,
    state: Buffer | null,
    authorId: number,
    label: string,
    transaction?: Transaction,
    force = false,
  ) {
    const title = String(document.get("title"));
    const contentHash = createHash("sha256")
      .update(title)
      .update("\0")
      .update(state || Buffer.alloc(0))
      .digest("hex");
    const previous = await this.app.chatDb.CloudDocumentVersion.findOne({
      where: {
        documentId: document.get("id"),
        companyId: document.get("companyId"),
      },
      order: [["id", "DESC"]],
      transaction,
    });
    if (!force && previous?.get("contentHash") === contentHash) return previous;
    return this.app.chatDb.CloudDocumentVersion.create(
      {
        documentId: document.get("id"),
        companyId: document.get("companyId"),
        authorId,
        title,
        label,
        yjsState: state,
        contentHash,
      },
      { transaction },
    );
  }

  /** 列出当前用户可见的全部版本，最近版本优先。 */
  async list(documentId: number) {
    await this.access(documentId);
    const rows = await this.app.chatDb.CloudDocumentVersion.findAll({
      where: { documentId, companyId: this.ctx.currentUser.companyId },
      order: [["id", "DESC"]],
    });
    return this.serialize(rows);
  }

  /** 手工保存当前内容；在线编辑时从协作实例读取最新状态。 */
  async create(documentId: number, input: Record<string, any>) {
    const document = await this.access(documentId, true);
    if (this.app.documentRestores?.has(documentId))
      throw new ServiceError(
        409,
        "DOCUMENT_COLLABORATION_ACTIVE",
        "文档正在恢复，请稍后保存版本",
      );
    const active = this.app.collaborationServer?.hocuspocus.documents.get(
      `document:${documentId}`,
    );
    const state = active
      ? Buffer.from(Y.encodeStateAsUpdate(active))
      : (document.get("yjsState") as Buffer | null);
    const label =
      String(input.label || "手动保存")
        .trim()
        .slice(0, 120) || "手动保存";
    const version = await this.saveSnapshot(
      document,
      state,
      this.ctx.currentUser.id,
      label,
      undefined,
      true,
    );
    const [result] = await this.serialize([version]);
    return result;
  }

  /** 读取指定文档的版本，严格校验版本与文档、企业的关系。 */
  private async version(documentId: number, versionId: number) {
    const row = await this.app.chatDb.CloudDocumentVersion.findOne({
      where: {
        id: versionId,
        documentId,
        companyId: this.ctx.currentUser.companyId,
      },
    });
    if (!row)
      throw new ServiceError(
        404,
        "DOCUMENT_VERSION_NOT_FOUND",
        "文档版本不存在",
      );
    return row;
  }

  /** 返回版本的纯文本预览，支持普通文档和表格。 */
  async preview(documentId: number, versionId: number) {
    await this.access(documentId);
    const version = await this.version(documentId, versionId);
    const [result] = await this.serialize([version]);
    return {
      ...result,
      text: documentText(version.get("yjsState") as Buffer | null),
    };
  }

  /** 在无在线协作或待保存状态时恢复，事务内先备份当前内容，防止数据丢失。 */
  async restore(documentId: number, versionId: number) {
    const document = await this.access(documentId, true);
    const locks = (this.app.documentRestores ??= new Set<number>());
    const instance = this.app.collaborationServer?.hocuspocus;
    const name = `document:${documentId}`;
    if (
      locks.has(documentId) ||
      instance?.documents.has(name) ||
      instance?.loadingDocuments.has(name) ||
      instance?.unloadingDocuments.has(name)
    )
      throw new ServiceError(
        409,
        "DOCUMENT_COLLABORATION_ACTIVE",
        "请所有协作者关闭该文档编辑窗口，等待保存完成后再恢复",
      );
    locks.add(documentId);
    try {
      const version = await this.version(documentId, versionId);
      const transaction = await this.app.chatDb.sequelize.transaction();
      try {
        await document.reload({ transaction });
        await this.saveSnapshot(
          document,
          document.get("yjsState") as Buffer | null,
          this.ctx.currentUser.id,
          "恢复前自动备份",
          transaction,
          true,
        );
        await document.update(
          {
            title: version.get("title"),
            yjsState: version.get("yjsState"),
            lastEditorId: this.ctx.currentUser.id,
          },
          { transaction },
        );
        await this.saveSnapshot(
          document,
          document.get("yjsState") as Buffer | null,
          this.ctx.currentUser.id,
          `恢复版本 #${versionId}`,
          transaction,
          true,
        );
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
      return { documentId, restoredVersionId: versionId };
    } finally {
      locks.delete(documentId);
    }
  }

  /** 将协作保存与历史快照写入同一事务，保留首次更新前的旧内容。 */
  async persistCollaboration(
    documentId: number,
    state: Buffer,
    authorId?: number,
  ) {
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      const document = await this.app.chatDb.CloudDocument.findOne({
        where: { id: documentId, trashedAt: null },
        transaction,
      });
      if (document) {
        const editorId = Number(
          authorId || document.get("lastEditorId") || document.get("ownerId"),
        );
        await this.saveSnapshot(
          document,
          document.get("yjsState") as Buffer | null,
          Number(document.get("lastEditorId") || document.get("ownerId")),
          "更新前版本",
          transaction,
        );
        await document.update(
          { yjsState: state, lastEditorId: editorId },
          { transaction },
        );
        await this.saveSnapshot(
          document,
          state,
          editorId,
          "自动保存",
          transaction,
        );
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}
