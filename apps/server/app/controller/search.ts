import { Controller } from "egg";
import { ok } from "../lib/auth";

export default class SearchController extends Controller {
  /** 接收搜索参数，返回当前用户权限内的统一搜索结果。 */
  async search() {
    ok(this.ctx, await this.service.search.search(this.ctx.query));
  }
}
