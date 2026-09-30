import { Service } from "egg";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { toPlain } from "../lib/database";
import { membershipCanAccessMessage } from "../lib/chat";
import { ServiceError } from "../lib/service-error";

export default class UploadService extends Service {
  /** 按图片或文件限额保存上传内容，并建立未绑定消息的附件记录。 */
  async upload(getStream: () => Promise<any>) {
    const { app } = this;
    const stream: any = await getStream();
    const originalName = path.basename(stream.filename || "file");
    const mimeType = String(stream.mime || "application/octet-stream");
    const isImage = mimeType.startsWith("image/");
    const maxSize = isImage ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
    const month = new Date().toISOString().slice(0, 7);
    const relativeDir = path.join(
      String(this.ctx.currentUser.companyId),
      month,
    );
    const dir = path.join(app.baseDir, "storage", "uploads", relativeDir);
    await fsp.mkdir(dir, { recursive: true });
    const extension = path.extname(originalName).slice(0, 10);
    const storedName = `${crypto.randomUUID()}${extension}`;
    const absolutePath = path.join(dir, storedName);
    let size = 0;
    const meter = new Transform({
      /** 累计读取字节，阻止上传内容超出对应类型的大小限制。 */
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > maxSize)
          callback(
            Object.assign(new Error("文件超过大小限制"), {
              code: "FILE_TOO_LARGE",
            }),
          );
        else callback(null, chunk);
      },
    });
    try {
      await pipeline(stream, meter, fs.createWriteStream(absolutePath));
    } catch (error: any) {
      await fsp.rm(absolutePath, { force: true });
      if (error.code === "FILE_TOO_LARGE")
        throw new ServiceError(
          413,
          "FILE_TOO_LARGE",
          isImage ? "图片不能超过 10 MB" : "文件不能超过 50 MB",
        );
      throw error;
    }
    const row = await app.chatDb.Attachment.create({
      companyId: this.ctx.currentUser.companyId,
      uploaderId: this.ctx.currentUser.id,
      messageId: null,
      originalName,
      storedName,
      mimeType,
      size,
      relativePath: path.join(relativeDir, storedName),
    });
    const attachment = toPlain(row);
    return {
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      url: `/api/files/${attachment.id}`,
    };
  }

  /** 校验企业、消息可见性及附件路径后返回下载流。 */
  async download(resourceId: number) {
    const { app } = this;
    const row = await app.chatDb.Attachment.findOne({
      where: {
        id: Number(resourceId),
        companyId: this.ctx.currentUser.companyId,
      },
    });
    if (!row) throw new ServiceError(404, "NOT_FOUND", "文件不存在");
    const attachment = toPlain(row);
    if (attachment.messageId) {
      const message = await app.chatDb.Message.findByPk(attachment.messageId);
      if (message?.get("deletedAt")) {
        throw new ServiceError(
          410,
          "MESSAGE_RECALLED",
          "消息已撤回，附件不可访问",
        );
      }
      const deletedForCurrentUser = message
        ? await app.chatDb.MessageUserState.findOne({
            where: {
              userId: this.ctx.currentUser.id,
              messageId: Number(message.get("id")),
            },
          })
        : null;
      if (deletedForCurrentUser) {
        throw new ServiceError(
          410,
          "MESSAGE_DELETED_FOR_USER",
          "消息已从当前账号删除，附件不可访问",
        );
      }
      const member = message
        ? await app.chatDb.ConversationMember.findOne({
            where: {
              conversationId: message.get("conversationId"),
              userId: this.ctx.currentUser.id,
              leftAt: null,
            },
          })
        : null;
      if (
        !member ||
        !membershipCanAccessMessage(member, Number(message?.get("id")))
      ) {
        throw new ServiceError(403, "FORBIDDEN", "你无权访问该文件");
      }
    } else if (attachment.uploaderId !== this.ctx.currentUser.id) {
      throw new ServiceError(403, "FORBIDDEN", "你无权访问该文件");
    }
    const absolutePath = path.resolve(
      app.baseDir,
      "storage",
      "uploads",
      attachment.relativePath,
    );
    const uploadRoot = path.resolve(app.baseDir, "storage", "uploads");
    if (!absolutePath.startsWith(uploadRoot) || !fs.existsSync(absolutePath))
      throw new ServiceError(404, "NOT_FOUND", "文件不存在");
    return {
      mimeType: attachment.mimeType,
      originalName: attachment.originalName,
      data: fs.createReadStream(absolutePath),
    };
  }

  /** 仅允许上传者删除尚未绑定消息的附件及其文件。 */
  async remove(resourceId: number) {
    const { app } = this;
    const id = Number(resourceId);
    const row = await app.chatDb.Attachment.findOne({
      where: {
        id,
        companyId: this.ctx.currentUser.companyId,
        uploaderId: this.ctx.currentUser.id,
        messageId: null,
      },
    });
    if (!row)
      throw new ServiceError(404, "NOT_FOUND", "附件不存在、已使用或无权删除");
    const attachment = toPlain(row);
    const absolutePath = path.resolve(
      app.baseDir,
      "storage",
      "uploads",
      attachment.relativePath,
    );
    const uploadRoot = path.resolve(app.baseDir, "storage", "uploads");
    if (!absolutePath.startsWith(`${uploadRoot}${path.sep}`)) {
      throw new ServiceError(400, "INVALID_ATTACHMENT_PATH", "附件路径不正确");
    }
    await fsp.rm(absolutePath, { force: true });
    await row.destroy();
    return true;
  }
}
