import { Controller } from "egg";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Op } from "sequelize";
import { fail, ok, publicUser } from "../lib/auth";
import { toPlain } from "../lib/database";
import { createBotMessage } from "../lib/chat";

const BOT_WINDOW_MS = 60_000;
const BOT_LIMIT = 20;

function encodeSecret(app: any, secret: string) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(String(app.config.keys)).digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

function decodeSecret(app: any, value: string) {
  const [ivText, tagText, bodyText] = value.split(".");
  const key = crypto.createHash("sha256").update(String(app.config.keys)).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(bodyText, "base64url")), decipher.final()]).toString("utf8");
}

function newSecret() {
  return crypto.randomBytes(24).toString("base64url");
}

function botDto(row: any, creator?: any) {
  const bot = toPlain(row);
  return {
    id: Number(bot.id), companyId: Number(bot.companyId), conversationId: Number(bot.conversationId),
    name: String(bot.name), avatar: String(bot.avatar || bot.name.slice(0, 1) || "机"),
    createdBy: Number(bot.createdBy), createdByName: creator?.name,
    secretTail: String(bot.secretTail), createdAt: bot.createdAt, updatedAt: bot.updatedAt,
  };
}

export default class ConversationBotController extends Controller {
  private async member(conversationId: number) {
    const membership = await this.app.chatDb.ConversationMember.findOne({
      where: { conversationId, userId: this.ctx.currentUser.id, leftAt: null },
    });
    if (!membership) return null;
    return this.app.chatDb.Conversation.findOne({
      where: { id: conversationId, companyId: this.ctx.currentUser.companyId },
    });
  }

  private webhookUrl(secret: string) {
    const origin = process.env.CHAT_PUBLIC_BASE_URL || `${this.ctx.protocol}://${this.ctx.host}`;
    return `${origin.replace(/\/$/, "")}/cgi-bin/webhook/send?key=${encodeURIComponent(secret)}`;
  }

  async list() {
    const conversationId = Number(this.ctx.params.id);
    if (!(await this.member(conversationId))) return fail(this.ctx, 403, "NOT_A_MEMBER", "你不在该会话中");
    const rows = await this.app.chatDb.ConversationBot.findAll({
      where: { conversationId, companyId: this.ctx.currentUser.companyId, deletedAt: null },
      order: [["createdAt", "DESC"]],
    });
    const creatorIds = rows.map((row: any) => Number(row.get("createdBy")));
    const users = creatorIds.length ? await this.app.chatDb.User.findAll({ where: { id: creatorIds } }) : [];
    const creators = new Map(users.map((row: any) => [Number(row.get("id")), publicUser(toPlain(row))]));
    ok(this.ctx, rows.map((row: any) => botDto(row, creators.get(Number(row.get("createdBy"))))));
  }

  async create() {
    const conversationId = Number(this.ctx.params.id);
    if (!(await this.member(conversationId))) return fail(this.ctx, 403, "NOT_A_MEMBER", "你不在该会话中");
    const name = String(this.ctx.request.body?.name || "").trim();
    const avatar = String(this.ctx.request.body?.avatar || name.slice(0, 1) || "机").trim().slice(0, 20);
    if (!name || name.length > 40) return fail(this.ctx, 400, "INVALID_BOT_NAME", "机器人名称应为 1 至 40 个字符");
    const secret = newSecret();
    const row = await this.app.chatDb.ConversationBot.create({
      companyId: this.ctx.currentUser.companyId, conversationId, name, avatar,
      createdBy: this.ctx.currentUser.id, secret: encodeSecret(this.app, secret), secretTail: secret.slice(-6),
    });
    ok(this.ctx, { ...botDto(row, this.ctx.currentUser), webhookUrl: this.webhookUrl(secret) });
  }

  async detail() {
    const conversationId = Number(this.ctx.params.id);
    if (!(await this.member(conversationId))) return fail(this.ctx, 403, "NOT_A_MEMBER", "你不在该会话中");
    const row = await this.app.chatDb.ConversationBot.findOne({
      where: { id: Number(this.ctx.params.botId), conversationId, companyId: this.ctx.currentUser.companyId, deletedAt: null },
    });
    if (!row) return fail(this.ctx, 404, "BOT_NOT_FOUND", "机器人不存在");
    ok(this.ctx, { ...botDto(row), webhookUrl: this.webhookUrl(decodeSecret(this.app, String(row.get("secret")))) });
  }

