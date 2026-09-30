import { Controller } from "egg";
import { ok } from "../lib/auth";

export default class ChatController extends Controller {
  /** 接收请求并返回结果；查询当前用户可见会话，并按置顶及最近消息排序。 */
  async list() {
    const data = await this.service.chat.list(this.ctx.query);
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；创建或复用单聊，或在事务中创建群聊及成员并通知客户端。 */
  async create() {
    const data = await this.service.chat.create(this.ctx.request.body || {});
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验成员身份后读取会话详情。 */
  async detail() {
    const data = await this.service.chat.detail(Number(this.ctx.params.id));
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验并更新群资料，在事务中记录系统消息和同步事件。 */
  async update() {
    const data = await this.service.chat.update(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验群主权限并发布群公告，通知会话成员同步。 */
  async publishAnnouncement() {
    const data = await this.service.chat.publishAnnouncement(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；仅允许群主将所有权转移给当前群内的正常成员。 */
  async transferOwner() {
    const data = await this.service.chat.transferOwner(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；仅允许群主解散群聊，事务提交后移除房间并通知成员。 */
  async dissolve() {
    const data = await this.service.chat.dissolve(Number(this.ctx.params.id));
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；邀请企业成员入群，并按约定限制附带历史消息的可见范围。 */
  async addMembers() {
    const data = await this.service.chat.addMembers(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；处理成员主动退出或群主移除成员，更新历史与同步事件。 */
  async removeMember() {
    const data = await this.service.chat.removeMember(
      Number(this.ctx.params.id),
      Number(this.ctx.params.userId),
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；按成员历史权限查询、搜索和分页读取消息，并计算回执数量。 */
  async messages() {
    const data = await this.service.chat.messages(
      Number(this.ctx.params.id),
      this.ctx.query,
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；仅允许发送者查看自己消息的已读及未读成员。 */
  async messageReceipts() {
    const data = await this.service.chat.messageReceipts(
      Number(this.ctx.params.id),
      Number(this.ctx.params.messageId),
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；按请求幂等地转发消息，完成后推送新消息及会话更新。 */
  async forward() {
    const data = await this.service.chat.forward(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；只删除当前账号中的消息视图，不影响其他会话成员。 */
  async deleteForMe() {
    const data = await this.service.chat.deleteForMe(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；按撤回权限和时限撤回消息，并推送撤回与同步事件。 */
  async recall() {
    const data = await this.service.chat.recall(
      Number(this.ctx.params.id),
      Number(this.ctx.params.messageId),
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；单调推进当前成员的已读位置，并按需要清除提及提醒。 */
  async read() {
    const data = await this.service.chat.read(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；更新个人会话设置或清空本账号历史，并记录同步事件。 */
  async settings() {
    const data = await this.service.chat.settings(
      Number(this.ctx.params.id),
      this.ctx.request.body || {},
    );
    ok(this.ctx, data);
  }

  /** 接收请求并返回结果；校验并保存消息，向会话成员推送新消息与同步通知。 */
  async send() {
    const data = await this.service.chat.send(this.ctx.request.body || {});
    ok(this.ctx, data);
  }
}
