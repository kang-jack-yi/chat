import { Controller } from "egg";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fail, ok } from "../lib/auth";
import { toPlain } from "../lib/database";
import { membershipCanAccessMessage } from "../lib/chat";

export default class UploadController extends Controller {
  async upload() {
    const { ctx, app } = this;
    const stream: any = await ctx.getFileStream();
    const originalName = path.basename(stream.filename || "file");
    const mimeType = String(stream.mime || "application/octet-stream");
    const isImage = mimeType.startsWith("image/");
    const maxSize = isImage ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
    const month = new Date().toISOString().slice(0, 7);
    const relativeDir = path.join(String(ctx.currentUser.companyId), month);
    const dir = path.join(app.baseDir, "storage", "uploads", relativeDir);
    await fsp.mkdir(dir, { recursive: true });
    const extension = path.extname(originalName).slice(0, 10);
    const storedName = `${crypto.randomUUID()}${extension}`;
    const absolutePath = path.join(dir, storedName);
    let size = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > maxSize) callback(Object.assign(new Error("文件超过大小限制"), { code: "FILE_TOO_LARGE" }));
        else callback(null, chunk);
      },
    });
    try {
      await pipeline(stream, meter, fs.createWriteStream(absolutePath));
    } catch (error: any) {
      await fsp.rm(absolutePath, { force: true });
      if (error.code === "FILE_TOO_LARGE") return fail(ctx, 413, "FILE_TOO_LARGE", isImage ? "图片不能超过 10 MB" : "文件不能超过 50 MB");
      throw error;
    }
    const row = await app.chatDb.Attachment.create({
      companyId: ctx.currentUser.companyId,
      uploaderId: ctx.currentUser.id,
      messageId: null,
      originalName,
      storedName,
      mimeType,
      size,
      relativePath: path.join(relativeDir, storedName),
    });
    const attachment = toPlain(row);
    ok(ctx, {
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      url: `/api/files/${attachment.id}`,
    });
  }

  async download() {
    const { ctx, app } = this;
    const row = await app.chatDb.Attachment.findOne({
      where: { id: Number(ctx.params.id), companyId: ctx.currentUser.companyId },
    });
    if (!row) return fail(ctx, 404, "NOT_FOUND", "文件不存在");
    const attachment = toPlain(row);
    if (attachment.messageId) {
      const message = await app.chatDb.Message.findByPk(attachment.messageId);
      if (message?.get("deletedAt")) {
        return fail(ctx, 410, "MESSAGE_RECALLED", "消息已撤回，附件不可访问");
      }
      const deletedForCurrentUser = message
        ? await app.chatDb.MessageUserState.findOne({
            where: {
              userId: ctx.currentUser.id,
              messageId: Number(message.get("id")),
            },
          })
        : null;
      if (deletedForCurrentUser) {
        return fail(ctx, 410, "MESSAGE_DELETED_FOR_USER", "消息已从当前账号删除，附件不可访问");
      }
      const member = message ? await app.chatDb.ConversationMember.findOne({
        where: { conversationId: message.get("conversationId"), userId: ctx.currentUser.id, leftAt: null },
      }) : null;
      if (!member || !membershipCanAccessMessage(member, Number(message?.get("id")))) {
        return fail(ctx, 403, "FORBIDDEN", "你无权访问该文件");
      }
    } else if (attachment.uploaderId !== ctx.currentUser.id) {
      return fail(ctx, 403, "FORBIDDEN", "你无权访问该文件");
    }
    const absolutePath = path.resolve(app.baseDir, "storage", "uploads", attachment.relativePath);
    const uploadRoot = path.resolve(app.baseDir, "storage", "uploads");
    if (!absolutePath.startsWith(uploadRoot) || !fs.existsSync(absolutePath)) return fail(ctx, 404, "NOT_FOUND", "文件不存在");
    ctx.type = attachment.mimeType;
    ctx.attachment(attachment.originalName);
    ctx.body = fs.createReadStream(absolutePath);
  }

  async remove() {
    const { ctx, app } = this;
    const id = Number(ctx.params.id);
    const row = await app.chatDb.Attachment.findOne({
      where: {
        id,
        companyId: ctx.currentUser.companyId,
        uploaderId: ctx.currentUser.id,
        messageId: null,
      },
    });
    if (!row) return fail(ctx, 404, "NOT_FOUND", "附件不存在、已使用或无权删除");
    const attachment = toPlain(row);
    const absolutePath = path.resolve(app.baseDir, "storage", "uploads", attachment.relativePath);
    const uploadRoot = path.resolve(app.baseDir, "storage", "uploads");
    if (!absolutePath.startsWith(`${uploadRoot}${path.sep}`)) {
      return fail(ctx, 400, "INVALID_ATTACHMENT_PATH", "附件路径不正确");
    }
    await fsp.rm(absolutePath, { force: true });
    await row.destroy();
    ok(ctx, true);
  }
}