  async update() {
    const conversationId = Number(this.ctx.params.id);
    if (!(await this.member(conversationId))) return fail(this.ctx, 403, "NOT_A_MEMBER", "你不在该会话中");
    const row = await this.app.chatDb.ConversationBot.findOne({ where: { id: Number(this.ctx.params.botId), conversationId, companyId: this.ctx.currentUser.companyId, deletedAt: null } });
    if (!row) return fail(this.ctx, 404, "BOT_NOT_FOUND", "机器人不存在");
    const name = String(this.ctx.request.body?.name || row.get("name")).trim();
    const avatar = String(this.ctx.request.body?.avatar || row.get("avatar")).trim().slice(0, 20);
    if (!name || name.length > 40) return fail(this.ctx, 400, "INVALID_BOT_NAME", "机器人名称应为 1 至 40 个字符");
    await row.update({ name, avatar: avatar || name.slice(0, 1) });
    ok(this.ctx, botDto(row));
  }

  async reset() {
    const conversationId = Number(this.ctx.params.id);
    if (!(await this.member(conversationId))) return fail(this.ctx, 403, "NOT_A_MEMBER", "你不在该会话中");
    const row = await this.app.chatDb.ConversationBot.findOne({ where: { id: Number(this.ctx.params.botId), conversationId, companyId: this.ctx.currentUser.companyId, deletedAt: null } });
    if (!row) return fail(this.ctx, 404, "BOT_NOT_FOUND", "机器人不存在");
    const secret = newSecret();
    await row.update({ secret: encodeSecret(this.app, secret), secretTail: secret.slice(-6) });
    ok(this.ctx, { ...botDto(row), webhookUrl: this.webhookUrl(secret) });
  }

  async remove() {
    const conversationId = Number(this.ctx.params.id);
    if (!(await this.member(conversationId))) return fail(this.ctx, 403, "NOT_A_MEMBER", "你不在该会话中");
    const row = await this.app.chatDb.ConversationBot.findOne({ where: { id: Number(this.ctx.params.botId), conversationId, companyId: this.ctx.currentUser.companyId, deletedAt: null } });
    if (!row) return fail(this.ctx, 404, "BOT_NOT_FOUND", "机器人不存在");
    await row.update({ deletedAt: new Date() });
    ok(this.ctx, true);
  }

  private async resolveWebhookBot() {
    const secret = String(this.ctx.query.key || "");
    if (!secret) throw Object.assign(new Error("缺少 key"), { status: 400, code: "INVALID_KEY" });
    const rows = await this.app.chatDb.ConversationBot.findAll({ where: { deletedAt: null } });
    const row = rows.find((item: any) => {
      try { return crypto.timingSafeEqual(Buffer.from(decodeSecret(this.app, String(item.get("secret")))), Buffer.from(secret)); } catch { return false; }
    });
    if (!row) throw Object.assign(new Error("Webhook 不存在或已失效"), { status: 404, code: "INVALID_KEY" });
    const count = await this.app.chatDb.Message.count({
      where: { senderBotId: row.get("id"), createdAt: { [Op.gte]: new Date(Date.now() - BOT_WINDOW_MS) } },
    });
    if (count >= BOT_LIMIT) throw Object.assign(new Error("消息发送频率超过限制"), { status: 429, code: "RATE_LIMITED" });
    return row;
  }

