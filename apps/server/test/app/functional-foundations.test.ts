import { app } from "egg-mock/bootstrap";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { randomUUID } from "node:crypto";
import type { Context } from "egg";
import { toPlain } from "../../app/lib/database";
import { ServiceError } from "../../app/lib/service-error";
import { signAccessToken } from "../../app/lib/auth";

/** 创建不复用请求存储的独立用户上下文。 */
function context(user: any): Context {
  const ctx = app.createAnonymousContext();
  ctx.currentUser = user;
  return ctx;
}

/** 构造含格式化文本的文档状态，验证正文搜索不会混入格式标签。 */
function state(text: string): Buffer {
  const document = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph");
  const value = new Y.XmlText();
  value.insert(0, text, { bold: {} });
  paragraph.insert(0, [value]);
  document.getXmlFragment("default").insert(0, [paragraph]);
  const result = Buffer.from(Y.encodeStateAsUpdate(document));
  document.destroy();
  return result;
}

/** 匹配用户可观察的业务错误状态和错误码。 */
function errorCode(status: number, code: string) {
  return (error: unknown) =>
    error instanceof ServiceError &&
    error.status === status &&
    error.code === code;
}

describe("评论线程、统一搜索与文档版本功能闭环", () => {
  let owner: any;
  let member: any;
  let other: any;
  const documents: number[] = [];

  before(async () => {
    owner = toPlain(
      await app.chatDb.User.findOne({ where: { phone: "13800000001" } }),
    );
    member = toPlain(
      await app.chatDb.User.findOne({ where: { phone: "13800000003" } }),
    );
    other = toPlain(
      await app.chatDb.User.findOne({ where: { phone: "13800000004" } }),
    );
  });

  after(async () => {
    for (const documentId of documents) {
      await app.chatDb.Notification.destroy({
        where: { documentId },
        force: true,
      });
      await app.chatDb.CloudDocumentComment.destroy({
        where: { documentId },
        force: true,
      });
      await app.chatDb.CloudDocumentVersion.destroy({
        where: { documentId },
        force: true,
      });
      await app.chatDb.CloudDocumentMember.destroy({
        where: { documentId },
        force: true,
      });
      await app.chatDb.CloudDocument.destroy({
        where: { id: documentId },
        force: true,
      });
    }
  });

  /** 使用业务入口创建测试文档并记录清理对象。 */
  async function create(user: any, title = "版本回归", type = "doc") {
    const document = await context(user).service.documents.create({
      title,
      type,
    });
    documents.push(document.id);
    return document;
  }

  it("回复归属根线程，解决/重开同步全部回复，回复作者不能代替根作者解决", async () => {
    const document = await create(owner);
    await context(owner).service.documents.share(document.id, {
      members: [{ userId: member.id, permission: "viewer" }],
    });
    const root = await context(owner).service.documents.createComment(
      document.id,
      { content: "需要讨论" },
    );
    const reply = await context(member).service.documents.createComment(
      document.id,
      { content: "回复", parentId: root.id },
    );
    const nested = await context(member).service.documents.createComment(
      document.id,
      { content: "继续回复", parentId: reply.id },
    );
    assert.equal(nested.parentId, root.id);
    await assert.rejects(
      context(member).service.documents.updateComment(document.id, reply.id, {
        resolved: true,
      }),
      errorCode(403, "COMMENT_RESOLVE_FORBIDDEN"),
    );
    await context(owner).service.documents.updateComment(
      document.id,
      reply.id,
      { resolved: true },
    );
    assert.ok(
      (await context(owner).service.documents.comments(document.id)).every(
        (item) => item.resolved,
      ),
    );
    await assert.rejects(
      context(member).service.documents.createComment(document.id, {
        content: "已解决后回复",
        parentId: reply.id,
      }),
      errorCode(409, "COMMENT_THREAD_RESOLVED"),
    );
    await context(owner).service.documents.updateComment(document.id, root.id, {
      resolved: false,
    });
    assert.ok(
      (await context(owner).service.documents.comments(document.id)).every(
        (item) => !item.resolved,
      ),
    );
    const latest = await context(member).service.documents.createComment(
      document.id,
      { content: "重开后回复", parentId: root.id },
    );
    assert.equal(latest.parentId, root.id);
    const notifications = await context(owner).service.notifications.list({});
    assert.ok(
      notifications.items.some(
        (item: any) =>
          item.type === "comment" && item.documentId === document.id,
      ),
    );
  });

  it("拒绝跨文档回复目标及无访问权限的评论操作", async () => {
    const first = await create(owner);
    const second = await create(owner);
    const comment = await context(owner).service.documents.createComment(
      first.id,
      { content: "根评论" },
    );
    await assert.rejects(
      context(owner).service.documents.createComment(second.id, {
        content: "跨文档",
        parentId: comment.id,
      }),
      errorCode(400, "INVALID_COMMENT_PARENT"),
    );
    await assert.rejects(
      context(other).service.documents.comments(first.id),
      errorCode(404, "DOCUMENT_NOT_FOUND"),
    );
  });

  it("统一搜索覆盖五类内容、分类与稳定分页，空关键词和非法类型处理正确", async () => {
    const keyword = `闭环${randomUUID().slice(0, 8)}`;
    const ctx = context(owner);
    const document = await create(owner, `${keyword}文档`);
    await ctx.service.documents.share(document.id, {
      members: [{ userId: member.id, permission: "viewer" }],
    });
    await context(member).service.documents.createComment(document.id, {
      content: keyword,
    });
    const task = await ctx.service.tasks.create({
      title: `${keyword}任务`,
      assigneeId: owner.id,
    });
    const conversation = await ctx.service.chat.create({
      type: "group",
      name: `${keyword}讨论`,
      memberIds: [member.id],
    });
    const sent = await ctx.service.chat.send({
      conversationId: conversation.id,
      clientId: randomUUID(),
      schemaVersion: 1,
      parts: [{ type: "text", text: `${keyword}消息` }],
    });
    const user = await ctx.service.organization.createUser({
      name: `${keyword}成员`,
      phone: `139${String(Date.now()).slice(-8)}`,
      password: "123456",
      role: "member",
    });
    try {
      const auth = `Bearer ${signAccessToken(app, owner)}`;
      const all = await app
        .httpRequest()
        .get(`/api/search?q=${encodeURIComponent(keyword)}&limit=100`)
        .set("Authorization", auth)
        .expect(200);
      assert.deepEqual(
        new Set(all.body.data.items.map((item: any) => item.type)),
        new Set(["document", "message", "member", "task", "notification"]),
      );
      assert.ok(
        all.body.data.items.some((item: any) => item.messageId === sent.id),
      );
      const first = await ctx.service.search.search({ q: keyword, limit: 2 });
      const next = await ctx.service.search.search({
        q: keyword,
        limit: 2,
        offset: 2,
      });
      assert.equal(first.items.length, 2);
      assert.equal(first.hasMore, true);
      assert.equal(
        new Set(
          [...first.items, ...next.items].map(
            (item) => `${item.type}:${item.id}`,
          ),
        ).size,
        4,
      );
      assert.ok(
        (
          await ctx.service.search.search({ q: keyword, type: "task" })
        ).items.every((item) => item.type === "task"),
      );
      assert.deepEqual(await ctx.service.search.search({ q: "   " }), {
        items: [],
        total: 0,
        hasMore: false,
      });
      await assert.rejects(
        ctx.service.search.search({ q: keyword, type: "unknown" }),
        errorCode(400, "INVALID_SEARCH_TYPE"),
      );
    } finally {
      await ctx.service.tasks.remove(task.id);
      await ctx.service.chat.dissolve(conversation.id);
      await app.chatDb.User.destroy({ where: { id: user.id }, force: true });
    }
  });

  it("正文搜索能命中标题未包含的内容，私有/回收文档、他人任务通知不能泄露", async () => {
    const keyword = `正文${randomUUID().slice(0, 8)}`;
    const document = await create(owner, "不含关键词的标题");
    await context(owner).service.documentVersions.persistCollaboration(
      document.id,
      state(`段落${keyword}结尾`),
      owner.id,
    );
    const found = await context(owner).service.search.search({
      q: keyword,
      type: "document",
    });
    assert.equal(found.items[0].documentId, document.id);
    assert.match(found.items[0].snippet, new RegExp(keyword));
    assert.ok(!found.items[0].snippet.includes("<bold>"));
    assert.equal(
      (await context(other).service.search.search({ q: keyword })).total,
      0,
    );
    const task = await context(owner).service.tasks.create({
      title: keyword,
      assigneeId: member.id,
    });
    try {
      assert.equal(
        (
          await context(other).service.search.search({
            q: keyword,
            type: "task",
          })
        ).total,
        0,
      );
      assert.equal(
        (
          await context(other).service.search.search({
            q: keyword,
            type: "notification",
          })
        ).total,
        0,
      );
      await context(owner).service.documents.remove(document.id);
      assert.equal(
        (
          await context(owner).service.search.search({
            q: keyword,
            type: "document",
          })
        ).total,
        0,
      );
    } finally {
      await context(owner).service.tasks.remove(task.id);
    }
  });

  it("消息搜索遵循加入后历史、个人删除、清空和退出群聊的可见范围", async () => {
    const keyword = `消息${randomUUID().slice(0, 8)}`;
    const ctx = context(owner);
    const conversation = await ctx.service.chat.create({
      type: "group",
      name: "搜索权限",
      memberIds: [member.id],
    });
    const message = await ctx.service.chat.send({
      conversationId: conversation.id,
      clientId: randomUUID(),
      schemaVersion: 1,
      parts: [{ type: "text", text: keyword }],
    });
    const membership = await app.chatDb.ConversationMember.findOne({
      where: { conversationId: conversation.id, userId: member.id },
    });
    const search = () =>
      context(member).service.search.search({ q: keyword, type: "message" });
    try {
      assert.equal((await search()).total, 1);
      await membership!.update({ historyVisibleAfterMessageId: message.id });
      assert.equal((await search()).total, 0);
      await membership!.update({ invitedHistoryMessageIds: [message.id] });
      assert.equal((await search()).total, 1);
      await context(member).service.chat.deleteForMe(conversation.id, {
        messageIds: [message.id],
      });
      assert.equal((await search()).total, 0);
      await app.chatDb.MessageUserState.destroy({
        where: { userId: member.id, messageId: message.id },
        force: true,
      });
      await membership!.update({ clearedAtMessageId: message.id });
      assert.equal((await search()).total, 0);
      await membership!.update({
        clearedAtMessageId: null,
        leftAt: new Date(),
      });
      assert.equal((await search()).total, 0);
    } finally {
      await ctx.service.chat.dissolve(conversation.id);
    }
  });

  it("自动快照去重，预览/恢复正文标题，恢复前保留备份且历史版本不变", async () => {
    const document = await create(owner, "历史标题");
    const service = context(owner).service.documentVersions;
    await service.persistCollaboration(
      document.id,
      state("初版正文"),
      owner.id,
    );
    const initial = (await service.list(document.id))[0];
    const count = (await service.list(document.id)).length;
    // 重复保存同一个二进制更新，不应生成新的自动版本。
    const row = await app.chatDb.CloudDocument.findByPk(document.id);
    await service.persistCollaboration(
      document.id,
      row!.get("yjsState") as Buffer,
      owner.id,
    );
    assert.equal((await service.list(document.id)).length, count);
    await context(owner).service.documents.update(document.id, {
      title: "当前标题",
    });
    await service.persistCollaboration(
      document.id,
      state("修改后的正文"),
      owner.id,
    );
    const auth = `Bearer ${signAccessToken(app, owner)}`;
    const preview = await app
      .httpRequest()
      .get(`/api/documents/${document.id}/versions/${initial.id}`)
      .set("Authorization", auth)
      .expect(200);
    assert.equal(preview.body.data.text, "初版正文");
    await app
      .httpRequest()
      .post(`/api/documents/${document.id}/versions/${initial.id}/restore`)
      .set("Authorization", auth)
      .expect(200);
    const detail = await context(owner).service.documents.detail(document.id, {
      hostname: "localhost",
      secure: false,
    });
    assert.equal(detail.document.title, "历史标题");
    const versions = await service.list(document.id);
    const backup = versions.find(
      (version) => version.label === "恢复前自动备份",
    )!;
    assert.equal(
      (await service.preview(document.id, backup.id)).text,
      "修改后的正文",
    );
    assert.equal(
      (await service.preview(document.id, initial.id)).text,
      "初版正文",
    );
    const restored = versions[0];
    assert.equal(
      (await service.preview(document.id, restored.id)).text,
      "初版正文",
    );
  });

  it("版本只允许成员读取、编辑者保存恢复，拒绝其他文档的版本", async () => {
    const document = await create(owner);
    const second = await create(owner);
    const service = context(owner).service.documentVersions;
    const version = (await service.list(document.id))[0];
    await context(owner).service.documents.share(document.id, {
      members: [{ userId: member.id, permission: "viewer" }],
    });
    assert.equal(
      (await context(member).service.documentVersions.list(document.id)).length,
      1,
    );
    await assert.rejects(
      context(member).service.documentVersions.create(document.id, {}),
      errorCode(403, "DOCUMENT_READ_ONLY"),
    );
    await assert.rejects(
      context(member).service.documentVersions.restore(document.id, version.id),
      errorCode(403, "DOCUMENT_READ_ONLY"),
    );
    await assert.rejects(
      context(other).service.documentVersions.list(document.id),
      errorCode(404, "DOCUMENT_NOT_FOUND"),
    );
    await assert.rejects(
      service.preview(second.id, version.id),
      errorCode(404, "DOCUMENT_VERSION_NOT_FOUND"),
    );
    await assert.rejects(
      service.restore(second.id, version.id),
      errorCode(404, "DOCUMENT_VERSION_NOT_FOUND"),
    );
  });

  it("跨企业搜索和版本、评论入口不暴露其他企业数据", async () => {
    const keyword = `隔离${randomUUID().slice(0, 8)}`;
    const registered = await app
      .createAnonymousContext()
      .service.auth.companyRegister(
        {
          companyName: keyword,
          name: keyword,
          phone: `137${String(Date.now()).slice(-8)}`,
          password: "123456",
        },
        "search-isolation",
      );
    const foreign = registered.data.user;
    const document = await create(foreign, keyword);
    await context(foreign).service.documentVersions.persistCollaboration(
      document.id,
      state(keyword),
      foreign.id,
    );
    const task = await context(foreign).service.tasks.create({
      title: keyword,
      assigneeId: foreign.id,
    });
    const version = (
      await context(foreign).service.documentVersions.list(document.id)
    )[0];
    try {
      assert.equal(
        (await context(owner).service.search.search({ q: keyword })).total,
        0,
      );
      await assert.rejects(
        context(owner).service.documentVersions.preview(
          document.id,
          version.id,
        ),
        errorCode(404, "DOCUMENT_NOT_FOUND"),
      );
      await assert.rejects(
        context(owner).service.documentVersions.restore(
          document.id,
          version.id,
        ),
        errorCode(404, "DOCUMENT_NOT_FOUND"),
      );
      await assert.rejects(
        context(owner).service.documents.createComment(document.id, {
          content: "禁止",
        }),
        errorCode(404, "DOCUMENT_NOT_FOUND"),
      );
      await app
        .httpRequest()
        .get(`/api/search?q=${encodeURIComponent(keyword)}`)
        .expect(401);
    } finally {
      await context(foreign).service.tasks.remove(task.id);
      await app.chatDb.DesktopRefreshSession.destroy({
        where: { companyId: foreign.companyId },
        force: true,
      });
      await app.chatDb.SyncEvent.destroy({
        where: { companyId: foreign.companyId },
        force: true,
      });
      await app.chatDb.User.destroy({
        where: { companyId: foreign.companyId },
        force: true,
      });
      await app.chatDb.Department.destroy({
        where: { companyId: foreign.companyId },
        force: true,
      });
      await app.chatDb.Company.destroy({
        where: { id: foreign.companyId },
        force: true,
      });
    }
  });
});
