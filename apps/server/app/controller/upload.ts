import { Controller } from "egg";
import { ok } from "../lib/auth";

export default class UploadController extends Controller {
  /** 接收请求并返回结果；按图片或文件限额保存上传内容，并建立未绑定消息的附件记录。 */
  async upload() {
    const data = await this.service.upload.upload(() =>
      this.ctx.getFileStream(),
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验企业、消息可见性及附件路径后返回下载流。 */
  async download() {
    const result = await this.service.upload.download(
      Number(this.ctx.params.id),
    );
    this.ctx.type = result.mimeType;
    this.ctx.attachment(result.originalName);
    this.ctx.body = result.data;
  }

  /** 接收请求并返回结果；仅允许上传者删除尚未绑定消息的附件及其文件。 */
  async remove() {
    const data = await this.service.upload.remove(Number(this.ctx.params.id));
    ok(this.ctx, data);
  }
}