  async sendWebhook() {
    try {
      const bot = await this.resolveWebhookBot();
      const body = this.ctx.request.body || {};
      const msgtype = String(body.msgtype || "");
      let parts: any[];
      let attachments: any[] = [];
      if (msgtype === "text") {
        const content = String(body.text?.content || "").trim();
        if (!content || Buffer.byteLength(content) > 2048) throw Object.assign(new Error("文本内容不合法"), { status: 400, code: "INVALID_TEXT" });
        parts = [{ type: "text", text: content }];
      } else if (msgtype === "markdown") {
        const content = String(body.markdown?.content || "").trim();
        if (!content || Buffer.byteLength(content) > 4096) throw Object.assign(new Error("Markdown 内容不合法"), { status: 400, code: "INVALID_MARKDOWN" });
        parts = [{ type: "markdown", content }];
      } else if (msgtype === "image") {
        const source = Buffer.from(String(body.image?.base64 || ""), "base64");
        const md5 = crypto.createHash("md5").update(source).digest("hex");
        if (!source.length || source.length > 2 * 1024 * 1024 || md5 !== String(body.image?.md5 || "").toLowerCase()) throw Object.assign(new Error("图片格式或 MD5 不正确"), { status: 400, code: "INVALID_IMAGE" });
        const isPng = source.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
        const isJpeg = source.subarray(0, 3).equals(Buffer.from([255,216,255]));
        if (!isPng && !isJpeg) throw Object.assign(new Error("仅支持 JPG 或 PNG 图片"), { status: 400, code: "INVALID_IMAGE" });
        const mimeType = isPng ? "image/png" : "image/jpeg";
        const attachment = await this.createBotAttachment(bot, `${crypto.randomUUID()}.${mimeType === "image/png" ? "png" : "jpg"}`, mimeType, source);
        attachments = [attachment];
        parts = [{ type: "image", attachmentId: Number(attachment.get("id")), width: 1, height: 1 }];
      } else if (msgtype === "file") {
        const media = await this.app.chatDb.BotMedia.findOne({ where: { id: String(body.file?.media_id || ""), botId: bot.get("id"), expiresAt: { [Op.gt]: new Date() } } });
        if (!media) throw Object.assign(new Error("文件已失效或不属于当前机器人"), { status: 400, code: "INVALID_MEDIA_ID" });
        const attachment = await this.app.chatDb.Attachment.findByPk(Number(media.get("attachmentId")));
        if (!attachment) throw Object.assign(new Error("文件不存在"), { status: 400, code: "INVALID_MEDIA_ID" });
        attachments = [attachment]; parts = [{ type: "file", attachmentId: Number(attachment.get("id")) }];
      } else throw Object.assign(new Error("不支持的 msgtype"), { status: 400, code: "UNSUPPORTED_MSGTYPE" });
      const message = await createBotMessage(this.app, bot, parts, attachments);
      this.app.io?.of("/")?.to(`conversation:${message.conversationId}`).emit("message:new", message);
      this.app.io?.of("/")?.to(`conversation:${message.conversationId}`).emit("conversation:updated", { conversationId: message.conversationId });
      this.app.io?.of("/")?.to(`conversation:${message.conversationId}`).emit("sync:available", { conversationId: message.conversationId });
      this.ctx.body = { errcode: 0, errmsg: "ok" };
    } catch (error: any) { this.ctx.status = error.status || 400; this.ctx.body = { errcode: error.code || "SEND_FAILED", errmsg: error.message || "发送失败" }; }
  }

  private async createBotAttachment(bot: any, name: string, mimeType: string, data: Buffer) {
    const plain = toPlain(bot); const month = new Date().toISOString().slice(0, 7);
    const relativeDir = path.join(String(plain.companyId), "bots", String(plain.id), month);
    const dir = path.join(this.app.baseDir, "storage", "uploads", relativeDir);
    await fsp.mkdir(dir, { recursive: true }); const storedName = `${crypto.randomUUID()}${path.extname(name)}`;
    await fsp.writeFile(path.join(dir, storedName), data);
    return this.app.chatDb.Attachment.create({ companyId: plain.companyId, uploaderId: 0, messageId: null, originalName: name, storedName, mimeType, size: data.length, relativePath: path.join(relativeDir, storedName) });
  }

  async uploadWebhookMedia() {
    try {
      const bot = await this.resolveWebhookBot();
      if (String(this.ctx.query.type) !== "file") throw Object.assign(new Error("仅支持 file"), { status: 400, code: "INVALID_TYPE" });
      const stream: any = await this.ctx.getFileStream(); const originalName = path.basename(stream.filename || "file"); const mimeType = String(stream.mime || "application/octet-stream");
      const chunks: Buffer[] = []; let size = 0;
      const collector = new Writable({
        write(chunk, _encoding, callback) {
          size += chunk.length;
          if (size > 20 * 1024 * 1024) {
            callback(Object.assign(new Error("文件超过 20 MB"), { status: 413, code: "FILE_TOO_LARGE" }));
            return;
          }
          chunks.push(Buffer.from(chunk));
          callback();
        },
      });
      await pipeline(stream, collector);
      const attachment = await this.createBotAttachment(bot, originalName, mimeType, Buffer.concat(chunks));
      const mediaId = crypto.randomUUID(); const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      await this.app.chatDb.BotMedia.create({ id: mediaId, botId: bot.get("id"), attachmentId: attachment.get("id"), type: "file", expiresAt });
      this.ctx.body = { errcode: 0, errmsg: "ok", type: "file", media_id: mediaId, created_at: Math.floor(Date.now() / 1000) };
    } catch (error: any) { this.ctx.status = error.status || 400; this.ctx.body = { errcode: error.code || "UPLOAD_FAILED", errmsg: error.message || "上传失败" }; }
  }
}
