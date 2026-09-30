import { Service } from "egg";
import bcrypt from "bcryptjs";
import { Op } from "sequelize";
import { publicUser } from "../lib/auth";
import { toPlain } from "../lib/database";
import { appendCompanySyncEvents } from "../lib/sync";
import { ServiceError } from "../lib/service-error";

export default class OrganizationService extends Service {
  /** 通知企业客户端同步最新组织数据。 */
  private notifySync() {
    this.app.io
      ?.of("/")
      ?.to(`company:${this.ctx.currentUser.companyId}`)
      .emit("sync:available", {
        companyId: this.ctx.currentUser.companyId,
      });
  }

  /** 读取当前用户所属企业的资料。 */
  async company() {
    const row = await this.app.chatDb.Company.findByPk(
      this.ctx.currentUser.companyId,
    );
    return toPlain(row);
  }

  /** 校验管理员权限并更新企业名称。 */
  async updateCompany(input: Record<string, any>) {
    this.requireAdmin();
    const name = String(input?.name || "").trim();
    if (!name) throw new ServiceError(400, "INVALID_NAME", "企业名称不能为空");
    const company = await this.app.chatDb.Company.findByPk(
      this.ctx.currentUser.companyId,
    );
    await company!.update({ name });
    return toPlain(company);
  }

  /** 查询企业部门并统计各部门的正常成员数量。 */
  async departments() {
    const companyId = this.ctx.currentUser.companyId;
    const rows = await this.app.chatDb.Department.findAll({
      where: { companyId },
      order: [
        ["sortOrder", "ASC"],
        ["id", "ASC"],
      ],
    });
    const users = await this.app.chatDb.User.findAll({
      where: { companyId, status: "active" },
      attributes: ["departmentId"],
    });
    const counts = new Map<number, number>();
    users.forEach((row: any) => {
      const id = Number(row.get("departmentId"));
      counts.set(id, (counts.get(id) || 0) + 1);
    });
    return rows.map((row: any) => {
      const item = toPlain(row);
      return { ...item, memberCount: counts.get(item.id) || 0 };
    });
  }

