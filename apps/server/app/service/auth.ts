import { Service } from "egg";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import {
  issueRefreshSession,
  publicUser,
  resolveRefreshSession,
  revokeRefreshSession,
  signAccessToken,
} from "../lib/auth";
import { toPlain } from "../lib/database";
import { appendCompanySyncEvents } from "../lib/sync";
import { ServiceError } from "../lib/service-error";

const PRESENCE_STATUSES = new Set(["available", "busy", "dnd", "away"]);

const AVATAR_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const AVATAR_MAX_SIZE = 2 * 1024 * 1024;

export default class AuthService extends Service {
  /** 通知企业客户端同步最新个人资料。 */
  private notifyProfileChanged() {
    this.app.io
      ?.of("/")
      ?.to(`company:${this.ctx.currentUser.companyId}`)
      .emit("sync:available", {
        companyId: this.ctx.currentUser.companyId,
      });
  }

  /** 补齐部门名称并生成不含敏感字段的个人资料。 */
  private async profilePayload(row: any) {
    const departmentId = Number(row.get("departmentId")) || null;
    const department = departmentId
      ? await this.app.chatDb.Department.findOne({
          where: {
            id: departmentId,
            companyId: this.ctx.currentUser.companyId,
          },
        })
      : null;
    return publicUser(
      toPlain(row),
      department ? String(department.get("name")) : undefined,
    );
  }

