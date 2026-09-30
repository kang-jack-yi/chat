import { Controller } from "egg";
import { ok } from "../lib/auth";

export default class ConversationBotController extends Controller {
  /** 接收请求并返回结果；读取会话机器人列表及创建者资料，不暴露密钥。 */
  async list() {
    const data = await this.service.conversationBot.list(
      Number(this.ctx.params.id),
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验会话成员身份并创建机器人和加密密钥。 */
  async create() {
    const data = await this.service.conversationBot.create(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
      `${this.ctx.protocol}://${this.ctx.host}`,
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验会话成员身份后读取机器人及 Webhook 链接。 */
  async detail() {
    const data = await this.service.conversationBot.detail(
      Number(this.ctx.params.id),
      Number(this.ctx.params.botId),
      `${this.ctx.protocol}://${this.ctx.host}`,
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验机器人名称并更新会话内的机器人资料。 */
  async update() {
    const data = await this.service.conversationBot.update(
      Number(this.ctx.params.id),
      Number(this.ctx.params.botId),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；轮换机器人密钥，使原 Webhook 链接失效。 */
  async reset() {
    const data = await this.service.conversationBot.reset(
      Number(this.ctx.params.id),
      Number(this.ctx.params.botId),
      `${this.ctx.protocol}://${this.ctx.host}`,
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；软删除会话机器人，使其 Webhook 不再可用。 */
  async remove() {
    const data = await this.service.conversationBot.remove(
      Number(this.ctx.params.id),
      Number(this.ctx.params.botId),
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验 Webhook 消息类型和内容，保存消息并通知会话成员。 */
  async sendWebhook() {
    try {
      await this.service.conversationBot.sendWebhook(
        this.ctx.request.body || {},
        this.ctx.query,
      );
      this.ctx.body = { errcode: 0, errmsg: "ok" };
    } catch (error: any) {
      this.ctx.status = error.status || 400;
      this.ctx.body = {
        errcode: error.code || "SEND_FAILED",
        errmsg: error.message || "发送失败",
      };
    }
  }

  /** 接收请求并返回结果；先校验机器人及媒体类型，再读取限额文件并建立有效期内的媒体标识。 */
  async uploadWebhookMedia() {
    try {
      const media = await this.service.conversationBot.uploadWebhookMedia(
        this.ctx.query,
        () => this.ctx.getFileStream(),
      );
      this.ctx.body = {
        errcode: 0,
        errmsg: "ok",
        type: media.type,
        media_id: media.mediaId,
        created_at: media.createdAt,
      };
    } catch (error: any) {
      this.ctx.status = error.status || 400;
      this.ctx.body = {
        errcode: error.code || "UPLOAD_FAILED",
        errmsg: error.message || "上传失败",
      };
    }
  }
}
