import { Controller } from "egg";
import bcrypt from "bcryptjs";
import { Op } from "sequelize";
import { fail, ok, publicUser, requireAdmin } from "../lib/auth";
import { toPlain } from "../lib/database";
import { appendCompanySyncEvents } from "../lib/sync";

export default class OrganizationController extends Controller {
  private notifySync() {
    this.app.io?.of("/")?.to(`company:${this.ctx.currentUser.companyId}`).emit("sync:available", {
      companyId: this.ctx.currentUser.companyId,
    });
  }

  async company() {
    const row = await this.app.chatDb.Company.findByPk(this.ctx.currentUser.companyId);
    ok(this.ctx, toPlain(row));
  }

  async updateCompany() {
    if (!requireAdmin(this.ctx)) return;
    const name = String(this.ctx.request.body?.name || "").trim();
    if (!name) return fail(this.ctx, 400, "INVALID_NAME", "企业名称不能为空");
    const company = await this.app.chatDb.Company.findByPk(this.ctx.currentUser.companyId);
    await company!.update({ name });
    ok(this.ctx, toPlain(company));
  }

  async departments() {
    const companyId = this.ctx.currentUser.companyId;
    const rows = await this.app.chatDb.Department.findAll({ where: { companyId }, order: [["sortOrder", "ASC"], ["id", "ASC"]] });
    const users = await this.app.chatDb.User.findAll({ where: { companyId, status: "active" }, attributes: ["departmentId"] });
    const counts = new Map<number, number>();
    users.forEach((row: any) => {
      const id = Number(row.get("departmentId"));
      counts.set(id, (counts.get(id) || 0) + 1);
    });
    ok(this.ctx, rows.map((row: any) => {
      const item = toPlain(row);
      return { ...item, memberCount: counts.get(item.id) || 0 };
    }));
  }

