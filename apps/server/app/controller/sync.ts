import { Controller } from "egg";
import { ok } from "../lib/auth";

export default class SyncController extends Controller {
  /** 接收请求并返回结果；读取服务器标识、版本和支持的客户端功能。 */
  async health() {
    const data = await this.service.sync.health();
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；读取当前用户的通讯录、会话、近期消息及同步游标快照。 */
  async bootstrap() {
    const data = await this.service.sync.bootstrap();
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验游标有效期并分页读取当前用户的增量同步事件。 */
  async events() {
    const data = await this.service.sync.events(this.ctx.query);
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；读取当前用户同步游标范围和历史同步状态。 */
  async status() {
    const data = await this.service.sync.status();
    ok(this.ctx, data);
  }
}
