import { Controller } from "egg";
import bcrypt from "bcryptjs";
import {
  fail,
  issueRefreshSession,
  ok,
  publicUser,
  refreshCookie,
  resolveRefreshSession,
  resolveSession,
  revokeRefreshSession,
  setRefreshCookie,
  signAccessToken,
} from "../lib/auth";
import { toPlain } from "../lib/database";

export default class AuthController extends Controller {
  async companyRegister() {
    const { ctx, app } = this;
    const { companyName, name, phone, password } = ctx.request.body || {};
    if (!companyName?.trim() || !name?.trim() || !/^1\d{10}$/.test(phone || "") || String(password || "").length < 6) {
      fail(ctx, 400, "INVALID_INPUT", "请填写企业名称、姓名、正确手机号和至少 6 位密码");
      return;
    }
    if (await app.chatDb.User.findOne({ where: { phone } })) {
      fail(ctx, 409, "PHONE_EXISTS", "该手机号已被使用");
      return;
    }
    const transaction = await app.chatDb.sequelize.transaction();
    try {
      const code = `CO${Date.now().toString(36).toUpperCase()}`;
      const company = await app.chatDb.Company.create({ name: companyName.trim(), code, ownerId: null }, { transaction });
      const department = await app.chatDb.Department.create({
        companyId: company.get("id"), parentId: null, name: companyName.trim(), sortOrder: 0,
      }, { transaction });
      const user = await app.chatDb.User.create({
        companyId: company.get("id"),
        departmentId: department.get("id"),
        phone,
        passwordHash: await bcrypt.hash(password, 10),
        name: name.trim(),
        title: "企业所有者",
        avatar: name.trim().slice(0, 1),
        role: "owner",
        status: "active",
      }, { transaction });
      await company.update({ ownerId: user.get("id") }, { transaction });
      await transaction.commit();
      const plainUser = toPlain(user);
      setRefreshCookie(ctx, await issueRefreshSession(app, ctx, plainUser));
      ok(ctx, {
        user: publicUser(plainUser, companyName.trim()),
        company: toPlain(company),
        accessToken: signAccessToken(app, plainUser),
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async login() {
    const { ctx, app } = this;
    const { phone, password } = ctx.request.body || {};
    const row = await app.chatDb.User.findOne({ where: { phone } });
    if (!row || !(await bcrypt.compare(String(password || ""), String(row.get("passwordHash"))))) {
      fail(ctx, 401, "INVALID_CREDENTIALS", "手机号或密码不正确");
      return;
    }
    const user = toPlain(row);
    if (user.status !== "active") {
      fail(ctx, 403, "ACCOUNT_DISABLED", "该账号已停用，请联系企业管理员");
      return;
    }
    const company = toPlain(await app.chatDb.Company.findByPk(user.companyId));
    const department = user.departmentId ? toPlain(await app.chatDb.Department.findByPk(user.departmentId)) : null;
    setRefreshCookie(ctx, await issueRefreshSession(app, ctx, user));
    ok(ctx, {
      user: publicUser(user, department?.name),
      company,
      accessToken: signAccessToken(app, user),
    });
  }

  async refresh() {
    const { ctx, app } = this;
    const oldToken = refreshCookie(ctx);
    const resolved = await resolveRefreshSession(app, oldToken);
    if (!resolved) {
      setRefreshCookie(ctx, null);
      fail(ctx, 401, "REFRESH_TOKEN_INVALID", "登录状态已失效，请重新登录");
      return;
    }
    await revokeRefreshSession(app, oldToken);
    setRefreshCookie(ctx, await issueRefreshSession(app, ctx, resolved.user));
    ok(ctx, { accessToken: signAccessToken(app, resolved.user) });
  }

  async logout() {
    await revokeRefreshSession(this.app, refreshCookie(this.ctx));
    setRefreshCookie(this.ctx, null);
    ok(this.ctx, true);
  }

  async me() {
    const { ctx, app } = this;
    const user = ctx.currentUser;
    const company = toPlain(await app.chatDb.Company.findByPk(user.companyId));
    const department = user.departmentId ? toPlain(await app.chatDb.Department.findByPk(user.departmentId)) : null;
    ok(ctx, { user: publicUser(user, department?.name), company });
  }
}
