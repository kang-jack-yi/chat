import { Service } from "egg";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Op } from "sequelize";
import { publicUser } from "../lib/auth";
import { toPlain } from "../lib/database";
import { createBotMessage } from "../lib/chat";
import { ServiceError } from "../lib/service-error";

const BOT_WINDOW_MS = 60_000;

const BOT_LIMIT = 20;

/** 使用服务端密钥加密机器人密钥。 */
function encodeSecret(app: any, secret: string) {
  const iv = crypto.randomBytes(12);
  const key = crypto
    .createHash("sha256")
    .update(String(app.config.keys))
    .digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

/** 解密并校验已保存的机器人密钥。 */
function decodeSecret(app: any, value: string) {
  const [ivText, tagText, bodyText] = value.split(".");
  const key = crypto
    .createHash("sha256")
    .update(String(app.config.keys))
    .digest();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(bodyText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** 生成高熵随机 Webhook 密钥。 */
function newSecret() {
  return crypto.randomBytes(24).toString("base64url");
}

/** 生成不包含完整密钥的机器人公开资料。 */
function botDto(row: any, creator?: any) {
  const bot = toPlain(row);
  return {
    id: Number(bot.id),
    companyId: Number(bot.companyId),
    conversationId: Number(bot.conversationId),
    name: String(bot.name),
    avatar: String(bot.avatar || bot.name.slice(0, 1) || "机"),
    createdBy: Number(bot.createdBy),
    createdByName: creator?.name,
    secretTail: String(bot.secretTail),
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
  };
}

export default class ConversationBotService extends Service {
  /** 校验当前用户仍属于当前企业中的指定会话。 */
  private async member(conversationId: number) {
    const membership = await this.app.chatDb.ConversationMember.findOne({
      where: { conversationId, userId: this.ctx.currentUser.id, leftAt: null },
    });
    if (!membership) return null;
    return this.app.chatDb.Conversation.findOne({
      where: { id: conversationId, companyId: this.ctx.currentUser.companyId },
    });
  }

  /** 按公开服务地址生成机器人的 Webhook 链接。 */
  private webhookUrl(secret: string, origin: string) {
    origin = process.env.CHAT_PUBLIC_BASE_URL || origin;
    return `${origin.replace(/\/$/, "")}/cgi-bin/webhook/send?key=${encodeURIComponent(secret)}`;
  }

  /** 读取会话机器人列表及创建者资料，不暴露密钥。 */
  async list(resourceId: number) {
    const conversationId = Number(resourceId);
    if (!(await this.member(conversationId)))
      throw new ServiceError(403, "NOT_A_MEMBER", "你不在该会话中");
    const rows = await this.app.chatDb.ConversationBot.findAll({
      where: {
        conversationId,
        companyId: this.ctx.currentUser.companyId,
        deletedAt: null,
      },
      order: [["createdAt", "DESC"]],
    });
    const creatorIds = rows.map((row: any) => Number(row.get("createdBy")));
    const users = creatorIds.length
      ? await this.app.chatDb.User.findAll({ where: { id: creatorIds } })
      : [];
    const creators = new Map(
      users.map((row: any) => [
        Number(row.get("id")),
        publicUser(toPlain(row)),
      ]),
    );
    return rows.map((row: any) =>
      botDto(row, creators.get(Number(row.get("createdBy")))),
    );
  }

  /** 校验会话成员身份并创建机器人和加密密钥。 */
  async create(resourceId: number, input: Record<string, any>, origin: string) {
    const conversationId = Number(resourceId);
    if (!(await this.member(conversationId)))
      throw new ServiceError(403, "NOT_A_MEMBER", "你不在该会话中");
    const name = String(input?.name || "").trim();
    const avatar = String(input?.avatar || name.slice(0, 1) || "机")
      .trim()
      .slice(0, 20);
    if (!name || name.length > 40)
      throw new ServiceError(
        400,
        "INVALID_BOT_NAME",
        "机器人名称应为 1 至 40 个字符",
      );
    const secret = newSecret();
    const row = await this.app.chatDb.ConversationBot.create({
      companyId: this.ctx.currentUser.companyId,
      conversationId,
      name,
      avatar,
      createdBy: this.ctx.currentUser.id,
      secret: encodeSecret(this.app, secret),
      secretTail: secret.slice(-6),
    });
    return {
      ...botDto(row, this.ctx.currentUser),
      webhookUrl: this.webhookUrl(secret, origin),
    };
  }

  /** 校验会话成员身份后读取机器人及 Webhook 链接。 */
  async detail(resourceId: number, targetBotId: number, origin: string) {
    const conversationId = Number(resourceId);
    if (!(await this.member(conversationId)))
      throw new ServiceError(403, "NOT_A_MEMBER", "你不在该会话中");
    const row = await this.app.chatDb.ConversationBot.findOne({
      where: {
        id: Number(targetBotId),
        conversationId,
        companyId: this.ctx.currentUser.companyId,
        deletedAt: null,
      },
    });
    if (!row) throw new ServiceError(404, "BOT_NOT_FOUND", "机器人不存在");
    return {
      ...botDto(row),
      webhookUrl: this.webhookUrl(
        decodeSecret(this.app, String(row.get("secret"))),
        origin,
      ),
    };
  }

  /** 校验机器人名称并更新会话内的机器人资料。 */
  async update(
    resourceId: number,
    targetBotId: number,
    input: Record<string, any>,
  ) {
    const conversationId = Number(resourceId);
    if (!(await this.member(conversationId)))
      throw new ServiceError(403, "NOT_A_MEMBER", "你不在该会话中");
    const row = await this.app.chatDb.ConversationBot.findOne({
      where: {
        id: Number(targetBotId),
        conversationId,
        companyId: this.ctx.currentUser.companyId,
        deletedAt: null,
      },
    });
    if (!row) throw new ServiceError(404, "BOT_NOT_FOUND", "机器人不存在");
    const name = String(input?.name || row.get("name")).trim();
    const avatar = String(input?.avatar || row.get("avatar"))
      .trim()
      .slice(0, 20);
    if (!name || name.length > 40)
      throw new ServiceError(
        400,
        "INVALID_BOT_NAME",
        "机器人名称应为 1 至 40 个字符",
      );
    await row.update({ name, avatar: avatar || name.slice(0, 1) });
    return botDto(row);
  }

  /** 轮换机器人密钥，使原 Webhook 链接失效。 */
  async reset(resourceId: number, targetBotId: number, origin: string) {
    const conversationId = Number(resourceId);
    if (!(await this.member(conversationId)))
      throw new ServiceError(403, "NOT_A_MEMBER", "你不在该会话中");
    const row = await this.app.chatDb.ConversationBot.findOne({
      where: {
        id: Number(targetBotId),
        conversationId,
        companyId: this.ctx.currentUser.companyId,
        deletedAt: null,
      },
    });
    if (!row) throw new ServiceError(404, "BOT_NOT_FOUND", "机器人不存在");
    const secret = newSecret();
    await row.update({
      secret: encodeSecret(this.app, secret),
      secretTail: secret.slice(-6),
    });
    return { ...botDto(row), webhookUrl: this.webhookUrl(secret, origin) };
  }

  /** 软删除会话机器人，使其 Webhook 不再可用。 */
  async remove(resourceId: number, targetBotId: number) {
    const conversationId = Number(resourceId);
    if (!(await this.member(conversationId)))
      throw new ServiceError(403, "NOT_A_MEMBER", "你不在该会话中");
    const row = await this.app.chatDb.ConversationBot.findOne({
      where: {
        id: Number(targetBotId),
        conversationId,
        companyId: this.ctx.currentUser.companyId,
        deletedAt: null,
      },
    });
    if (!row) throw new ServiceError(404, "BOT_NOT_FOUND", "机器人不存在");
    await row.update({ deletedAt: new Date() });
    return true;
  }

  /** 校验 Webhook 密钥和机器人发送频率。 */
  private async resolveWebhookBot(key: string) {
    const secret = key;
    if (!secret)
      throw Object.assign(new Error("缺少 key"), {
        status: 400,
        code: "INVALID_KEY",
      });
    const rows = await this.app.chatDb.ConversationBot.findAll({
      where: { deletedAt: null },
    });
    const row = rows.find((item: any) => {
      try {
        return crypto.timingSafeEqual(
          Buffer.from(decodeSecret(this.app, String(item.get("secret")))),
          Buffer.from(secret),
        );
      } catch {
        return false;
      }
    });
    if (!row)
      throw Object.assign(new Error("Webhook 不存在或已失效"), {
        status: 404,
        code: "INVALID_KEY",
      });
    const count = await this.app.chatDb.Message.count({
      where: {
        senderBotId: row.get("id"),
        createdAt: { [Op.gte]: new Date(Date.now() - BOT_WINDOW_MS) },
      },
    });
    if (count >= BOT_LIMIT)
      throw Object.assign(new Error("消息发送频率超过限制"), {
        status: 429,
        code: "RATE_LIMITED",
      });
    return row;
  }

  /** 校验 Webhook 消息类型和内容，保存消息并通知会话成员。 */
  async sendWebhook(input: Record<string, any>, query: Record<string, any>) {
    const bot = await this.resolveWebhookBot(String(query.key || ""));
    const body = input || {};
    const msgtype = String(body.msgtype || "");
    let parts: any[];
    let attachments: any[] = [];
    if (msgtype === "text") {
      const content = String(body.text?.content || "").trim();
      if (!content || Buffer.byteLength(content) > 2048)
        throw Object.assign(new Error("文本内容不合法"), {
          status: 400,
          code: "INVALID_TEXT",
        });
      parts = [{ type: "text", text: content }];
    } else if (msgtype === "markdown") {
      const content = String(body.markdown?.content || "").trim();
      if (!content || Buffer.byteLength(content) > 4096)
        throw Object.assign(new Error("Markdown 内容不合法"), {
          status: 400,
          code: "INVALID_MARKDOWN",
        });
      parts = [{ type: "markdown", content }];
    } else if (msgtype === "image") {
      const source = Buffer.from(String(body.image?.base64 || ""), "base64");
      const md5 = crypto.createHash("md5").update(source).digest("hex");
      if (
        !source.length ||
        source.length > 2 * 1024 * 1024 ||
        md5 !== String(body.image?.md5 || "").toLowerCase()
      )
        throw Object.assign(new Error("图片格式或 MD5 不正确"), {
          status: 400,
          code: "INVALID_IMAGE",
        });
      const isPng = source
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const isJpeg = source.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
      if (!isPng && !isJpeg)
        throw Object.assign(new Error("仅支持 JPG 或 PNG 图片"), {
          status: 400,
          code: "INVALID_IMAGE",
        });
      const mimeType = isPng ? "image/png" : "image/jpeg";
      const attachment = await this.createBotAttachment(
        bot,
        `${crypto.randomUUID()}.${mimeType === "image/png" ? "png" : "jpg"}`,
        mimeType,
        source,
      );
      attachments = [attachment];
      parts = [
        {
          type: "image",
          attachmentId: Number(attachment.get("id")),
          width: 1,
          height: 1,
        },
      ];
    } else if (msgtype === "file") {
      const media = await this.app.chatDb.BotMedia.findOne({
        where: {
          id: String(body.file?.media_id || ""),
          botId: bot.get("id"),
          expiresAt: { [Op.gt]: new Date() },
        },
      });
      if (!media)
        throw Object.assign(new Error("文件已失效或不属于当前机器人"), {
          status: 400,
          code: "INVALID_MEDIA_ID",
        });
      const attachment = await this.app.chatDb.Attachment.findByPk(
        Number(media.get("attachmentId")),
      );
      if (!attachment)
        throw Object.assign(new Error("文件不存在"), {
          status: 400,
          code: "INVALID_MEDIA_ID",
        });
      attachments = [attachment];
      parts = [{ type: "file", attachmentId: Number(attachment.get("id")) }];
    } else
      throw Object.assign(new Error("不支持的 msgtype"), {
        status: 400,
        code: "UNSUPPORTED_MSGTYPE",
      });
    const message = await createBotMessage(this.app, bot, parts, attachments);
    this.app.io
      ?.of("/")
      ?.to(`conversation:${message.conversationId}`)
      .emit("message:new", message);
    this.app.io
      ?.of("/")
      ?.to(`conversation:${message.conversationId}`)
      .emit("conversation:updated", { conversationId: message.conversationId });
    this.app.io
      ?.of("/")
      ?.to(`conversation:${message.conversationId}`)
      .emit("sync:available", { conversationId: message.conversationId });
    return true;
  }

  /** 保存机器人媒体文件并建立附件记录。 */
  private async createBotAttachment(
    bot: any,
    name: string,
    mimeType: string,
    data: Buffer,
  ) {
    const plain = toPlain(bot);
    const month = new Date().toISOString().slice(0, 7);
    const relativeDir = path.join(
      String(plain.companyId),
      "bots",
      String(plain.id),
      month,
    );
    const dir = path.join(this.app.baseDir, "storage", "uploads", relativeDir);
    await fsp.mkdir(dir, { recursive: true });
    const storedName = `${crypto.randomUUID()}${path.extname(name)}`;
    await fsp.writeFile(path.join(dir, storedName), data);
    return this.app.chatDb.Attachment.create({
      companyId: plain.companyId,
      uploaderId: 0,
      messageId: null,
      originalName: name,
      storedName,
      mimeType,
      size: data.length,
      relativePath: path.join(relativeDir, storedName),
    });
  }

  /** 先校验机器人及媒体类型，再读取限额文件并建立有效期内的媒体标识。 */
  async uploadWebhookMedia(
    query: Record<string, any>,
    getStream: () => Promise<any>,
  ) {
    const bot = await this.resolveWebhookBot(String(query.key || ""));
    if (String(query.type) !== "file")
      throw Object.assign(new Error("仅支持 file"), {
        status: 400,
        code: "INVALID_TYPE",
      });
    const stream: any = await getStream();
    const originalName = path.basename(stream.filename || "file");
    const mimeType = String(stream.mime || "application/octet-stream");
    const chunks: Buffer[] = [];
    let size = 0;
    const collector = new Writable({
      /** 收集媒体数据，在超出 Webhook 文件限额时终止读取。 */
      write(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > 20 * 1024 * 1024) {
          callback(
            Object.assign(new Error("文件超过 20 MB"), {
              status: 413,
              code: "FILE_TOO_LARGE",
            }),
          );
          return;
        }
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    await pipeline(stream, collector);
    const attachment = await this.createBotAttachment(
      bot,
      originalName,
      mimeType,
      Buffer.concat(chunks),
    );
    const mediaId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await this.app.chatDb.BotMedia.create({
      id: mediaId,
      botId: bot.get("id"),
      attachmentId: attachment.get("id"),
      type: "file",
      expiresAt,
    });
    return {
      type: "file",
      mediaId,
      createdAt: Math.floor(Date.now() / 1000),
    };
  }
}
