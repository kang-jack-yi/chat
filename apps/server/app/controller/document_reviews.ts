import { Controller } from "egg";
import { ok } from "../lib/auth";

export default class DocumentReviewsController extends Controller {
  /** 接收当前用户的评审范围筛选，返回可见评审列表。 */
  async list() {
    ok(this.ctx, await this.service.documentReviews.list(this.ctx.query));
  }

  /** 接收文档标识，返回可用于评审的群聊和成员。 */
  async options() {
    ok(
      this.ctx,
      await this.service.documentReviews.options(Number(this.ctx.params.id)),
    );
  }

  /** 接收提交请求，评审权限、版本和幂等行为由 Service 处理。 */
  async submit() {
    ok(
      this.ctx,
      await this.service.documentReviews.submit(this.ctx.request.body || {}),
    );
  }

  /** 接收评审标识，返回当前用户有权查看的详情。 */
  async detail() {
    ok(
      this.ctx,
      await this.service.documentReviews.detail(Number(this.ctx.params.id)),
    );
  }

  /** 接收审批决定，由 Service 原子处理定案和任务创建。 */
  async decide() {
    ok(
      this.ctx,
      await this.service.documentReviews.decide(
        Number(this.ctx.params.id),
        this.ctx.request.body || {},
      ),
    );
  }
}
