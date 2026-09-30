import { Controller } from "egg";
import { ok } from "../lib/auth";

export default class OrganizationController extends Controller {
  /** 接收请求并返回结果；读取当前用户所属企业的资料。 */
  async company() {
    const data = await this.service.organization.company();
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验管理员权限并更新企业名称。 */
  async updateCompany() {
    const data = await this.service.organization.updateCompany(
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；查询企业部门并统计各部门的正常成员数量。 */
  async departments() {
    const data = await this.service.organization.departments();
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验管理员及上级部门，在事务中创建部门和同步事件。 */
  async createDepartment() {
    const data = await this.service.organization.createDepartment(
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验管理员权限并在事务中更新部门资料和同步事件。 */
  async updateDepartment() {
    const data = await this.service.organization.updateDepartment(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；仅允许管理员删除没有成员或下级的部门，并同步删除状态。 */
  async deleteDepartment() {
    const data = await this.service.organization.deleteDepartment(
      Number(this.ctx.params.id),
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；按企业和关键字查询成员，并补齐部门名称。 */
  async users() {
    const data = await this.service.organization.users(this.ctx.query);
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验管理员、成员资料和角色，在事务中创建成员及同步事件。 */
  async createUser() {
    const data = await this.service.organization.createUser(
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；按管理员和所有者权限更新成员资料及联系人同步事件。 */
  async updateUser() {
    const data = await this.service.organization.updateUser(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验管理员权限后重置企业成员密码。 */
  async resetPassword() {
    const data = await this.service.organization.resetPassword(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验管理员权限并更新成员启停状态，禁止停用所有者。 */
  async setStatus() {
    const data = await this.service.organization.setStatus(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；按当前企业和关键字返回通讯录成员。 */
  async contacts() {
    const data = await this.service.organization.contacts(this.ctx.query);
    ok(this.ctx, data);
  }
}
