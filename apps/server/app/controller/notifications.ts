import { Controller } from "egg";
import { ok } from "../lib/auth";

export default class NotificationsController extends Controller {
  /** 接收请求并返回结果；分页查询当前用户通知并统计总未读数。 */
  async list() {
    const data = await this.service.notifications.list(this.ctx.query);
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；将当前用户的指定通知幂等地标记为已读。 */
  async read() {
    const data = await this.service.notifications.read(
      Number(this.ctx.params.id),
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；批量将当前用户尚未读取的通知标记为已读。 */
  async readAll() {
    const data = await this.service.notifications.readAll();
    ok(this.ctx, data);
  }
}
