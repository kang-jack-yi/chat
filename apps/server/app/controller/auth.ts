import { Controller } from "egg";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
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
import { appendCompanySyncEvents } from "../lib/sync";

const PRESENCE_STATUSES = new Set(["available", "busy", "dnd", "away"]);
const AVATAR_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const AVATAR_MAX_SIZE = 2 * 1024 * 1024;

export default class AuthController extends Controller {
  private notifyProfileChanged() {
    this.app.io?.of("/")?.to(`company:${this.ctx.currentUser.companyId}`).emit("sync:available", {
      companyId: this.ctx.currentUser.companyId,
    });
  }

  private async profilePayload(row: any) {
    const departmentId = Number(row.get("departmentId")) || null;
    const department = departmentId
      ? await this.app.chatDb.Department.findOne({
          where: { id: departmentId, companyId: this.ctx.currentUser.companyId },
        })
      : null;
    return publicUser(toPlain(row), department ? String(department.get("name")) : undefined);
  }

  private async updateProfileAndSync(row: any, values: Record<string, unknown>) {
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      await row.update(values, { transaction });
      const payload = await this.profilePayload(row);
      await appendCompanySyncEvents(this.app, {
        companyId: this.ctx.currentUser.companyId,
        type: "contact.upsert",
        entityId: String(row.get("id")),
        version: Date.now(),
        payload,
      }, transaction);
      await transaction.commit();
      this.notifyProfileChanged();
      return payload;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

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

  async updateProfile() {
    const { ctx, app } = this;
    const body = ctx.request.body || {};
    const name = body.name === undefined ? undefined : String(body.name).trim();
    const email = body.email === undefined ? undefined : String(body.email).trim();
    const bio = body.bio === undefined ? undefined : String(body.bio).trim();
    const presenceStatus = body.presenceStatus === undefined ? undefined : String(body.presenceStatus);
    const statusText = body.statusText === undefined ? undefined : String(body.statusText).trim();
    let statusExpiresAt: Date | null | undefined;

    if (name !== undefined && (!name || name.length > 40)) {
      return fail(ctx, 400, "INVALID_NAME", "姓名长度需要在 1 到 40 个字符之间");
    }
    if (email !== undefined && (email.length > 120 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) {
      return fail(ctx, 400, "INVALID_EMAIL", "邮箱格式不正确");
    }
    if (bio !== undefined && bio.length > 300) {
      return fail(ctx, 400, "BIO_TOO_LONG", "个人简介不能超过 300 个字符");
    }
    if (presenceStatus !== undefined && !PRESENCE_STATUSES.has(presenceStatus)) {
      return fail(ctx, 400, "INVALID_PRESENCE", "在线状态参数不正确");
    }
    if (statusText !== undefined && statusText.length > 80) {
      return fail(ctx, 400, "STATUS_TEXT_TOO_LONG", "状态说明不能超过 80 个字符");
    }
    if (body.statusExpiresAt !== undefined) {
      if (body.statusExpiresAt === null || body.statusExpiresAt === "") {
        statusExpiresAt = null;
      } else {
        statusExpiresAt = new Date(String(body.statusExpiresAt));
        if (!Number.isFinite(statusExpiresAt.getTime()) || statusExpiresAt.getTime() <= Date.now()) {
          return fail(ctx, 400, "INVALID_STATUS_EXPIRY", "状态到期时间必须晚于当前时间");
        }
      }
    }

    const row = await app.chatDb.User.findOne({
      where: { id: ctx.currentUser.id, companyId: ctx.currentUser.companyId, status: "active" },
    });
    if (!row) return fail(ctx, 404, "NOT_FOUND", "账号不存在");
    const payload = await this.updateProfileAndSync(row, {
      ...(name !== undefined ? { name, avatar: name.slice(0, 1) } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(bio !== undefined ? { bio } : {}),
      ...(presenceStatus !== undefined ? { presenceStatus } : {}),
      ...(statusText !== undefined ? { statusText } : {}),
      ...(statusExpiresAt !== undefined ? { statusExpiresAt } : {}),
    });
    ok(ctx, payload);
  }

  async uploadAvatar() {
    const { ctx, app } = this;
    const stream: any = await ctx.getFileStream();
    const mimeType = String(stream.mime || "").toLowerCase();
    const extension = AVATAR_EXTENSIONS[mimeType];
    if (!extension) {
      stream.destroy();
      return fail(ctx, 415, "INVALID_AVATAR_TYPE", "头像仅支持 PNG、JPEG 或 WebP 格式");
    }
    const row = await app.chatDb.User.findOne({
      where: { id: ctx.currentUser.id, companyId: ctx.currentUser.companyId, status: "active" },
    });
    if (!row) {
      stream.destroy();
      return fail(ctx, 404, "NOT_FOUND", "账号不存在");
    }

    const relativeDir = path.join(String(ctx.currentUser.companyId), String(ctx.currentUser.id));
    const directory = path.join(app.baseDir, "storage", "avatars", relativeDir);
    await fsp.mkdir(directory, { recursive: true });
    const relativePath = path.join(relativeDir, `${crypto.randomUUID()}${extension}`);
    const absolutePath = path.join(app.baseDir, "storage", "avatars", relativePath);
    let size = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > AVATAR_MAX_SIZE) callback(Object.assign(new Error("头像超过大小限制"), { code: "AVATAR_TOO_LARGE" }));
        else callback(null, chunk);
      },
    });
    try {
      await pipeline(stream, meter, fs.createWriteStream(absolutePath));
    } catch (error: any) {
      await fsp.rm(absolutePath, { force: true });
      if (error.code === "AVATAR_TOO_LARGE") return fail(ctx, 413, "AVATAR_TOO_LARGE", "头像不能超过 2 MB");
      throw error;
    }

    const previousPath = row.get("avatarFile") ? String(row.get("avatarFile")) : "";
    try {
      const payload = await this.updateProfileAndSync(row, { avatarFile: relativePath });
      if (previousPath) {
        const avatarRoot = path.resolve(app.baseDir, "storage", "avatars");
        const previousAbsolutePath = path.resolve(avatarRoot, previousPath);
        if (previousAbsolutePath.startsWith(`${avatarRoot}${path.sep}`)) {
          await fsp.rm(previousAbsolutePath, { force: true });
        }
      }
      ok(ctx, payload);
    } catch (error) {
      await fsp.rm(absolutePath, { force: true });
      throw error;
    }
  }

  async avatar() {
    const { ctx, app } = this;
    const row = await app.chatDb.User.findOne({
      where: { id: Number(ctx.params.id), companyId: ctx.currentUser.companyId },
    });
    const relativePath = row?.get("avatarFile") ? String(row.get("avatarFile")) : "";
    if (!row || !relativePath) return fail(ctx, 404, "AVATAR_NOT_FOUND", "头像不存在");
    const avatarRoot = path.resolve(app.baseDir, "storage", "avatars");
    const absolutePath = path.resolve(avatarRoot, relativePath);
    if (!absolutePath.startsWith(`${avatarRoot}${path.sep}`) || !fs.existsSync(absolutePath)) {
      return fail(ctx, 404, "AVATAR_NOT_FOUND", "头像不存在");
    }
    const extension = path.extname(absolutePath).toLowerCase();
    ctx.type = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
    ctx.set("Cache-Control", "private, max-age=86400");
    ctx.body = fs.createReadStream(absolutePath);
  }
}
