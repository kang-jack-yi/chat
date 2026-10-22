import { Controller } from "egg";
import { ok } from "../lib/auth";

export default class TasksController extends Controller {
  /** 接收请求并返回结果；按范围和状态查询任务，并补齐创建者及负责人资料。 */
  async list() {
    const data = await this.service.tasks.list(this.ctx.query);
    ok(this.ctx, data);
  }

  /** 返回当前用户有权查看的指定任务，由 Service 校验评审关联权限。 */
  async detail() {
    ok(this.ctx, await this.service.tasks.detail(Number(this.ctx.params.id)));
  }

  /** 接收请求并返回结果；校验任务及关联对象，在事务中创建任务、通知和同步事件。 */
  async create() {
    const data = await this.service.tasks.create(this.ctx.request.body || {});
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；按创建者和负责人权限更新任务，事务内记录通知及完成系统消息。 */
  async update() {
    const data = await this.service.tasks.update(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；仅允许任务创建者删除当前企业内的任务。 */
  async remove() {
    const data = await this.service.tasks.remove(Number(this.ctx.params.id));
    ok(this.ctx, data);
  }
}