  /** 校验管理员及上级部门，在事务中创建部门和同步事件。 */
  async createDepartment(input: Record<string, any>) {
    this.requireAdmin();
    const { name, parentId = null, sortOrder = 0 } = input || {};
    if (!String(name || "").trim())
      throw new ServiceError(400, "INVALID_NAME", "部门名称不能为空");
    if (parentId) {
      const parent = await this.app.chatDb.Department.findOne({
        where: { id: parentId, companyId: this.ctx.currentUser.companyId },
      });
      if (!parent)
        throw new ServiceError(400, "INVALID_PARENT", "上级部门不存在");
    }
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      const row = await this.app.chatDb.Department.create(
        {
          companyId: this.ctx.currentUser.companyId,
          parentId,
          name: String(name).trim(),
          sortOrder: Number(sortOrder) || 0,
        },
        { transaction },
      );
      const payload = { ...toPlain(row), memberCount: 0 };
      await appendCompanySyncEvents(
        this.app,
        {
          companyId: this.ctx.currentUser.companyId,
          type: "department.upsert",
          entityId: String(row.get("id")),
          version: Date.now(),
          payload,
        },
        transaction,
      );
      await transaction.commit();
      this.notifySync();
      return payload;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /** 校验管理员权限并在事务中更新部门资料和同步事件。 */
  async updateDepartment(resourceId: number, input: Record<string, any>) {
    this.requireAdmin();
    const row = await this.app.chatDb.Department.findOne({
      where: {
        id: Number(resourceId),
        companyId: this.ctx.currentUser.companyId,
      },
    });
    if (!row) throw new ServiceError(404, "NOT_FOUND", "部门不存在");
    const { name, parentId, sortOrder } = input || {};
    if (Number(parentId) === Number(row.get("id")))
      throw new ServiceError(400, "INVALID_PARENT", "部门不能作为自己的上级");
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      await row.update(
        {
          ...(name !== undefined ? { name: String(name).trim() } : {}),
          ...(parentId !== undefined ? { parentId: parentId || null } : {}),
          ...(sortOrder !== undefined
            ? { sortOrder: Number(sortOrder) || 0 }
            : {}),
        },
        { transaction },
      );
      const payload = toPlain(row);
      await appendCompanySyncEvents(
        this.app,
        {
          companyId: this.ctx.currentUser.companyId,
          type: "department.upsert",
          entityId: String(row.get("id")),
          version: Date.now(),
          payload,
        },
        transaction,
      );
      await transaction.commit();
      this.notifySync();
      return payload;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /** 仅允许管理员删除没有成员或下级的部门，并同步删除状态。 */
  async deleteDepartment(resourceId: number) {
    this.requireAdmin();
    const id = Number(resourceId);
    const companyId = this.ctx.currentUser.companyId;
    const row = await this.app.chatDb.Department.findOne({
      where: { id, companyId },
    });
    if (!row) throw new ServiceError(404, "NOT_FOUND", "部门不存在");
    const [members, children] = await Promise.all([
      this.app.chatDb.User.count({ where: { companyId, departmentId: id } }),
      this.app.chatDb.Department.count({ where: { companyId, parentId: id } }),
    ]);
    if (members || children)
      throw new ServiceError(
        409,
        "DEPARTMENT_NOT_EMPTY",
        "请先迁移部门成员和下级部门",
      );
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      const occurredAt = new Date().toISOString();
      await row.destroy({ transaction });
      await appendCompanySyncEvents(
        this.app,
        {
          companyId,
          type: "department.upsert",
          entityId: String(id),
          version: Date.now(),
          payload: { id, deletedAt: occurredAt },
        },
        transaction,
      );
      await transaction.commit();
      this.notifySync();
      return true;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /** 按企业和关键字查询成员，并补齐部门名称。 */
  async users(query: Record<string, any>) {
    const { app } = this;
    const companyId = this.ctx.currentUser.companyId;
    const q = String(query.q || "").trim();
    const where: any = { companyId };
    if (q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${q}%` } },
        { phone: { [Op.like]: `%${q}%` } },
        { title: { [Op.like]: `%${q}%` } },
      ];
    }
    const [rows, departments] = await Promise.all([
      app.chatDb.User.findAll({
        where,
        order: [
          ["status", "ASC"],
          ["name", "ASC"],
        ],
      }),
      app.chatDb.Department.findAll({ where: { companyId } }),
    ]);
    const depMap = new Map(
      departments.map((d: any) => [Number(d.get("id")), String(d.get("name"))]),
    );
    return rows.map((row: any) => {
      const user = toPlain(row);
      return publicUser(user, depMap.get(user.departmentId));
    });
  }

  /** 校验管理员、成员资料和角色，在事务中创建成员及同步事件。 */
  async createUser(input: Record<string, any>) {
    this.requireAdmin();
    const { app } = this;
    const {
      name,
      phone,
      password,
      departmentId,
      title = "",
      role = "member",
    } = input || {};
    if (
      !String(name || "").trim() ||
      !/^1\d{10}$/.test(phone || "") ||
      String(password || "").length < 6
    ) {
      throw new ServiceError(
        400,
        "INVALID_INPUT",
        "请填写姓名、正确手机号和至少 6 位密码",
      );
    }
    if (role === "owner" || !["admin", "member"].includes(role))
      throw new ServiceError(400, "INVALID_ROLE", "角色设置不正确");
    if (await app.chatDb.User.findOne({ where: { phone } }))
      throw new ServiceError(409, "PHONE_EXISTS", "该手机号已被使用");
    if (
      departmentId &&
      !(await app.chatDb.Department.findOne({
        where: { id: departmentId, companyId: this.ctx.currentUser.companyId },
      }))
    ) {
      throw new ServiceError(400, "INVALID_DEPARTMENT", "所选部门不存在");
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const transaction = await app.chatDb.sequelize.transaction();
    try {
      const row = await app.chatDb.User.create(
        {
          companyId: this.ctx.currentUser.companyId,
          departmentId: departmentId || null,
          phone,
          passwordHash,
          name: String(name).trim(),
          title: String(title).trim(),
          avatar: String(name).trim().slice(0, 1),
          role,
          status: "active",
        },
        { transaction },
      );
      const payload = publicUser(toPlain(row));
      await appendCompanySyncEvents(
        app,
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
      this.notifySync();
      return payload;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /** 按管理员和所有者权限更新成员资料及联系人同步事件。 */
  async updateUser(resourceId: number, input: Record<string, any>) {
    this.requireAdmin();
    const { app } = this;
    const row = await app.chatDb.User.findOne({
      where: {
        id: Number(resourceId),
        companyId: this.ctx.currentUser.companyId,
      },
    });
    if (!row) throw new ServiceError(404, "NOT_FOUND", "成员不存在");
    if (row.get("role") === "owner" && this.ctx.currentUser.role !== "owner")
      throw new ServiceError(
        403,
        "FORBIDDEN",
        "只有企业所有者可以编辑所有者信息",
      );
    const { name, departmentId, title, role } = input || {};
    if (role === "owner" || (role && !["admin", "member"].includes(role)))
      throw new ServiceError(400, "INVALID_ROLE", "角色设置不正确");
    const transaction = await app.chatDb.sequelize.transaction();
    try {
      await row.update(
        {
          ...(name !== undefined
            ? {
                name: String(name).trim(),
                avatar: String(name).trim().slice(0, 1),
              }
            : {}),
          ...(departmentId !== undefined
            ? { departmentId: departmentId || null }
            : {}),
          ...(title !== undefined ? { title: String(title).trim() } : {}),
          ...(role !== undefined && this.ctx.currentUser.role === "owner"
            ? { role }
            : {}),
        },
        { transaction },
      );
      const payload = publicUser(toPlain(row));
      await appendCompanySyncEvents(
        app,
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
      this.notifySync();
      return payload;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /** 校验管理员权限后重置企业成员密码。 */
  async resetPassword(resourceId: number, input: Record<string, any>) {
    this.requireAdmin();
    const password = String(input?.password || "");
    if (password.length < 6)
      throw new ServiceError(400, "INVALID_PASSWORD", "密码至少需要 6 位");
    const row = await this.app.chatDb.User.findOne({
      where: {
        id: Number(resourceId),
        companyId: this.ctx.currentUser.companyId,
      },
    });
    if (!row) throw new ServiceError(404, "NOT_FOUND", "成员不存在");
    await row.update({ passwordHash: await bcrypt.hash(password, 10) });
    return true;
  }

  /** 校验管理员权限并更新成员启停状态，禁止停用所有者。 */
  async setStatus(resourceId: number, input: Record<string, any>) {
    this.requireAdmin();
    const status = input?.status;
    if (!["active", "disabled"].includes(status))
      throw new ServiceError(400, "INVALID_STATUS", "状态参数不正确");
    const row = await this.app.chatDb.User.findOne({
      where: {
        id: Number(resourceId),
        companyId: this.ctx.currentUser.companyId,
      },
    });
    if (!row) throw new ServiceError(404, "NOT_FOUND", "成员不存在");
    if (row.get("role") === "owner")
      throw new ServiceError(400, "OWNER_REQUIRED", "企业所有者账号不能停用");
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      await row.update({ status }, { transaction });
      await appendCompanySyncEvents(
        this.app,
        {
          companyId: this.ctx.currentUser.companyId,
          type: "contact.upsert",
          entityId: String(row.get("id")),
          version: Date.now(),
          payload: publicUser(toPlain(row)),
        },
        transaction,
      );
      await transaction.commit();
      this.notifySync();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    this.app.io
      ?.of("/")
      ?.to(`user:${row.get("id")}`)
      .emit("member:status-changed", { userId: row.get("id"), status });
    return publicUser(toPlain(row));
  }

  /** 按当前企业和关键字返回通讯录成员。 */
  async contacts(query: Record<string, any>) {
    return this.users(query);
  }

  /** 校验当前用户具备企业所有者或管理员权限。 */
  private requireAdmin() {
    if (
      !this.ctx.currentUser ||
      !["owner", "admin"].includes(this.ctx.currentUser.role)
    )
      throw new ServiceError(
        403,
        "FORBIDDEN",
        "仅企业所有者或管理员可以执行此操作",
      );
  }
}
