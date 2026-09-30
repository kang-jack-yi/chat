import { app } from "egg-mock/bootstrap";
import mm from "egg-mock";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { Context } from "egg";
import { ServiceError } from "../../app/lib/service-error";
import { signAccessToken } from "../../app/lib/auth";
import { toPlain } from "../../app/lib/database";

/** 创建独立的登录业务上下文，避免 mockContext 复用当前请求导致用户混用。 */
function context(user: any): Context {
  const ctx = app.createAnonymousContext();
  ctx.currentUser = user;
  return ctx;
}

/** 构造带文件元信息的内存流，用于验证服务的文件处理接口。 */
function fileStream(data: Buffer, filename: string, mime: string) {
  return Object.assign(Readable.from([data]), { filename, mime });
}

/** 同时校验业务错误类型、状态码和原有错误码。 */
function businessError(status: number, code: string) {
  return (error: unknown) =>
    error instanceof ServiceError &&
    error.status === status &&
    error.code === code;
}

describe("Controller / Service 分层回归", () => {
  let owner: any;
  let member: any;
  let other: any;

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

  it("认证 Service 返回会话数据、轮换刷新令牌，并保留设备标识", async () => {
    const ctx = context(owner);
    const result = await ctx.service.auth.login(
      { phone: owner.phone, password: "123456" },
      "service-regression-device",
    );
    assert.equal(result.data.user.id, owner.id);
    assert.ok(result.data.accessToken);
    assert.ok(result.refreshToken);
    assert.equal(ctx.body, undefined);
    const session = await app.chatDb.DesktopRefreshSession.findOne({
      where: {
        userId: owner.id,
        deviceId: "service-regression-device",
        revokedAt: null,
      },
    });
    assert.ok(session);
    const refreshed = await ctx.service.auth.refresh(
      result.refreshToken,
      "service-regression-device",
    );
    assert.notEqual(refreshed.refreshToken, result.refreshToken);
    await assert.rejects(
      ctx.service.auth.refresh(
        result.refreshToken,
        "service-regression-device",
      ),
      businessError(401, "REFRESH_TOKEN_INVALID"),
    );
    await ctx.service.auth.logout(refreshed.refreshToken);
    await assert.rejects(
      ctx.service.auth.refresh(
        refreshed.refreshToken,
        "service-regression-device",
      ),
      businessError(401, "REFRESH_TOKEN_INVALID"),
    );
    await assert.rejects(
      ctx.service.auth.login(
        { phone: owner.phone, password: "wrong-password" },
        "test",
      ),
      businessError(401, "INVALID_CREDENTIALS"),
    );
  });

  it("组织 Service 保留管理员权限和通讯录查询行为", async () => {
    const ctx = context(owner);
    const departments = await ctx.service.organization.departments();
    assert.ok(departments.length);
    assert.ok(
      departments.every((item) => typeof item.memberCount === "number"),
    );
    const contacts = await ctx.service.organization.contacts({
      q: member.phone,
    });
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].id, member.id);
    await assert.rejects(
      context(member).service.organization.updateCompany({ name: "不应保存" }),
      businessError(403, "FORBIDDEN"),
    );
    await assert.rejects(
      ctx.service.organization.setStatus(owner.id, { status: "disabled" }),
      businessError(400, "OWNER_REQUIRED"),
    );
    assert.equal(ctx.body, undefined);
  });

  it("任务 Service 保留创建、完成、重开和删除的权限规则", async () => {
    const ctx = context(owner);
    const task = await ctx.service.tasks.create({
      title: `Service 任务 ${crypto.randomUUID()}`,
      assigneeId: member.id,
    });
    try {
      assert.equal(task.creatorId, owner.id);
      const memberCtx = context(member);
      assert.ok(
        (await memberCtx.service.tasks.list({})).some(
          (item) => item.id === task.id,
        ),
      );
      await assert.rejects(
        context(other).service.tasks.update(task.id, { status: "done" }),
        businessError(403, "FORBIDDEN"),
      );
      const done = await memberCtx.service.tasks.update(task.id, {
        status: "done",
      });
      assert.equal(done.status, "done");
      assert.ok(done.completedAt);
      const reopened = await ctx.service.tasks.update(task.id, {
        status: "todo",
      });
      assert.equal(reopened.completedAt, null);
      await assert.rejects(
        memberCtx.service.tasks.remove(task.id),
        businessError(403, "CREATOR_REQUIRED"),
      );
      assert.equal(ctx.body, undefined);
    } finally {
      await ctx.service.tasks.remove(task.id);
      await app.chatDb.Notification.destroy({ where: { taskId: task.id } });
    }
  });

  it("任务创建失败会回滚任务、通知和同步事件", async () => {
    const ctx = context(owner);
    const title = `rollback-${crypto.randomUUID()}`;
    const eventCount = await app.chatDb.SyncEvent.count();
    mm(app.chatDb.Notification, "create", async () => {
      throw new Error("notification-write-failed");
    });
    try {
      await assert.rejects(
        ctx.service.tasks.create({ title, assigneeId: member.id }),
        /notification-write-failed/,
      );
      assert.equal(await app.chatDb.Task.count({ where: { title } }), 0);
      assert.equal(await app.chatDb.SyncEvent.count(), eventCount);
    } finally {
      await app.mockRestore();
    }
  });

  it("通知 Service 返回数据而不写响应，通知仅能由接收者标记已读", async () => {
    const row = await app.chatDb.Notification.create({
      companyId: owner.companyId,
      recipientUserId: member.id,
      type: "task_assigned",
      title: "Service 通知",
      body: "分层回归",
      entityType: "task",
      entityId: "service-regression",
    });
    try {
      const ctx = context(member);
      const page = await ctx.service.notifications.list({ unreadOnly: "true" });
      assert.ok(page.items.some((item) => item.id === Number(row.get("id"))));
      await assert.rejects(
        context(owner).service.notifications.read(Number(row.get("id"))),
        businessError(404, "NOT_FOUND"),
      );
      const first = await ctx.service.notifications.read(Number(row.get("id")));
      const repeated = await ctx.service.notifications.read(
        Number(row.get("id")),
      );
      assert.equal(repeated.readAt, first.readAt);
      assert.equal(ctx.body, undefined);
    } finally {
      await row.destroy();
    }
  });

  it("文档 Service 保留成员权限，导入和 HTTP 导出仍可使用", async () => {
    const ctx = context(owner);
    const document = await ctx.service.documents.create({
      type: "doc",
      title: "Service 文档",
    });
    let importedId: number | undefined;
    try {
      await ctx.service.documents.share(document.id, {
        members: [{ userId: member.id, permission: "viewer" }],
      });
      await assert.rejects(
        context(member).service.documents.update(document.id, {
          title: "不应保存",
        }),
        businessError(403, "DOCUMENT_READ_ONLY"),
      );
      const exported = await ctx.service.documents.download(document.id);
      assert.equal(exported.data.subarray(0, 2).toString(), "PK");
      const downloaded = await app
        .httpRequest()
        .get(`/api/documents/${document.id}/download`)
        .set("Authorization", `Bearer ${signAccessToken(app, owner)}`)
        .expect(200);
      assert.match(downloaded.headers["content-type"], /wordprocessingml/);
      assert.match(
        downloaded.headers["content-disposition"],
        /filename\*=UTF-8''/,
      );
      const imported = await ctx.service.documents.importFile(async () =>
        fileStream(
          Buffer.from("名称,进度\n测试,完成"),
          "service.csv",
          "text/csv",
        ),
      );
      importedId = imported.id;
      assert.equal(imported.type, "sheet");
      assert.equal(ctx.body, undefined);
    } finally {
      await ctx.service.documents.remove(document.id);
      if (importedId) await ctx.service.documents.remove(importedId);
    }
  });

  it("文档导入和头像上传仍执行原来的大小限制", async () => {
    const ctx = context(owner);
    await assert.rejects(
      ctx.service.documents.importFile(async () =>
        fileStream(
          Buffer.alloc(20 * 1024 * 1024 + 1),
          "oversize.csv",
          "text/csv",
        ),
      ),
      businessError(413, "DOCUMENT_IMPORT_TOO_LARGE"),
    );
    await assert.rejects(
      ctx.service.auth.uploadAvatar(async () =>
        fileStream(
          Buffer.alloc(2 * 1024 * 1024 + 1),
          "oversize.png",
          "image/png",
        ),
      ),
      businessError(413, "AVATAR_TOO_LARGE"),
    );
  });

  it("附件 HTTP 接口保留上传、权限、下载和删除行为", async () => {
    const authorization = `Bearer ${signAccessToken(app, owner)}`;
    const uploaded = await app
      .httpRequest()
      .post("/api/uploads")
      .set("Authorization", authorization)
      .attach("file", Buffer.from("service-upload-content"), {
        filename: "service.txt",
        contentType: "text/plain",
      })
      .expect(200);
    const id = uploaded.body.data.id;
    try {
      const downloaded = await app
        .httpRequest()
        .get(`/api/files/${id}`)
        .set("Authorization", authorization)
        .expect(200);
      assert.equal(downloaded.text, "service-upload-content");
      assert.match(downloaded.headers["content-disposition"], /service\.txt/);
      await app
        .httpRequest()
        .get(`/api/files/${id}`)
        .set("Authorization", `Bearer ${signAccessToken(app, member)}`)
        .expect(403);
    } finally {
      await app
        .httpRequest()
        .delete(`/api/uploads/${id}`)
        .set("Authorization", authorization)
        .expect(200);
    }
    await app
      .httpRequest()
      .get(`/api/files/${id}`)
      .set("Authorization", authorization)
      .expect(404);
  });

  it("机器人 Service 保留密钥轮换，Webhook 文件上传及发送协议不变", async () => {
    const ctx = context(owner);
    const group = (await ctx.service.chat.list({})).find(
      (item) => item.type === "group",
    );
    assert.ok(group);
    const bot = await ctx.service.conversationBot.create(
      group.id,
      { name: "Service 机器人" },
      "http://localhost",
    );
    const key = new URL(bot.webhookUrl).searchParams.get("key")!;
    try {
      const uploaded = await app
        .httpRequest()
        .post(
          `/cgi-bin/webhook/upload_media?key=${encodeURIComponent(key)}&type=file`,
        )
        .attach("file", Buffer.from("webhook-service-file"), {
          filename: "bot.txt",
          contentType: "text/plain",
        })
        .expect(200);
      assert.equal(uploaded.body.errcode, 0);
      assert.ok(uploaded.body.media_id);
      const sent = await app
        .httpRequest()
        .post(`/cgi-bin/webhook/send?key=${encodeURIComponent(key)}`)
        .send({ msgtype: "file", file: { media_id: uploaded.body.media_id } })
        .expect(200);
      assert.deepEqual(sent.body, { errcode: 0, errmsg: "ok" });
      const rotated = await ctx.service.conversationBot.reset(
        group.id,
        bot.id,
        "http://localhost",
      );
      assert.notEqual(rotated.webhookUrl, bot.webhookUrl);
      const rejected = await app
        .httpRequest()
        .post(`/cgi-bin/webhook/send?key=${encodeURIComponent(key)}`)
        .send({ msgtype: "text", text: { content: "旧密钥不应有效" } })
        .expect(404);
      assert.equal(rejected.body.errcode, "INVALID_KEY");
      assert.equal(ctx.body, undefined);
    } finally {
      const attachments = await app.chatDb.Attachment.findAll({
        where: { companyId: owner.companyId, uploaderId: 0 },
      });
      const root = path.resolve(app.baseDir, "storage", "uploads");
      for (const attachment of attachments) {
        const relativePath = String(attachment.get("relativePath"));
        const parts = relativePath.split(/[\\/]/);
        if (parts[1] !== "bots" || Number(parts[2]) !== bot.id) continue;
        const filename = path.resolve(root, relativePath);
        assert.ok(filename.startsWith(`${root}${path.sep}`));
        await fs.rm(filename, { force: true });
        await attachment.destroy();
      }
      await app.chatDb.BotMedia.destroy({ where: { botId: bot.id } });
      await ctx.service.conversationBot.remove(group.id, bot.id);
    }
  });

  it("聊天和同步 Service 返回数据，Socket 复用聊天业务并保留输入状态", async () => {
    const ctx = context(owner);
    const conversations = await ctx.service.chat.list({});
    assert.ok(conversations.length);
    const detail = await ctx.service.chat.detail(conversations[0].id);
    assert.equal(detail.id, conversations[0].id);
    const messages = await ctx.service.chat.messages(detail.id, { limit: "1" });
    assert.ok(Array.isArray(messages.items));
    const bootstrap = await ctx.service.sync.bootstrap();
    assert.ok(bootstrap.users.some((user) => user.id === owner.id));
    assert.ok(Array.isArray(bootstrap.conversations));
    const status = await ctx.service.sync.status();
    const events = await ctx.service.sync.events({
      cursor: String(status.cursor),
      limit: "1",
    });
    assert.equal(events.events.length, 0);
    assert.equal(events.nextCursor, status.cursor);
    await assert.rejects(
      context(undefined).service.chat.sendFromSocket({}),
      businessError(401, "UNAUTHORIZED"),
    );
    assert.deepEqual(
      ctx.service.chat.typing(
        "test-socket",
        { conversationId: detail.id, userId: owner.id, name: owner.name },
        true,
      ),
      {
        conversationId: detail.id,
        userId: owner.id,
        name: owner.name,
        typing: true,
      },
    );
    assert.equal(ctx.service.chat.typing("test-socket", {}, false), undefined);
    assert.equal(ctx.body, undefined);
  });

  it("HTTP 层保留业务错误状态、错误码和清除失效刷新 Cookie 的行为", async () => {
    const response = await app
      .httpRequest()
      .post("/api/tasks")
      .set("Authorization", `Bearer ${signAccessToken(app, owner)}`)
      .send({ title: "" })
      .expect(400);
    assert.deepEqual(response.body, {
      success: false,
      error: {
        code: "INVALID_TITLE",
        message: "任务标题不能为空且不能超过 200 个字符",
      },
    });
    const refreshed = await app
      .httpRequest()
      .post("/api/auth/refresh")
      .expect(401);
    assert.equal(refreshed.body.error.code, "REFRESH_TOKEN_INVALID");
    assert.ok(
      [refreshed.headers["set-cookie"]]
        .flat()
        .some((value: string) => /chat_refresh=;/.test(value)),
    );
  });
});