  /** 在同一事务中更新个人资料和联系人同步事件，提交后通知客户端。 */
  private async updateProfileAndSync(
    row: any,
    values: Record<string, unknown>,
  ) {
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      await row.update(values, { transaction });
      const payload = await this.profilePayload(row);
      await appendCompanySyncEvents(
        this.app,
        {
          companyId: this.ctx.currentUser.companyId,
          type: "contact.upsert",
          entityId: String(row.get("id")),
          version: Date.now(),
          payload,
        },
        transaction,
      );
      await transaction.commit();
      this.notifyProfileChanged();
      return payload;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /** 校验注册信息并创建企业、部门和所有者，签发登录会话。 */
  async companyRegister(input: Record<string, any>, deviceId: string) {
    const { app } = this;
    const { companyName, name, phone, password } = input || {};
    if (
      !companyName?.trim() ||
      !name?.trim() ||
      !/^1\d{10}$/.test(phone || "") ||
      String(password || "").length < 6
    ) {
      throw new ServiceError(
        400,
        "INVALID_INPUT",
        "请填写企业名称、姓名、正确手机号和至少 6 位密码",
      );
    }
    if (await app.chatDb.User.findOne({ where: { phone } })) {
      throw new ServiceError(409, "PHONE_EXISTS", "该手机号已被使用");
    }
    const transaction = await app.chatDb.sequelize.transaction();
    try {
      const code = `CO${Date.now().toString(36).toUpperCase()}`;
      const company = await app.chatDb.Company.create(
        { name: companyName.trim(), code, ownerId: null },
        { transaction },
      );
      const department = await app.chatDb.Department.create(
        {
          companyId: company.get("id"),
          parentId: null,
          name: companyName.trim(),
          sortOrder: 0,
        },
        { transaction },
      );
      const user = await app.chatDb.User.create(
        {
          companyId: company.get("id"),
          departmentId: department.get("id"),
          phone,
          passwordHash: await bcrypt.hash(password, 10),
          name: name.trim(),
          title: "企业所有者",
          avatar: name.trim().slice(0, 1),
          role: "owner",
          status: "active",
        },
        { transaction },
      );
      await company.update({ ownerId: user.get("id") }, { transaction });
      await transaction.commit();
      const plainUser = toPlain(user);
      const refreshToken = await issueRefreshSession(app, deviceId, plainUser);
      return {
        data: {
          user: publicUser(plainUser, companyName.trim()),
          company: toPlain(company),
          accessToken: signAccessToken(app, plainUser),
        },
        refreshToken,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /** 验证账号密码及账号状态，签发访问令牌和刷新会话。 */
  async login(input: Record<string, any>, deviceId: string) {
    const { app } = this;
    const { phone, password } = input || {};
    const row = await app.chatDb.User.findOne({ where: { phone } });
    if (
      !row ||
      !(await bcrypt.compare(
        String(password || ""),
        String(row.get("passwordHash")),
      ))
    ) {
      throw new ServiceError(401, "INVALID_CREDENTIALS", "手机号或密码不正确");
    }
    const user = toPlain(row);
    if (user.status !== "active") {
      throw new ServiceError(
        403,
        "ACCOUNT_DISABLED",
        "该账号已停用，请联系企业管理员",
      );
    }
    const company = toPlain(await app.chatDb.Company.findByPk(user.companyId));
    const department = user.departmentId
      ? toPlain(await app.chatDb.Department.findByPk(user.departmentId))
      : null;
    const refreshToken = await issueRefreshSession(app, deviceId, user);
    return {
      data: {
        user: publicUser(user, department?.name),
        company,
        accessToken: signAccessToken(app, user),
      },
      refreshToken,
    };
  }

  /** 验证并轮换刷新会话，返回新的访问令牌。 */
  async refresh(token: string | undefined, deviceId: string) {
    const { app } = this;
    const oldToken = token;
    const resolved = await resolveRefreshSession(app, oldToken);
    if (!resolved) {
      throw new ServiceError(
        401,
        "REFRESH_TOKEN_INVALID",
        "登录状态已失效，请重新登录",
      );
    }
    await revokeRefreshSession(app, oldToken);
    const refreshToken = await issueRefreshSession(
      app,
      deviceId,
      resolved.user,
    );
    return {
      data: { accessToken: signAccessToken(app, resolved.user) },
      refreshToken,
    };
  }

  /** 撤销当前刷新会话。 */
  async logout(token: string | undefined) {
    await revokeRefreshSession(this.app, token);

    return true;
  }

  /** 读取当前登录用户的企业和部门资料。 */
  async me() {
    const { app } = this;
    const user = this.ctx.currentUser;
    const company = toPlain(await app.chatDb.Company.findByPk(user.companyId));
    const department = user.departmentId
      ? toPlain(await app.chatDb.Department.findByPk(user.departmentId))
      : null;
    return { user: publicUser(user, department?.name), company };
  }

  /** 校验并更新当前用户允许自助修改的资料字段。 */
  async updateProfile(input: Record<string, any>) {
    const { app } = this;
    const body = input || {};
    const name = body.name === undefined ? undefined : String(body.name).trim();
    const email =
      body.email === undefined ? undefined : String(body.email).trim();
    const bio = body.bio === undefined ? undefined : String(body.bio).trim();
    const presenceStatus =
      body.presenceStatus === undefined
        ? undefined
        : String(body.presenceStatus);
    const statusText =
      body.statusText === undefined
        ? undefined
        : String(body.statusText).trim();
    let statusExpiresAt: Date | null | undefined;

    if (name !== undefined && (!name || name.length > 40)) {
      throw new ServiceError(
        400,
        "INVALID_NAME",
        "姓名长度需要在 1 到 40 个字符之间",
      );
    }
    if (
      email !== undefined &&
      (email.length > 120 ||
        (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    ) {
      throw new ServiceError(400, "INVALID_EMAIL", "邮箱格式不正确");
    }
    if (bio !== undefined && bio.length > 300) {
      throw new ServiceError(
        400,
        "BIO_TOO_LONG",
        "个人简介不能超过 300 个字符",
      );
    }
    if (
      presenceStatus !== undefined &&
      !PRESENCE_STATUSES.has(presenceStatus)
    ) {
      throw new ServiceError(400, "INVALID_PRESENCE", "在线状态参数不正确");
    }
    if (statusText !== undefined && statusText.length > 80) {
      throw new ServiceError(
        400,
        "STATUS_TEXT_TOO_LONG",
        "状态说明不能超过 80 个字符",
      );
    }
    if (body.statusExpiresAt !== undefined) {
      if (body.statusExpiresAt === null || body.statusExpiresAt === "") {
        statusExpiresAt = null;
      } else {
        statusExpiresAt = new Date(String(body.statusExpiresAt));
        if (
          !Number.isFinite(statusExpiresAt.getTime()) ||
          statusExpiresAt.getTime() <= Date.now()
        ) {
          throw new ServiceError(
            400,
            "INVALID_STATUS_EXPIRY",
            "状态到期时间必须晚于当前时间",
          );
        }
      }
    }

    const row = await app.chatDb.User.findOne({
      where: {
        id: this.ctx.currentUser.id,
        companyId: this.ctx.currentUser.companyId,
        status: "active",
      },
    });
    if (!row) throw new ServiceError(404, "NOT_FOUND", "账号不存在");
    const payload = await this.updateProfileAndSync(row, {
      ...(name !== undefined ? { name, avatar: name.slice(0, 1) } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(bio !== undefined ? { bio } : {}),
      ...(presenceStatus !== undefined ? { presenceStatus } : {}),
      ...(statusText !== undefined ? { statusText } : {}),
      ...(statusExpiresAt !== undefined ? { statusExpiresAt } : {}),
    });
    return payload;
  }

  /** 校验头像类型和大小，保存新头像并同步资料，失败时清理新文件。 */
  async uploadAvatar(getStream: () => Promise<any>) {
    const { app } = this;
    const stream: any = await getStream();
    const mimeType = String(stream.mime || "").toLowerCase();
    const extension = AVATAR_EXTENSIONS[mimeType];
    if (!extension) {
      stream.destroy();
      throw new ServiceError(
        415,
        "INVALID_AVATAR_TYPE",
        "头像仅支持 PNG、JPEG 或 WebP 格式",
      );
    }
    const row = await app.chatDb.User.findOne({
      where: {
        id: this.ctx.currentUser.id,
        companyId: this.ctx.currentUser.companyId,
        status: "active",
      },
    });
    if (!row) {
      stream.destroy();
      throw new ServiceError(404, "NOT_FOUND", "账号不存在");
    }

    const relativeDir = path.join(
      String(this.ctx.currentUser.companyId),
      String(this.ctx.currentUser.id),
    );
    const directory = path.join(app.baseDir, "storage", "avatars", relativeDir);
    await fsp.mkdir(directory, { recursive: true });
    const relativePath = path.join(
      relativeDir,
      `${crypto.randomUUID()}${extension}`,
    );
    const absolutePath = path.join(
      app.baseDir,
      "storage",
      "avatars",
      relativePath,
    );
    let size = 0;
    const meter = new Transform({
      /** 累计读取字节，阻止头像超出大小限制。 */
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > AVATAR_MAX_SIZE)
          callback(
            Object.assign(new Error("头像超过大小限制"), {
              code: "AVATAR_TOO_LARGE",
            }),
          );
        else callback(null, chunk);
      },
    });
    try {
      await pipeline(stream, meter, fs.createWriteStream(absolutePath));
    } catch (error: any) {
      await fsp.rm(absolutePath, { force: true });
      if (error.code === "AVATAR_TOO_LARGE")
        throw new ServiceError(413, "AVATAR_TOO_LARGE", "头像不能超过 2 MB");
      throw error;
    }

    const previousPath = row.get("avatarFile")
      ? String(row.get("avatarFile"))
      : "";
    try {
      const payload = await this.updateProfileAndSync(row, {
        avatarFile: relativePath,
      });
      if (previousPath) {
        const avatarRoot = path.resolve(app.baseDir, "storage", "avatars");
        const previousAbsolutePath = path.resolve(avatarRoot, previousPath);
        if (previousAbsolutePath.startsWith(`${avatarRoot}${path.sep}`)) {
          await fsp.rm(previousAbsolutePath, { force: true });
        }
      }
      return payload;
    } catch (error) {
      await fsp.rm(absolutePath, { force: true });
      throw error;
    }
  }

  /** 校验企业和头像路径后读取头像，防止访问企业外的文件。 */
  async avatar(resourceId: number) {
    const { app } = this;
    const row = await app.chatDb.User.findOne({
      where: {
        id: Number(resourceId),
        companyId: this.ctx.currentUser.companyId,
      },
    });
    const relativePath = row?.get("avatarFile")
      ? String(row.get("avatarFile"))
      : "";
    if (!row || !relativePath)
      throw new ServiceError(404, "AVATAR_NOT_FOUND", "头像不存在");
    const avatarRoot = path.resolve(app.baseDir, "storage", "avatars");
    const absolutePath = path.resolve(avatarRoot, relativePath);
    if (
      !absolutePath.startsWith(`${avatarRoot}${path.sep}`) ||
      !fs.existsSync(absolutePath)
    ) {
      throw new ServiceError(404, "AVATAR_NOT_FOUND", "头像不存在");
    }
    const extension = path.extname(absolutePath).toLowerCase();
    return {
      mimeType:
        extension === ".png"
          ? "image/png"
          : extension === ".webp"
            ? "image/webp"
            : "image/jpeg",
      data: fs.createReadStream(absolutePath),
    };
  }
}
