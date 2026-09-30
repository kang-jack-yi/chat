import { Controller } from "egg";
import { ok, refreshCookie, setRefreshCookie } from "../lib/auth";
import { ServiceError } from "../lib/service-error";

export default class AuthController extends Controller {
  /** 接收请求并返回结果；校验注册信息并创建企业、部门和所有者，签发登录会话。 */
  async companyRegister() {
    const result = await this.service.auth.companyRegister(
      this.ctx.request.body || {},
      this.ctx.get("x-desktop-device-id") ||
        this.ctx.get("user-agent") ||
        "desktop",
    );
    setRefreshCookie(this.ctx, result.refreshToken);
    ok(this.ctx, result.data);
  }

  /** 接收请求并返回结果；验证账号密码及账号状态，签发访问令牌和刷新会话。 */
  async login() {
    const result = await this.service.auth.login(
      this.ctx.request.body || {},
      this.ctx.get("x-desktop-device-id") ||
        this.ctx.get("user-agent") ||
        "desktop",
    );
    setRefreshCookie(this.ctx, result.refreshToken);
    ok(this.ctx, result.data);
  }

  /** 接收请求并返回结果；验证并轮换刷新会话，返回新的访问令牌。 */
  async refresh() {
    try {
      const result = await this.service.auth.refresh(
        refreshCookie(this.ctx),
        this.ctx.get("x-desktop-device-id") ||
          this.ctx.get("user-agent") ||
          "desktop",
      );
      setRefreshCookie(this.ctx, result.refreshToken);
      ok(this.ctx, result.data);
    } catch (error) {
      if (
        error instanceof ServiceError &&
        error.code === "REFRESH_TOKEN_INVALID"
      )
        setRefreshCookie(this.ctx, null);
      throw error;
    }
  }

  /** 接收请求并返回结果；撤销当前刷新会话。 */
  async logout() {
    const data = await this.service.auth.logout(refreshCookie(this.ctx));
    setRefreshCookie(this.ctx, null);
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；读取当前登录用户的企业和部门资料。 */
  async me() {
    const data = await this.service.auth.me();
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验并更新当前用户允许自助修改的资料字段。 */
  async updateProfile() {
    const data = await this.service.auth.updateProfile(
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验头像类型和大小，保存新头像并同步资料，失败时清理新文件。 */
  async uploadAvatar() {
    const data = await this.service.auth.uploadAvatar(() =>
      this.ctx.getFileStream(),
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验企业和头像路径后读取头像，防止访问企业外的文件。 */
  async avatar() {
    const result = await this.service.auth.avatar(Number(this.ctx.params.id));
    this.ctx.type = result.mimeType;
    this.ctx.set("Cache-Control", "private, max-age=86400");
    this.ctx.body = result.data;
  }
}