  async createDepartment() {
    if (!requireAdmin(this.ctx)) return;
    const { name, parentId = null, sortOrder = 0 } = this.ctx.request.body || {};
    if (!String(name || "").trim()) return fail(this.ctx, 400, "INVALID_NAME", "部门名称不能为空");
    if (parentId) {
      const parent = await this.app.chatDb.Department.findOne({ where: { id: parentId, companyId: this.ctx.currentUser.companyId } });
      if (!parent) return fail(this.ctx, 400, "INVALID_PARENT", "上级部门不存在");
    }
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      const row = await this.app.chatDb.Department.create({
        companyId: this.ctx.currentUser.companyId, parentId, name: String(name).trim(), sortOrder: Number(sortOrder) || 0,
      }, { transaction });
      const payload = { ...toPlain(row), memberCount: 0 };
      await appendCompanySyncEvents(this.app, {
        companyId: this.ctx.currentUser.companyId,
        type: "department.upsert",
        entityId: String(row.get("id")),
        version: Date.now(),
        payload,
      }, transaction);
      await transaction.commit();
      this.notifySync();
      ok(this.ctx, payload);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async updateDepartment() {
    if (!requireAdmin(this.ctx)) return;
    const row = await this.app.chatDb.Department.findOne({
      where: { id: Number(this.ctx.params.id), companyId: this.ctx.currentUser.companyId },
    });
    if (!row) return fail(this.ctx, 404, "NOT_FOUND", "部门不存在");
    const { name, parentId, sortOrder } = this.ctx.request.body || {};
    if (Number(parentId) === Number(row.get("id"))) return fail(this.ctx, 400, "INVALID_PARENT", "部门不能作为自己的上级");
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      await row.update({
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(parentId !== undefined ? { parentId: parentId || null } : {}),
        ...(sortOrder !== undefined ? { sortOrder: Number(sortOrder) || 0 } : {}),
      }, { transaction });
      const payload = toPlain(row);
      await appendCompanySyncEvents(this.app, {
        companyId: this.ctx.currentUser.companyId,
        type: "department.upsert",
        entityId: String(row.get("id")),
        version: Date.now(),
        payload,
      }, transaction);
      await transaction.commit();
      this.notifySync();
      ok(this.ctx, payload);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async deleteDepartment() {
    if (!requireAdmin(this.ctx)) return;
    const id = Number(this.ctx.params.id);
    const companyId = this.ctx.currentUser.companyId;
    const row = await this.app.chatDb.Department.findOne({ where: { id, companyId } });
    if (!row) return fail(this.ctx, 404, "NOT_FOUND", "部门不存在");
    const [members, children] = await Promise.all([
      this.app.chatDb.User.count({ where: { companyId, departmentId: id } }),
      this.app.chatDb.Department.count({ where: { companyId, parentId: id } }),
    ]);
    if (members || children) return fail(this.ctx, 409, "DEPARTMENT_NOT_EMPTY", "请先迁移部门成员和下级部门");
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      const occurredAt = new Date().toISOString();
      await row.destroy({ transaction });
      await appendCompanySyncEvents(this.app, {
        companyId,
        type: "department.upsert",
        entityId: String(id),
        version: Date.now(),
        payload: { id, deletedAt: occurredAt },
      }, transaction);
      await transaction.commit();
      this.notifySync();
      ok(this.ctx, true);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async users() {
    const { ctx, app } = this;
    const companyId = ctx.currentUser.companyId;
    const q = String(ctx.query.q || "").trim();
    const where: any = { companyId };
    if (q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${q}%` } },
        { phone: { [Op.like]: `%${q}%` } },
        { title: { [Op.like]: `%${q}%` } },
      ];
    }
    const [rows, departments] = await Promise.all([
      app.chatDb.User.findAll({ where, order: [["status", "ASC"], ["name", "ASC"]] }),
      app.chatDb.Department.findAll({ where: { companyId } }),
    ]);
    const depMap = new Map(departments.map((d: any) => [Number(d.get("id")), String(d.get("name"))]));
    ok(ctx, rows.map((row: any) => {
      const user = toPlain(row);
      return publicUser(user, depMap.get(user.departmentId));
    }));
  }

  async createUser() {
    if (!requireAdmin(this.ctx)) return;
    const { ctx, app } = this;
    const { name, phone, password, departmentId, title = "", role = "member" } = ctx.request.body || {};
    if (!String(name || "").trim() || !/^1\d{10}$/.test(phone || "") || String(password || "").length < 6) {
      return fail(ctx, 400, "INVALID_INPUT", "请填写姓名、正确手机号和至少 6 位密码");
    }
    if (role === "owner" || !["admin", "member"].includes(role)) return fail(ctx, 400, "INVALID_ROLE", "角色设置不正确");
    if (await app.chatDb.User.findOne({ where: { phone } })) return fail(ctx, 409, "PHONE_EXISTS", "该手机号已被使用");
    if (departmentId && !(await app.chatDb.Department.findOne({ where: { id: departmentId, companyId: ctx.currentUser.companyId } }))) {
      return fail(ctx, 400, "INVALID_DEPARTMENT", "所选部门不存在");
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const transaction = await app.chatDb.sequelize.transaction();
    try {
      const row = await app.chatDb.User.create({
        companyId: ctx.currentUser.companyId,
        departmentId: departmentId || null,
        phone,
        passwordHash,
        name: String(name).trim(),
        title: String(title).trim(),
        avatar: String(name).trim().slice(0, 1),
        role,
        status: "active",
      }, { transaction });
      const payload = publicUser(toPlain(row));
      await appendCompanySyncEvents(app, {
        companyId: ctx.currentUser.companyId,
        type: "contact.upsert",
        entityId: String(row.get("id")),
        version: Date.now(),
        payload,
      }, transaction);
      await transaction.commit();
      this.notifySync();
      ok(ctx, payload);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async updateUser() {
    if (!requireAdmin(this.ctx)) return;
    const { ctx, app } = this;
    const row = await app.chatDb.User.findOne({ where: { id: Number(ctx.params.id), companyId: ctx.currentUser.companyId } });
    if (!row) return fail(ctx, 404, "NOT_FOUND", "成员不存在");
    if (row.get("role") === "owner" && ctx.currentUser.role !== "owner") return fail(ctx, 403, "FORBIDDEN", "只有企业所有者可以编辑所有者信息");
    const { name, departmentId, title, role } = ctx.request.body || {};
    if (role === "owner" || (role && !["admin", "member"].includes(role))) return fail(ctx, 400, "INVALID_ROLE", "角色设置不正确");
    const transaction = await app.chatDb.sequelize.transaction();
    try {
      await row.update({
        ...(name !== undefined ? { name: String(name).trim(), avatar: String(name).trim().slice(0, 1) } : {}),
        ...(departmentId !== undefined ? { departmentId: departmentId || null } : {}),
        ...(title !== undefined ? { title: String(title).trim() } : {}),
        ...(role !== undefined && ctx.currentUser.role === "owner" ? { role } : {}),
      }, { transaction });
      const payload = publicUser(toPlain(row));
      await appendCompanySyncEvents(app, {
        companyId: ctx.currentUser.companyId,
        type: "contact.upsert",
        entityId: String(row.get("id")),
        version: Date.now(),
        payload,
      }, transaction);
      await transaction.commit();
      this.notifySync();
      ok(ctx, payload);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async resetPassword() {
    if (!requireAdmin(this.ctx)) return;
    const password = String(this.ctx.request.body?.password || "");
    if (password.length < 6) return fail(this.ctx, 400, "INVALID_PASSWORD", "密码至少需要 6 位");
    const row = await this.app.chatDb.User.findOne({ where: { id: Number(this.ctx.params.id), companyId: this.ctx.currentUser.companyId } });
    if (!row) return fail(this.ctx, 404, "NOT_FOUND", "成员不存在");
    await row.update({ passwordHash: await bcrypt.hash(password, 10) });
    ok(this.ctx, true);
  }

  async setStatus() {
    if (!requireAdmin(this.ctx)) return;
    const status = this.ctx.request.body?.status;
    if (!["active", "disabled"].includes(status)) return fail(this.ctx, 400, "INVALID_STATUS", "状态参数不正确");
    const row = await this.app.chatDb.User.findOne({ where: { id: Number(this.ctx.params.id), companyId: this.ctx.currentUser.companyId } });
    if (!row) return fail(this.ctx, 404, "NOT_FOUND", "成员不存在");
    if (row.get("role") === "owner") return fail(this.ctx, 400, "OWNER_REQUIRED", "企业所有者账号不能停用");
    const transaction = await this.app.chatDb.sequelize.transaction();
    try {
      await row.update({ status }, { transaction });
      await appendCompanySyncEvents(this.app, {
        companyId: this.ctx.currentUser.companyId,
        type: "contact.upsert",
        entityId: String(row.get("id")),
        version: Date.now(),
        payload: publicUser(toPlain(row)),
      }, transaction);
      await transaction.commit();
      this.notifySync();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    this.app.io?.of("/")?.to(`user:${row.get("id")}`).emit("member:status-changed", { userId: row.get("id"), status });
    ok(this.ctx, publicUser(toPlain(row)));
  }

  async contacts() {
    await this.users();
  }
}
