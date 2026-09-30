import { Controller } from "egg";
import { ok } from "../lib/auth";

export default class DocumentsController extends Controller {
  /** 返回可访问文档的版本历史。 */
  async versions() {
    ok(
      this.ctx,
      await this.service.documentVersions.list(Number(this.ctx.params.id)),
    );
  }

  /** 为可编辑文档创建命名快照。 */
  async createVersion() {
    ok(
      this.ctx,
      await this.service.documentVersions.create(
        Number(this.ctx.params.id),
        this.ctx.request.body || {},
      ),
    );
  }

  /** 返回指定文档版本的纯文本预览。 */
  async previewVersion() {
    ok(
      this.ctx,
      await this.service.documentVersions.preview(
        Number(this.ctx.params.id),
        Number(this.ctx.params.versionId),
      ),
    );
  }

  /** 恢复指定版本，由业务层执行权限、协作状态校验和备份。 */
  async restoreVersion() {
    ok(
      this.ctx,
      await this.service.documentVersions.restore(
        Number(this.ctx.params.id),
        Number(this.ctx.params.versionId),
      ),
    );
  }

  /** 接收请求并返回结果；校验文档访问权限后按时间读取评论。 */
  async comments() {
    const data = await this.service.documents.comments(
      Number(this.ctx.params.id),
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；在事务中创建评论及成员通知，提交后推送通知。 */
  async createComment() {
    const data = await this.service.documents.createComment(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验作者或编辑权限后更新评论解决状态。 */
  async updateComment() {
    const data = await this.service.documents.updateComment(
      Number(this.ctx.params.id),
      Number(this.ctx.params.commentId),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；按当前用户权限查询最近、我的、共享或收藏文档。 */
  async list() {
    const data = await this.service.documents.list(this.ctx.query);
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验文档类型并创建当前用户拥有的文档。 */
  async create() {
    const data = await this.service.documents.create(
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；限制导入大小并解析本地文件，创建对应的云文档。 */
  async importFile() {
    const data = await this.service.documents.importFile(() =>
      this.ctx.getFileStream(),
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；记录最近打开时间并返回文档及协作连接地址。 */
  async detail() {
    const data = await this.service.documents.detail(
      Number(this.ctx.params.id),
      { hostname: this.ctx.hostname, secure: this.ctx.secure },
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验访问权限并导出 Office 文件及下载元数据。 */
  async download() {
    const result = await this.service.documents.download(
      Number(this.ctx.params.id),
    );
    this.ctx.set("Content-Type", result.mimeType);
    this.ctx.set("Content-Length", String(result.data.length));
    this.ctx.set(
      "Content-Disposition",
      `attachment; filename="${result.fallbackFilename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    );
    this.ctx.body = result.data;
  }

  /** 接收请求并返回结果；按成员权限更新文档资料及个人收藏状态。 */
  async update() {
    const data = await this.service.documents.update(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；仅允许所有者在事务中更新同企业内的共享成员权限。 */
  async share() {
    const data = await this.service.documents.share(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；仅允许文档所有者将文档移入回收状态。 */
  async remove() {
    const data = await this.service.documents.remove(
      Number(this.ctx.params.id),
    );
    ok(this.ctx, data);
  }
}
