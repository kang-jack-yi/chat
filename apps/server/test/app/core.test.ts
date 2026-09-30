import { app } from "egg-mock/bootstrap";
import assert from "node:assert/strict";
import { Op } from "sequelize";

describe("企业聊天核心接口", () => {
  it("通知中心返回当前用户通知列表和未读数", async () => {
    const login = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);
    const authorization = `Bearer ${login.body.data.accessToken}`;
    const notifications = await app.httpRequest()
      .get("/api/notifications?limit=20")
      .set("Authorization", authorization)
      .expect(200);

    assert.ok(Array.isArray(notifications.body.data.items));
    assert.equal(typeof notifications.body.data.unreadCount, "number");
  });

  it("任务分配和完成会产生按用户隔离的通知，并支持逐条及全部已读", async () => {
    const ownerLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);
    const memberLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000002", password: "123456" })
      .expect(200);
    const ownerAuth = `Bearer ${ownerLogin.body.data.accessToken}`;
    const memberAuth = `Bearer ${memberLogin.body.data.accessToken}`;
    const memberId = memberLogin.body.data.user.id;
    const ownerId = ownerLogin.body.data.user.id;
    const title = `通知任务-${Date.now()}`;

    await app.chatDb.Notification.destroy({ where: { recipientUserId: [memberId, ownerId] } });
    const created = await app.httpRequest()
      .post("/api/tasks")
      .set("Authorization", ownerAuth)
      .send({ title, assigneeId: memberId })
      .expect(200);

    try {
      const memberNotifications = await app.httpRequest()
        .get("/api/notifications?unreadOnly=true")
        .set("Authorization", memberAuth)
        .expect(200);
      const assigned = memberNotifications.body.data.items.find((item: any) => item.taskId === created.body.data.id);
      assert.ok(assigned);
      assert.equal(assigned.type, "task_assigned");
      assert.equal(assigned.readAt, null);
      assert.ok(memberNotifications.body.data.unreadCount >= 1);

      const ownerNotificationsBeforeComplete = await app.httpRequest()
        .get("/api/notifications")
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.equal(ownerNotificationsBeforeComplete.body.data.items.some((item: any) => item.taskId === created.body.data.id), false);

      const read = await app.httpRequest()
        .post(`/api/notifications/${assigned.id}/read`)
        .set("Authorization", memberAuth)
        .expect(200);
      assert.ok(read.body.data.readAt);

      await app.httpRequest()
        .patch(`/api/tasks/${created.body.data.id}`)
        .set("Authorization", memberAuth)
        .send({ status: "done" })
        .expect(200);
      const ownerNotifications = await app.httpRequest()
        .get("/api/notifications?unreadOnly=true")
        .set("Authorization", ownerAuth)
        .expect(200);
      const completed = ownerNotifications.body.data.items.find((item: any) => item.taskId === created.body.data.id);
      assert.ok(completed);
      assert.equal(completed.type, "task_completed");

      const readAll = await app.httpRequest()
        .post("/api/notifications/read-all")
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.ok(readAll.body.data.updatedCount >= 1);
      const ownerAfterReadAll = await app.httpRequest()
        .get("/api/notifications")
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.equal(ownerAfterReadAll.body.data.unreadCount, 0);
    } finally {
      await app.chatDb.Notification.destroy({ where: { taskId: created.body.data.id } });
      await app.chatDb.Task.destroy({ where: { id: created.body.data.id } });
    }
  });

  it("群聊中@成员会生成通知且发送者不会收到自己的提及通知", async () => {
    const ownerLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);
    const memberLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000002", password: "123456" })
      .expect(200);
    const ownerAuth = `Bearer ${ownerLogin.body.data.accessToken}`;
    const memberAuth = `Bearer ${memberLogin.body.data.accessToken}`;
    const memberId = memberLogin.body.data.user.id;
    const ownerId = ownerLogin.body.data.user.id;
    let conversationId = 0;

    await app.chatDb.Notification.destroy({ where: { recipientUserId: [memberId, ownerId] } });
    try {
      const created = await app.httpRequest()
        .post("/api/conversations")
        .set("Authorization", ownerAuth)
        .send({ type: "group", name: `提及通知-${Date.now()}`, memberIds: [memberId] })
        .expect(200);
      conversationId = created.body.data.id;

      const sent = await app.httpRequest()
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", ownerAuth)
        .send({
          conversationId,
          clientId: `mention-notification-${Date.now()}`,
          schemaVersion: 1,
          parts: [
            { type: "text", text: "请关注这个事项" },
            { type: "mention", userId: memberId, label: "错误标签" },
          ],
        })
        .expect(200);
      assert.equal(sent.body.data.parts[1].label, memberLogin.body.data.user.name);

      const memberNotifications = await app.httpRequest()
        .get("/api/notifications?unreadOnly=true")
        .set("Authorization", memberAuth)
        .expect(200);
      const mention = memberNotifications.body.data.items.find((item: any) => item.entityId === String(sent.body.data.id));
      assert.ok(mention);
      assert.equal(mention.type, "mention");
      assert.equal(mention.conversationId, conversationId);

      const ownerNotifications = await app.httpRequest()
        .get("/api/notifications")
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.equal(ownerNotifications.body.data.items.some((item: any) => item.entityId === String(sent.body.data.id)), false);
    } finally {
      if (conversationId) {
        await app.chatDb.Notification.destroy({ where: { conversationId } });
        await app.chatDb.SyncEvent.destroy({ where: { conversationId } });
        await app.chatDb.Message.destroy({ where: { conversationId }, force: true });
        await app.chatDb.ConversationMember.destroy({ where: { conversationId }, force: true });
        await app.chatDb.Conversation.destroy({ where: { id: conversationId }, force: true });
      }
    }
  });

  it("群聊中@所有人会为其他活跃成员分别生成通知", async () => {
    const ownerLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);
    const memberLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000002", password: "123456" })
      .expect(200);
    const thirdLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000003", password: "123456" })
      .expect(200);
    const ownerAuth = `Bearer ${ownerLogin.body.data.accessToken}`;
    const memberAuth = `Bearer ${memberLogin.body.data.accessToken}`;
    const thirdAuth = `Bearer ${thirdLogin.body.data.accessToken}`;
    const recipientIds = [memberLogin.body.data.user.id, thirdLogin.body.data.user.id];
    let conversationId = 0;

    await app.chatDb.Notification.destroy({ where: { recipientUserId: recipientIds } });
    try {
      const created = await app.httpRequest()
        .post("/api/conversations")
        .set("Authorization", ownerAuth)
        .send({ type: "group", name: `全员提及-${Date.now()}`, memberIds: recipientIds })
        .expect(200);
      conversationId = created.body.data.id;
      const sent = await app.httpRequest()
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", ownerAuth)
        .send({
          conversationId,
          clientId: `mention-all-notification-${Date.now()}`,
          schemaVersion: 1,
          parts: [
            { type: "text", text: "请所有人查看" },
            { type: "mention_all", label: "所有人" },
          ],
        })
        .expect(200);

      for (const authorization of [memberAuth, thirdAuth]) {
        const notifications = await app.httpRequest()
          .get("/api/notifications?unreadOnly=true")
          .set("Authorization", authorization)
          .expect(200);
        const mention = notifications.body.data.items.find((item: any) => item.entityId === String(sent.body.data.id));
        assert.ok(mention);
        assert.equal(mention.title, "群聊中有人@了所有人");
      }
    } finally {
      if (conversationId) {
        await app.chatDb.Notification.destroy({ where: { conversationId } });
        await app.chatDb.SyncEvent.destroy({ where: { conversationId } });
        await app.chatDb.Message.destroy({ where: { conversationId }, force: true });
        await app.chatDb.ConversationMember.destroy({ where: { conversationId }, force: true });
        await app.chatDb.Conversation.destroy({ where: { id: conversationId }, force: true });
      }
    }
  });

  it("文档成员可以发表评论、查看并解决评论，同时通知其他成员", async () => {
    const ownerLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);
    const memberLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000002", password: "123456" })
      .expect(200);
    const ownerAuth = `Bearer ${ownerLogin.body.data.accessToken}`;
    const memberAuth = `Bearer ${memberLogin.body.data.accessToken}`;
    let documentId = 0;
    let commentId = 0;

    try {
      const document = await app.httpRequest()
        .post("/api/documents")
        .set("Authorization", ownerAuth)
        .send({ type: "doc", title: `评论测试文档-${Date.now()}` })
        .expect(200);
      documentId = document.body.data.id;
      await app.httpRequest()
        .put(`/api/documents/${documentId}/members`)
        .set("Authorization", ownerAuth)
        .send({ members: [{ userId: memberLogin.body.data.user.id, permission: "editor" }] })
        .expect(200);
      await app.chatDb.Notification.destroy({ where: { recipientUserId: ownerLogin.body.data.user.id } });

      const created = await app.httpRequest()
        .post(`/api/documents/${documentId}/comments`)
        .set("Authorization", memberAuth)
        .send({ anchor: "paragraph:1", content: "请补充这一段的验收标准" })
        .expect(200);
      commentId = created.body.data.id;
      assert.equal(created.body.data.content, "请补充这一段的验收标准");
      assert.equal(created.body.data.anchor, "paragraph:1");
      assert.equal(created.body.data.resolvedAt, null);

      const listed = await app.httpRequest()
        .get(`/api/documents/${documentId}/comments`)
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.ok(listed.body.data.some((item: any) => item.id === commentId && item.authorId === memberLogin.body.data.user.id));

      const ownerNotifications = await app.httpRequest()
        .get("/api/notifications?unreadOnly=true")
        .set("Authorization", ownerAuth)
        .expect(200);
      const notification = ownerNotifications.body.data.items.find((item: any) => item.documentId === documentId);
      assert.ok(notification);
      assert.equal(notification.type, "comment");

      const resolved = await app.httpRequest()
        .patch(`/api/documents/${documentId}/comments/${commentId}`)
        .set("Authorization", ownerAuth)
        .send({ resolved: true })
        .expect(200);
      assert.ok(resolved.body.data.resolvedAt);
      assert.equal(resolved.body.data.resolvedById, ownerLogin.body.data.user.id);

      const afterResolve = await app.httpRequest()
        .get(`/api/documents/${documentId}/comments`)
        .set("Authorization", memberAuth)
        .expect(200);
      assert.equal(afterResolve.body.data.find((item: any) => item.id === commentId).resolved, true);
    } finally {
      const database = app.chatDb as any;
      await database.CloudDocumentComment?.destroy({ where: { documentId }, force: true });
      await database.Notification?.destroy({ where: { recipientUserId: ownerLogin.body.data.user.id } });
      if (documentId) {
        await app.httpRequest()
          .delete(`/api/documents/${documentId}`)
          .set("Authorization", ownerAuth)
          .expect(200);
      }
    }
  });

  it("可以创建任务、按负责人查询并在完成时写入会话系统消息", async () => {
    const login = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);
    const authorization = `Bearer ${login.body.data.accessToken}`;
    const conversations = await app.httpRequest()
      .get("/api/conversations")
      .set("Authorization", authorization)
      .expect(200);
    const conversationId = conversations.body.data[0].id;
    const title = `测试任务-${Date.now()}`;

    const created = await app.httpRequest()
      .post("/api/tasks")
      .set("Authorization", authorization)
      .send({
        title,
        conversationId,
        priority: "high",
        dueAt: "2030-01-02T03:04:05.000Z",
      })
      .expect(200);

    assert.ok(created.body.success);
    assert.equal(created.body.data.title, title);
    assert.equal(created.body.data.status, "todo");
    assert.equal(created.body.data.priority, "high");
    assert.equal(created.body.data.assigneeId, login.body.data.user.id);

    const listed = await app.httpRequest()
      .get("/api/tasks?status=todo")
      .set("Authorization", authorization)
      .expect(200);
    assert.ok(listed.body.data.some((task: any) => task.id === created.body.data.id));

    const completed = await app.httpRequest()
      .patch(`/api/tasks/${created.body.data.id}`)
      .set("Authorization", authorization)
      .send({ status: "done" })
      .expect(200);
    assert.equal(completed.body.data.status, "done");
    assert.ok(completed.body.data.completedAt);

    const history = await app.httpRequest()
      .get(`/api/conversations/${conversationId}/messages?limit=20`)
      .set("Authorization", authorization)
      .expect(200);
    assert.ok(history.body.data.items.some((message: any) => message.summary.includes("完成了任务")));

    await app.chatDb.Message.destroy({ where: { conversationId, summary: { [Op.like]: `%${title}%` } } });
    await app.chatDb.Task.destroy({ where: { id: created.body.data.id } });
  });

  it("演示账号可以登录并读取企业会话", async () => {
    const login = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);

    assert.ok(login.body.success);
    assert.equal(login.body.data.user.role, "owner");
    assert.ok(login.body.data.accessToken);
    const authorization = `Bearer ${login.body.data.accessToken}`;

    const conversations = await app.httpRequest()
      .get("/api/conversations")
      .set("Authorization", authorization)
      .expect(200);

    assert.ok(conversations.body.success);
    assert.ok(conversations.body.data.length >= 2);

    const conversationId = conversations.body.data[0].id;
    const conversationBefore = await app.chatDb.Conversation.findByPk(conversationId);
    const originalLastMessage = conversationBefore?.get("lastMessage");
    const originalLastMessageAt = conversationBefore?.get("lastMessageAt");
    const clientId = `test-${Date.now()}`;
    const sent = await app.httpRequest()
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Authorization", authorization)
      .send({
        conversationId,
        clientId,
        schemaVersion: 1,
        parts: [{ type: "text", text: "自动化落库验证" }],
      })
      .expect(200);

    assert.ok(sent.body.success);
    assert.equal(sent.body.data.clientId, clientId);
    assert.deepEqual(sent.body.data.parts, [{ type: "text", text: "自动化落库验证" }]);
    assert.equal(sent.body.data.summary, "自动化落库验证");

    const history = await app.httpRequest()
      .get(`/api/conversations/${conversationId}/messages?limit=10`)
      .set("Authorization", authorization)
      .expect(200);

    assert.ok(history.body.data.items.some((message: any) => message.clientId === clientId));
    await app.chatDb.Message.destroy({ where: { clientId } });
    await conversationBefore?.update({ lastMessage: originalLastMessage, lastMessageAt: originalLastMessageAt });
  });

  it("会话成员可管理 Webhook 机器人，机器人消息会写入会话历史", async () => {
    const login = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);
    const authorization = `Bearer ${login.body.data.accessToken}`;
    const conversations = await app.httpRequest()
      .get("/api/conversations")
      .set("Authorization", authorization)
      .expect(200);
    const conversationId = conversations.body.data[0].id;
    const conversationBefore = await app.chatDb.Conversation.findByPk(conversationId);
    const originalLastMessage = conversationBefore?.get("lastMessage");
    const originalLastMessageAt = conversationBefore?.get("lastMessageAt");
    const syncCursor = Number(await app.chatDb.SyncEvent.max("id") || 0);

    const created = await app.httpRequest()
      .post(`/api/conversations/${conversationId}/bots`)
      .set("Authorization", authorization)
      .send({ name: "测试机器人" })
      .expect(200);
    assert.ok(created.body.data.webhookUrl);
    const botId = created.body.data.id;
    const webhookPath = new URL(created.body.data.webhookUrl).pathname
      + new URL(created.body.data.webhookUrl).search;

    await app.httpRequest()
      .post(webhookPath)
      .send({ msgtype: "markdown", markdown: { content: "**机器人测试消息**" } })
      .expect(200);
    const history = await app.httpRequest()
      .get(`/api/conversations/${conversationId}/messages?limit=10`)
      .set("Authorization", authorization)
      .expect(200);
    const botMessage = history.body.data.items.find((item: any) => item.senderBotId === botId);
    assert.equal(botMessage.senderType, "bot");
    assert.equal(botMessage.senderName, "测试机器人");
    assert.deepEqual(botMessage.parts, [{ type: "markdown", content: "**机器人测试消息**" }]);

    const reset = await app.httpRequest()
      .post(`/api/conversations/${conversationId}/bots/${botId}/reset`)
      .set("Authorization", authorization)
      .expect(200);
    await app.httpRequest().post(webhookPath).send({ msgtype: "text", text: { content: "旧密钥" } }).expect(404);
    const resetPath = new URL(reset.body.data.webhookUrl).pathname
      + new URL(reset.body.data.webhookUrl).search;
    await app.httpRequest().post(resetPath).send({ msgtype: "text", text: { content: "新密钥" } }).expect(200);

    await app.httpRequest()
      .delete(`/api/conversations/${conversationId}/bots/${botId}`)
      .set("Authorization", authorization)
      .expect(200);
    await app.httpRequest().post(resetPath).send({ msgtype: "text", text: { content: "已删除" } }).expect(404);
    await app.chatDb.SyncEvent.destroy({ where: { id: { [Op.gt]: syncCursor } } });
    await app.chatDb.Message.destroy({ where: { senderBotId: botId } });
    await app.chatDb.BotMedia.destroy({ where: { botId } });
    await app.chatDb.ConversationBot.destroy({ where: { id: botId } });
    await conversationBefore?.update({ lastMessage: originalLastMessage, lastMessageAt: originalLastMessageAt });
  });

  it("提供桌面健康检查与增量同步游标", async () => {
    const health = await app.httpRequest().get("/api/health").expect(200);
    assert.equal(health.body.data.serviceId, "enterprise-chat");
    assert.equal(health.body.data.apiVersion, "1");
    assert.ok(health.body.data.serverId);

    const login = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);
    const authorization = `Bearer ${login.body.data.accessToken}`;
    const bootstrap = await app.httpRequest()
      .get("/api/sync/bootstrap")
      .set("Authorization", authorization)
      .expect(200);
    assert.ok(Array.isArray(bootstrap.body.data.conversations));
    assert.ok(Array.isArray(bootstrap.body.data.messages));

    const conversationId = bootstrap.body.data.conversations[0].id;
    const clientId = `sync-${Date.now()}`;
    await app.httpRequest()
      .post(`/api/conversations/${conversationId}/messages`)
      .set("Authorization", authorization)
      .send({
        conversationId,
        clientId,
        schemaVersion: 1,
        parts: [{ type: "text", text: "desktop sync test" }],
      })
      .expect(200);

    const events = await app.httpRequest()
      .get(`/api/sync/events?cursor=${bootstrap.body.data.cursor}&limit=50`)
      .set("Authorization", authorization)
      .expect(200);
    assert.ok(events.body.data.events.some((event: any) =>
      event.type === "message.upsert" && event.payload.clientId === clientId));

    const message = await app.chatDb.Message.findOne({ where: { clientId } });
    await app.chatDb.SyncEvent.destroy({ where: { entityId: String(message?.get("id")) } });
    await message?.destroy();
  });

  it("拒绝错误密码和未登录访问", async () => {
    const login = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "wrong-password" })
      .expect(401);

    assert.equal(login.body.error.code, "INVALID_CREDENTIALS");

    const contacts = await app.httpRequest()
      .get("/api/contacts")
      .expect(401);

    assert.equal(contacts.body.error.code, "UNAUTHORIZED");
  });

  it("可以使用 HttpOnly refresh token 获取新的 access token", async () => {
    const login = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);
    const refreshCookie = login.headers["set-cookie"];
    assert.ok(refreshCookie);

    const refreshed = await app.httpRequest()
      .post("/api/auth/refresh")
      .set("Cookie", refreshCookie)
      .expect(200);
    assert.ok(refreshed.body.data.accessToken);
    const rotatedCookie = refreshed.headers["set-cookie"];
    assert.ok(rotatedCookie);

    const replay = await app.httpRequest()
      .post("/api/auth/refresh")
      .set("Cookie", refreshCookie)
      .expect(401);
    assert.equal(replay.body.error.code, "REFRESH_TOKEN_INVALID");

    const me = await app.httpRequest()
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${refreshed.body.data.accessToken}`)
      .expect(200);
    assert.equal(me.body.data.user.phone, "13800000001");

    await app.httpRequest()
      .post("/api/auth/logout")
      .set("Cookie", rotatedCookie)
      .expect(200);
    await app.httpRequest()
      .post("/api/auth/refresh")
      .set("Cookie", rotatedCookie)
      .expect(401);
  });

  it("支持创建子部门并修改部门资料", async () => {
    const login = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);
    const authorization = `Bearer ${login.body.data.accessToken}`;
    const departments = await app.httpRequest()
      .get("/api/departments")
      .set("Authorization", authorization)
      .expect(200);
    const parent = departments.body.data.find((department: any) => department.parentId === null);
    assert.ok(parent);
    const cursor = Number(await app.chatDb.SyncEvent.max("id", {
      where: { recipientUserId: login.body.data.user.id },
    }) || 0);

    const created = await app.httpRequest()
      .post("/api/departments")
      .set("Authorization", authorization)
      .send({ name: "自动化子部门", parentId: parent.id })
      .expect(200);
    assert.equal(created.body.data.parentId, parent.id);

    const updated = await app.httpRequest()
      .patch(`/api/departments/${created.body.data.id}`)
      .set("Authorization", authorization)
      .send({ name: "自动化子部门（已修改）", parentId: parent.id })
      .expect(200);
    assert.equal(updated.body.data.name, "自动化子部门（已修改）");

    await app.httpRequest()
      .delete(`/api/departments/${created.body.data.id}`)
      .set("Authorization", authorization)
      .expect(200);
    const events = await app.httpRequest()
      .get(`/api/sync/events?cursor=${cursor}&limit=50`)
      .set("Authorization", authorization)
      .expect(200);
    const departmentEvents = events.body.data.events.filter((event: any) =>
      event.type === "department.upsert" && event.entityId === String(created.body.data.id));
    assert.ok(departmentEvents.some((event: any) => event.payload.name === "自动化子部门（已修改）"));
    assert.ok(departmentEvents.some((event: any) => event.payload.deletedAt));
    await app.chatDb.SyncEvent.destroy({
      where: { type: "department.upsert", entityId: String(created.body.data.id) },
    });
  });

  it("支持历史分页、搜索、已读回执和个人会话设置", async () => {
    const ownerLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);
    const memberLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000002", password: "123456" })
      .expect(200);
    const ownerAuth = `Bearer ${ownerLogin.body.data.accessToken}`;
    const memberAuth = `Bearer ${memberLogin.body.data.accessToken}`;
    const conversations = await app.httpRequest()
      .get("/api/conversations")
      .set("Authorization", ownerAuth)
      .expect(200);
    const direct = conversations.body.data.find((item: any) =>
      item.type === "direct" && item.members.some((member: any) => member.phone === "13800000002"));
    assert.ok(direct);

    const ownerMembership = await app.chatDb.ConversationMember.findOne({
      where: { conversationId: direct.id, userId: ownerLogin.body.data.user.id },
    });
    const memberMembership = await app.chatDb.ConversationMember.findOne({
      where: { conversationId: direct.id, userId: memberLogin.body.data.user.id },
    });
    assert.ok(ownerMembership);
    assert.ok(memberMembership);
    const ownerState = ownerMembership.get({ plain: true }) as any;
    const memberState = memberMembership.get({ plain: true }) as any;
    const conversationRow = await app.chatDb.Conversation.findByPk(direct.id);
    const conversationState = conversationRow?.get({ plain: true }) as any;
    const stamp = Date.now();
    const clientIds: string[] = [];

    try {
      for (let index = 0; index < 7; index += 1) {
        const clientId = `history-${stamp}-${index}`;
        clientIds.push(clientId);
        await app.httpRequest()
          .post(`/api/conversations/${direct.id}/messages`)
          .set("Authorization", ownerAuth)
          .send({
            conversationId: direct.id,
            clientId,
            schemaVersion: 1,
            parts: [{ type: "text", text: `历史分页-${stamp}-${index}` }],
          })
          .expect(200);
      }

      const firstPage = await app.httpRequest()
        .get(`/api/conversations/${direct.id}/messages?limit=3`)
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.equal(firstPage.body.data.items.length, 3);
      assert.ok(firstPage.body.data.nextCursor);

      const secondPage = await app.httpRequest()
        .get(`/api/conversations/${direct.id}/messages?limit=3&before=${firstPage.body.data.nextCursor}`)
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.equal(secondPage.body.data.items.length, 3);
      const firstIds = new Set(firstPage.body.data.items.map((item: any) => item.id));
      assert.ok(secondPage.body.data.items.every((item: any) => !firstIds.has(item.id)));

      const searched = await app.httpRequest()
        .get(`/api/conversations/${direct.id}/messages?q=${encodeURIComponent(`历史分页-${stamp}-3`)}`)
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.equal(searched.body.data.items.length, 1);

      const latest = firstPage.body.data.items.at(-1);
      await app.httpRequest()
        .post(`/api/conversations/${direct.id}/read`)
        .set("Authorization", memberAuth)
        .send({ messageId: latest.id })
        .expect(200);
      const receipt = await app.httpRequest()
        .get(`/api/conversations/${direct.id}/messages?limit=3`)
        .set("Authorization", ownerAuth)
        .expect(200);
      const latestReceipt = receipt.body.data.items.find((item: any) => item.id === latest.id);
      assert.equal(latestReceipt.readCount, 1);
      assert.equal(latestReceipt.recipientCount, 1);

      const receiptDetails = await app.httpRequest()
        .get(`/api/conversations/${direct.id}/messages/${latest.id}/receipts`)
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.equal(receiptDetails.body.data.messageId, latest.id);
      assert.equal(receiptDetails.body.data.read.length, 1);
      assert.equal(receiptDetails.body.data.read[0].id, memberLogin.body.data.user.id);
      assert.equal(receiptDetails.body.data.unread.length, 0);

      const forbiddenReceipt = await app.httpRequest()
        .get(`/api/conversations/${direct.id}/messages/${latest.id}/receipts`)
        .set("Authorization", memberAuth)
        .expect(403);
      assert.equal(forbiddenReceipt.body.error.code, "RECEIPTS_FORBIDDEN");

      const settings = await app.httpRequest()
        .patch(`/api/conversations/${direct.id}/settings`)
        .set("Authorization", ownerAuth)
        .send({ pinned: true, muted: true })
        .expect(200);
      assert.equal(settings.body.data.pinned, true);
      assert.equal(settings.body.data.muted, true);

      await app.httpRequest()
        .patch(`/api/conversations/${direct.id}/settings`)
        .set("Authorization", ownerAuth)
        .send({ clearHistory: true })
        .expect(200);
      const cleared = await app.httpRequest()
        .get(`/api/conversations/${direct.id}/messages?limit=30`)
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.equal(cleared.body.data.items.length, 0);
    } finally {
      await app.chatDb.Message.destroy({ where: { clientId: clientIds } });
      await ownerMembership.update({
        lastReadMessageId: ownerState.lastReadMessageId,
        clearedAtMessageId: ownerState.clearedAtMessageId,
        isPinned: ownerState.isPinned,
        isMuted: ownerState.isMuted,
      });
      await memberMembership.update({
        lastReadMessageId: memberState.lastReadMessageId,
        clearedAtMessageId: memberState.clearedAtMessageId,
        isPinned: memberState.isPinned,
        isMuted: memberState.isMuted,
      });
      await conversationRow?.update({
        lastMessage: conversationState.lastMessage,
        lastMessageAt: conversationState.lastMessageAt,
      });
    }
  });

  it("群主可以移除并重新添加群成员，普通成员不能移除他人", async () => {
    const ownerLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);
    const memberLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000002", password: "123456" })
      .expect(200);
    const ownerAuth = `Bearer ${ownerLogin.body.data.accessToken}`;
    const memberAuth = `Bearer ${memberLogin.body.data.accessToken}`;
    const conversations = await app.httpRequest()
      .get("/api/conversations")
      .set("Authorization", ownerAuth)
      .expect(200);
    const group = conversations.body.data.find((item: any) =>
      item.type === "group" && item.createdBy === ownerLogin.body.data.user.id);
    assert.ok(group);
    const target = group.members.find((item: any) => item.phone === "13800000005");
    assert.ok(target);

    await app.httpRequest()
      .delete(`/api/conversations/${group.id}/members/${target.id}`)
      .set("Authorization", memberAuth)
      .expect(403);

    await app.httpRequest()
      .delete(`/api/conversations/${group.id}/members/${target.id}`)
      .set("Authorization", ownerAuth)
      .expect(200);
    const removed = await app.chatDb.ConversationMember.findOne({
      where: { conversationId: group.id, userId: target.id },
    });
    assert.ok(removed?.get("leftAt"));

    await app.httpRequest()
      .post(`/api/conversations/${group.id}/members`)
      .set("Authorization", ownerAuth)
      .send({ userIds: [target.id] })
      .expect(200);
    await removed?.reload();
    assert.equal(removed?.get("leftAt"), null);
  });

  it("群聊支持 @成员、@所有人提醒，并按用户隐藏和自动恢复会话", async () => {
    const ownerLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);
    const memberLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000002", password: "123456" })
      .expect(200);
    const otherLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000003", password: "123456" })
      .expect(200);
    const ownerAuth = `Bearer ${ownerLogin.body.data.accessToken}`;
    const memberAuth = `Bearer ${memberLogin.body.data.accessToken}`;
    const otherAuth = `Bearer ${otherLogin.body.data.accessToken}`;
    const conversations = await app.httpRequest()
      .get("/api/conversations?includeHidden=1")
      .set("Authorization", ownerAuth)
      .expect(200);
    const group = conversations.body.data.find((item: any) =>
      item.type === "group"
      && item.members.some((member: any) => member.phone === "13800000002")
      && item.members.some((member: any) => member.phone === "13800000003"));
    const direct = conversations.body.data.find((item: any) => item.type === "direct");
    assert.ok(group);
    assert.ok(direct);

    const memberships = await app.chatDb.ConversationMember.findAll({
      where: { conversationId: group.id, leftAt: null },
    });
    const membershipStates = memberships.map((row: any) => ({
      row,
      state: {
        lastReadMessageId: row.get("lastReadMessageId"),
        clearedAtMessageId: row.get("clearedAtMessageId"),
        isHidden: row.get("isHidden"),
        hiddenAtMessageId: row.get("hiddenAtMessageId"),
        lastMentionMessageId: row.get("lastMentionMessageId"),
        lastMentionType: row.get("lastMentionType"),
      },
    }));
    for (const membership of memberships) {
      await membership.update({
        lastMentionMessageId: null,
        lastMentionType: null,
        isHidden: false,
        hiddenAtMessageId: null,
      });
    }
    const conversationRow = await app.chatDb.Conversation.findByPk(group.id);
    const conversationState = conversationRow?.get({ plain: true }) as any;
    const stamp = Date.now();
    const mentionMemberClientId = `mention-member-${stamp}`;
    const mentionClientId = `mention-all-${stamp}`;
    const wakeClientId = `unhide-${stamp}`;

    try {
      await app.httpRequest()
        .post(`/api/conversations/${direct.id}/messages`)
        .set("Authorization", ownerAuth)
        .send({
          conversationId: direct.id,
          clientId: `invalid-mention-${stamp}`,
          schemaVersion: 1,
          parts: [{ type: "mention_all", label: "所有人" }],
        })
        .expect(400);

      const mentionMember = await app.httpRequest()
        .post(`/api/conversations/${group.id}/messages`)
        .set("Authorization", ownerAuth)
        .send({
          conversationId: group.id,
          clientId: mentionMemberClientId,
          schemaVersion: 1,
          parts: [
            {
              type: "mention",
              userId: memberLogin.body.data.user.id,
              label: "不能由客户端伪造",
            },
            { type: "text", text: "请确认方案" },
          ],
        });
      assert.equal(mentionMember.status, 200, JSON.stringify(mentionMember.body));
      assert.equal(mentionMember.body.data.parts[0].label, memberLogin.body.data.user.name);
      const targetedList = await app.httpRequest()
        .get("/api/conversations")
        .set("Authorization", memberAuth)
        .expect(200);
      assert.equal(
        targetedList.body.data.find((item: any) => item.id === group.id).mentionType,
        "member",
      );
      const untargetedList = await app.httpRequest()
        .get("/api/conversations")
        .set("Authorization", otherAuth)
        .expect(200);
      assert.equal(
        untargetedList.body.data.find((item: any) => item.id === group.id).mentioned,
        false,
      );
      await app.httpRequest()
        .post(`/api/conversations/${group.id}/read`)
        .set("Authorization", memberAuth)
        .send({ messageId: mentionMember.body.data.id })
        .expect(200);

      const mention = await app.httpRequest()
        .post(`/api/conversations/${group.id}/messages`)
        .set("Authorization", ownerAuth)
        .send({
          conversationId: group.id,
          clientId: mentionClientId,
          schemaVersion: 1,
          parts: [
            { type: "mention_all", label: "所有人" },
            { type: "text", text: "请查看群公告" },
          ],
        })
        .expect(200);
      assert.equal(mention.body.data.parts[0].type, "mention_all");

      const memberConversations = await app.httpRequest()
        .get("/api/conversations")
        .set("Authorization", memberAuth)
        .expect(200);
      const memberGroup = memberConversations.body.data.find((item: any) => item.id === group.id);
      assert.equal(memberGroup.mentioned, true);
      assert.equal(memberGroup.mentionType, "all");

      await app.httpRequest()
        .post(`/api/conversations/${group.id}/read`)
        .set("Authorization", memberAuth)
        .send({ messageId: mention.body.data.id })
        .expect(200);
      const afterRead = await app.httpRequest()
        .get("/api/conversations")
        .set("Authorization", memberAuth)
        .expect(200);
      assert.equal(
        afterRead.body.data.find((item: any) => item.id === group.id).mentioned,
        false,
      );

      await app.httpRequest()
        .patch(`/api/conversations/${group.id}/settings`)
        .set("Authorization", ownerAuth)
        .send({ hidden: true })
        .expect(200);
      const hiddenList = await app.httpRequest()
        .get("/api/conversations")
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.equal(hiddenList.body.data.some((item: any) => item.id === group.id), false);
      const allList = await app.httpRequest()
        .get("/api/conversations?includeHidden=1")
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.equal(
        allList.body.data.find((item: any) => item.id === group.id).hidden,
        true,
      );

      await app.httpRequest()
        .post(`/api/conversations/${group.id}/messages`)
        .set("Authorization", memberAuth)
        .send({
          conversationId: group.id,
          clientId: wakeClientId,
          schemaVersion: 1,
          parts: [{ type: "text", text: "新消息恢复隐藏会话" }],
        })
        .expect(200);
      const restored = await app.httpRequest()
        .get("/api/conversations")
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.equal(restored.body.data.some((item: any) => item.id === group.id), true);
    } finally {
      await app.chatDb.Message.destroy({
        where: { clientId: [mentionMemberClientId, mentionClientId, wakeClientId] },
      });
      for (const item of membershipStates) await item.row.update(item.state);
      await conversationRow?.update({
        lastMessage: conversationState.lastMessage,
        lastMessageAt: conversationState.lastMessageAt,
      });
    }
  });

  it("记录群聊系统消息并按 2 分钟规则撤回本人消息", async () => {
    const ownerLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);
    const memberLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000002", password: "123456" })
      .expect(200);
    const otherLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000004", password: "123456" })
      .expect(200);
    const ownerAuth = `Bearer ${ownerLogin.body.data.accessToken}`;
    const memberAuth = `Bearer ${memberLogin.body.data.accessToken}`;
    const otherAuth = `Bearer ${otherLogin.body.data.accessToken}`;
    let conversationId = 0;

    try {
      const created = await app.httpRequest()
        .post("/api/conversations")
        .set("Authorization", ownerAuth)
        .send({
          type: "group",
          name: "系统消息自动化群",
          memberIds: [memberLogin.body.data.user.id],
        })
        .expect(200);
      conversationId = created.body.data.id;

      let history = await app.httpRequest()
        .get(`/api/conversations/${conversationId}/messages?limit=30`)
        .set("Authorization", ownerAuth)
        .expect(200);
      const createdEvent = history.body.data.items.find((item: any) =>
        item.parts[0]?.type === "system_event"
        && item.parts[0].event.type === "group_created");
      assert.ok(createdEvent);
      assert.equal(createdEvent.kind, "system");
      assert.equal(createdEvent.parts[0].event.actor.name, ownerLogin.body.data.user.name);

      const memberList = await app.httpRequest()
        .get("/api/conversations")
        .set("Authorization", memberAuth)
        .expect(200);
      assert.equal(
        memberList.body.data.find((item: any) => item.id === conversationId).unreadCount,
        0,
      );

      await app.httpRequest()
        .patch(`/api/conversations/${conversationId}/settings`)
        .set("Authorization", memberAuth)
        .send({ hidden: true })
        .expect(200);
      await app.httpRequest()
        .patch(`/api/conversations/${conversationId}`)
        .set("Authorization", ownerAuth)
        .send({ name: "系统消息自动化群（已改名）" })
        .expect(200);
      const hiddenAfterRename = await app.httpRequest()
        .get("/api/conversations?includeHidden=1")
        .set("Authorization", memberAuth)
        .expect(200);
      const hiddenConversation = hiddenAfterRename.body.data.find(
        (item: any) => item.id === conversationId,
      );
      assert.equal(hiddenConversation.hidden, true);
      assert.equal(hiddenConversation.unreadCount, 0);

      const attachedHistory = await app.httpRequest()
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", ownerAuth)
        .send({
          conversationId,
          clientId: `invite-history-visible-${Date.now()}`,
          schemaVersion: 1,
          parts: [{ type: "text", text: "邀请时允许携带的聊天记录" }],
        })
        .expect(200);
      const privateHistory = await app.httpRequest()
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", ownerAuth)
        .send({
          conversationId,
          clientId: `invite-history-private-${Date.now()}`,
          schemaVersion: 1,
          parts: [{ type: "text", text: "邀请时不携带的聊天记录" }],
        })
        .expect(200);
      const syncBeforeInvite = await app.httpRequest()
        .get("/api/sync/status")
        .set("Authorization", otherAuth)
        .expect(200);
      await app.httpRequest()
        .post(`/api/conversations/${conversationId}/members`)
        .set("Authorization", memberAuth)
        .send({
          userIds: [otherLogin.body.data.user.id],
          historyMessageIds: [attachedHistory.body.data.id],
        })
        .expect(200);
      const invitedEvents = await app.httpRequest()
        .get(`/api/sync/events?cursor=${syncBeforeInvite.body.data.maximumCursor}`)
        .set("Authorization", otherAuth)
        .expect(200);
      assert.ok(invitedEvents.body.data.events.some((event: any) =>
        event.type === "message.upsert"
        && event.payload.id === attachedHistory.body.data.id));
      assert.equal(invitedEvents.body.data.events.some((event: any) =>
        event.type === "message.upsert"
        && event.payload.id === privateHistory.body.data.id), false);
      const invitedHistory = await app.httpRequest()
        .get(`/api/conversations/${conversationId}/messages?limit=30`)
        .set("Authorization", otherAuth)
        .expect(200);
      assert.equal(
        invitedHistory.body.data.items.some(
          (item: any) => item.id === attachedHistory.body.data.id,
        ),
        true,
      );
      assert.equal(
        invitedHistory.body.data.items.some(
          (item: any) => item.id === privateHistory.body.data.id,
        ),
        false,
      );
      const invitedBootstrap = await app.httpRequest()
        .get("/api/sync/bootstrap")
        .set("Authorization", otherAuth)
        .expect(200);
      const bootstrappedIds = invitedBootstrap.body.data.messages
        .filter((item: any) => item.conversationId === conversationId)
        .map((item: any) => item.id);
      assert.ok(bootstrappedIds.includes(attachedHistory.body.data.id));
      assert.equal(bootstrappedIds.includes(privateHistory.body.data.id), false);
      await app.httpRequest()
        .delete(`/api/conversations/${conversationId}/members/${otherLogin.body.data.user.id}`)
        .set("Authorization", otherAuth)
        .expect(200);
      history = await app.httpRequest()
        .get(`/api/conversations/${conversationId}/messages?limit=30`)
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.ok(history.body.data.items.some((item: any) =>
        item.parts[0]?.type === "system_event"
        && item.parts[0].event.type === "member_left"));
      await app.httpRequest()
        .post(`/api/conversations/${conversationId}/members`)
        .set("Authorization", memberAuth)
        .send({ userIds: [otherLogin.body.data.user.id] })
        .expect(200);
      const systemCountBeforeDuplicate = await app.chatDb.Message.count({
        where: { conversationId, kind: "system" },
      });
      await app.httpRequest()
        .post(`/api/conversations/${conversationId}/members`)
        .set("Authorization", memberAuth)
        .send({ userIds: [otherLogin.body.data.user.id] })
        .expect(200);
      assert.equal(
        await app.chatDb.Message.count({ where: { conversationId, kind: "system" } }),
        systemCountBeforeDuplicate,
      );

      const clientId = `recall-${Date.now()}`;
      const sent = await app.httpRequest()
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", ownerAuth)
        .send({
          conversationId,
          clientId,
          schemaVersion: 1,
          parts: [{ type: "text", text: "两分钟内撤回" }],
        })
        .expect(200);
      await app.httpRequest()
        .post(`/api/conversations/${conversationId}/messages/${sent.body.data.id}/recall`)
        .set("Authorization", memberAuth)
        .send({})
        .expect(403);
      const recalled = await app.httpRequest()
        .post(`/api/conversations/${conversationId}/messages/${sent.body.data.id}/recall`)
        .set("Authorization", ownerAuth)
        .send({})
        .expect(200);
      assert.equal(recalled.body.data.recalledMessageId, sent.body.data.id);
      assert.equal(
        recalled.body.data.systemMessage.parts[0].event.type,
        "message_recalled",
      );
      const recalledRow = await app.chatDb.Message.findByPk(sent.body.data.id);
      assert.ok(recalledRow?.get("deletedAt"));
      const recalledAttachment = await app.chatDb.Attachment.create({
        companyId: ownerLogin.body.data.company.id,
        uploaderId: ownerLogin.body.data.user.id,
        messageId: sent.body.data.id,
        originalName: "已撤回附件.txt",
        storedName: "recalled-test.txt",
        mimeType: "text/plain",
        size: 1,
        relativePath: "recalled-test.txt",
      });
      await app.httpRequest()
        .get(`/api/files/${recalledAttachment.get("id")}`)
        .set("Authorization", memberAuth)
        .expect(410);

      history = await app.httpRequest()
        .get(`/api/conversations/${conversationId}/messages?limit=30`)
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.equal(
        history.body.data.items.some((item: any) => item.id === sent.body.data.id),
        false,
      );
      assert.ok(history.body.data.items.some((item: any) =>
        item.parts[0]?.type === "system_event"
        && item.parts[0].event.type === "message_recalled"));

      const expiredClientId = `recall-expired-${Date.now()}`;
      const expired = await app.httpRequest()
        .post(`/api/conversations/${conversationId}/messages`)
        .set("Authorization", ownerAuth)
        .send({
          conversationId,
          clientId: expiredClientId,
          schemaVersion: 1,
          parts: [{ type: "text", text: "超过两分钟" }],
        })
        .expect(200);
      await app.chatDb.Message.update(
        { createdAt: new Date(Date.now() - 3 * 60 * 1000) },
        { where: { id: expired.body.data.id }, silent: true },
      );
      await app.httpRequest()
        .post(`/api/conversations/${conversationId}/messages/${expired.body.data.id}/recall`)
        .set("Authorization", ownerAuth)
        .send({})
        .expect(409);

      await app.httpRequest()
        .delete(`/api/conversations/${conversationId}/members/${memberLogin.body.data.user.id}`)
        .set("Authorization", ownerAuth)
        .expect(200);
      history = await app.httpRequest()
        .get(`/api/conversations/${conversationId}/messages?limit=30`)
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.ok(history.body.data.items.some((item: any) =>
        item.parts[0]?.type === "system_event"
        && item.parts[0].event.type === "member_removed"));
    } finally {
      if (conversationId) {
        await app.chatDb.SyncEvent.destroy({ where: { conversationId } });
        await app.chatDb.Attachment.destroy({
          where: {
            messageId: await app.chatDb.Message.findAll({
              where: { conversationId },
              attributes: ["id"],
            }).then((rows: any[]) => rows.map((row) => Number(row.get("id")))),
          },
        });
        await app.chatDb.Message.destroy({ where: { conversationId }, force: true });
        await app.chatDb.ConversationMember.destroy({ where: { conversationId }, force: true });
        await app.chatDb.Conversation.destroy({ where: { id: conversationId }, force: true });
      }
    }
  });

  it("支持群公告、普通成员退出、转移群主和群主解散群聊", async () => {
    const ownerLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);
    const memberLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000002", password: "123456" })
      .expect(200);
    const leavingLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000003", password: "123456" })
      .expect(200);
    const ownerAuth = `Bearer ${ownerLogin.body.data.accessToken}`;
    const memberAuth = `Bearer ${memberLogin.body.data.accessToken}`;
    const leavingAuth = `Bearer ${leavingLogin.body.data.accessToken}`;
    let conversationId = 0;

    try {
      const created = await app.httpRequest()
        .post("/api/conversations")
        .set("Authorization", ownerAuth)
        .send({
          type: "group",
          name: "群设置自动化测试",
          memberIds: [
            memberLogin.body.data.user.id,
            leavingLogin.body.data.user.id,
          ],
        })
        .expect(200);
      conversationId = created.body.data.id;

      await app.httpRequest()
        .post(`/api/conversations/${conversationId}/announcement`)
        .set("Authorization", memberAuth)
        .send({
          clientId: `announcement-denied-${Date.now()}`,
          schemaVersion: 1,
          parts: [{ type: "text", text: "普通成员不能发布" }],
        })
        .expect(403);

      const announcement = await app.httpRequest()
        .post(`/api/conversations/${conversationId}/announcement`)
        .set("Authorization", ownerAuth)
        .send({
          clientId: `announcement-${Date.now()}`,
          schemaVersion: 1,
          parts: [
            { type: "text", text: "周五下午进行版本评审 " },
            {
              type: "mention",
              userId: memberLogin.body.data.user.id,
              label: "会由服务端校正",
            },
          ],
        })
        .expect(200);
      assert.equal(announcement.body.data.kind, "announcement");
      assert.equal(announcement.body.data.parts[0].text, "周五下午进行版本评审 ");
      assert.equal(
        announcement.body.data.parts[1].label,
        memberLogin.body.data.user.name,
      );
      const announcementConversation = await app.httpRequest()
        .get(`/api/conversations/${conversationId}`)
        .set("Authorization", memberAuth)
        .expect(200);
      assert.equal(
        announcementConversation.body.data.announcementMessage.kind,
        "announcement",
      );
      assert.ok(announcementConversation.body.data.unreadCount >= 1);

      await app.httpRequest()
        .post(`/api/conversations/${conversationId}/owner`)
        .set("Authorization", memberAuth)
        .send({ userId: leavingLogin.body.data.user.id })
        .expect(403);

      const transferred = await app.httpRequest()
        .post(`/api/conversations/${conversationId}/owner`)
        .set("Authorization", ownerAuth)
        .send({ userId: memberLogin.body.data.user.id })
        .expect(200);
      assert.equal(transferred.body.data.createdBy, memberLogin.body.data.user.id);

      const history = await app.httpRequest()
        .get(`/api/conversations/${conversationId}/messages?limit=30`)
        .set("Authorization", memberAuth)
        .expect(200);
      assert.ok(history.body.data.items.some((item: any) =>
        item.kind === "announcement"
        && item.parts.some((part: any) =>
          part.type === "text" && part.text.includes("版本评审"))));
      assert.ok(history.body.data.items.some((item: any) =>
        item.parts[0]?.type === "system_event"
        && item.parts[0].event.type === "owner_transferred"));

      await app.httpRequest()
        .delete(`/api/conversations/${conversationId}`)
        .set("Authorization", ownerAuth)
        .expect(403);

      await app.httpRequest()
        .delete(`/api/conversations/${conversationId}/members/${leavingLogin.body.data.user.id}`)
        .set("Authorization", leavingAuth)
        .expect(200);
      const leavingList = await app.httpRequest()
        .get("/api/conversations")
        .set("Authorization", leavingAuth)
        .expect(200);
      assert.equal(
        leavingList.body.data.some((item: any) => item.id === conversationId),
        false,
      );

      await app.httpRequest()
        .delete(`/api/conversations/${conversationId}`)
        .set("Authorization", memberAuth)
        .expect(200);
      for (const authorization of [ownerAuth, memberAuth]) {
        const list = await app.httpRequest()
          .get("/api/conversations")
          .set("Authorization", authorization)
          .expect(200);
        assert.equal(
          list.body.data.some((item: any) => item.id === conversationId),
          false,
        );
      }
    } finally {
      if (conversationId) {
        await app.chatDb.SyncEvent.destroy({ where: { conversationId } });
        await app.chatDb.Message.destroy({ where: { conversationId }, force: true });
        await app.chatDb.ConversationMember.destroy({ where: { conversationId }, force: true });
        await app.chatDb.Conversation.destroy({ where: { id: conversationId }, force: true });
      }
    }
  });
  it("支持幂等逐条/合并转发，并且账号级删除不影响其他成员", async () => {
    const ownerLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000001", password: "123456" })
      .expect(200);
    const memberLogin = await app.httpRequest()
      .post("/api/auth/login")
      .send({ phone: "13800000002", password: "123456" })
      .expect(200);
    const ownerAuth = `Bearer ${ownerLogin.body.data.accessToken}`;
    const memberAuth = `Bearer ${memberLogin.body.data.accessToken}`;
    const conversations = await app.httpRequest()
      .get("/api/conversations")
      .set("Authorization", ownerAuth)
      .expect(200);
    const direct = conversations.body.data.find((item: any) =>
      item.type === "direct"
      && item.members.some((member: any) => member.phone === "13800000002"));
    assert.ok(direct);

    const conversationRow = await app.chatDb.Conversation.findByPk(direct.id);
    const conversationState = conversationRow?.get({ plain: true }) as any;
    const latestSync = await app.chatDb.SyncEvent.max("id");
    const createdMessageIds: number[] = [];
    const stamp = Date.now();
    try {
      const sourceMessages = [];
      for (const suffix of ["A", "B"]) {
        const sent = await app.httpRequest()
          .post(`/api/conversations/${direct.id}/messages`)
          .set("Authorization", ownerAuth)
          .send({
            conversationId: direct.id,
            clientId: `forward-source-${stamp}-${suffix}`,
            schemaVersion: 1,
            parts: [{ type: "text", text: `待转发消息 ${suffix}` }],
          })
          .expect(200);
        sourceMessages.push(sent.body.data);
        createdMessageIds.push(sent.body.data.id);
      }

      const forgedSnapshot = await app.httpRequest()
        .post(`/api/conversations/${direct.id}/messages`)
        .set("Authorization", ownerAuth)
        .send({
          conversationId: direct.id,
          clientId: `forged-forward-${stamp}`,
          schemaVersion: 1,
          parts: [{
            type: "forwarded_message",
            snapshot: {
              originalMessageId: sourceMessages[0].id,
              senderId: ownerLogin.body.data.user.id,
              senderName: ownerLogin.body.data.user.name,
              senderAvatar: ownerLogin.body.data.user.avatar,
              createdAt: sourceMessages[0].createdAt,
              summary: "伪造转发消息",
              parts: [{ type: "text", text: "伪造转发消息" }],
            },
          }],
        })
        .expect(400);
      assert.equal(forgedSnapshot.body.error.code, "UNSUPPORTED_MESSAGE_PART");

      const inaccessibleTarget = await app.httpRequest()
        .post(`/api/conversations/${direct.id}/messages/forward`)
        .set("Authorization", ownerAuth)
        .send({
          requestId: `forward-invalid-target-${stamp}`,
          messageIds: [sourceMessages[0].id],
          targetConversationIds: [999_999_999],
          mode: "individual",
        })
        .expect(403);
      assert.equal(inaccessibleTarget.body.error.code, "FORWARD_TARGET_FORBIDDEN");

      const individualRequest = {
        requestId: `forward-individual-${stamp}`,
        messageIds: [sourceMessages[0].id],
        targetConversationIds: [direct.id],
        mode: "individual",
      };
      const individual = await app.httpRequest()
        .post(`/api/conversations/${direct.id}/messages/forward`)
        .set("Authorization", ownerAuth)
        .send(individualRequest)
        .expect(200);
      const forwarded = individual.body.data.deliveries[0].messages[0];
      createdMessageIds.push(forwarded.id);
      assert.equal(forwarded.parts[0].type, "forwarded_message");
      assert.equal(forwarded.parts[0].snapshot.parts[0].text, "待转发消息 A");

      const retried = await app.httpRequest()
        .post(`/api/conversations/${direct.id}/messages/forward`)
        .set("Authorization", ownerAuth)
        .send(individualRequest)
        .expect(200);
      assert.equal(retried.body.data.deliveries[0].messages[0].id, forwarded.id);
      assert.equal(
        await app.chatDb.Message.count({ where: { id: forwarded.id } }),
        1,
      );

      const merged = await app.httpRequest()
        .post(`/api/conversations/${direct.id}/messages/forward`)
        .set("Authorization", ownerAuth)
        .send({
          requestId: `forward-merged-${stamp}`,
          messageIds: sourceMessages.map((message: any) => message.id),
          targetConversationIds: [direct.id],
          mode: "merged",
        })
        .expect(200);
      const mergedMessage = merged.body.data.deliveries[0].messages[0];
      createdMessageIds.push(mergedMessage.id);
      assert.equal(mergedMessage.parts[0].type, "chat_record");
      assert.equal(mergedMessage.parts[0].items.length, 2);
      assert.equal(
        mergedMessage.parts[0].title,
        `${ownerLogin.body.data.user.name}和${memberLogin.body.data.user.name}的聊天记录`,
      );

      const deletedAttachment = await app.chatDb.Attachment.create({
        companyId: ownerLogin.body.data.company.id,
        uploaderId: ownerLogin.body.data.user.id,
        messageId: sourceMessages[0].id,
        originalName: "仅当前账号删除.txt",
        storedName: `deleted-for-me-${stamp}.txt`,
        mimeType: "text/plain",
        size: 1,
        relativePath: `test/deleted-for-me-${stamp}.txt`,
      });
      const removed = await app.httpRequest()
        .post(`/api/conversations/${direct.id}/messages/delete-for-me`)
        .set("Authorization", ownerAuth)
        .send({ messageIds: [sourceMessages[0].id] })
        .expect(200);
      assert.deepEqual(removed.body.data.deletedMessageIds, [sourceMessages[0].id]);

      const ownerHistory = await app.httpRequest()
        .get(`/api/conversations/${direct.id}/messages?limit=100`)
        .set("Authorization", ownerAuth)
        .expect(200);
      assert.equal(
        ownerHistory.body.data.items.some((item: any) => item.id === sourceMessages[0].id),
        false,
      );
      const memberHistory = await app.httpRequest()
        .get(`/api/conversations/${direct.id}/messages?limit=100`)
        .set("Authorization", memberAuth)
        .expect(200);
      assert.equal(
        memberHistory.body.data.items.some((item: any) => item.id === sourceMessages[0].id),
        true,
      );
      assert.equal(
        await app.chatDb.MessageUserState.count({
          where: {
            userId: ownerLogin.body.data.user.id,
            messageId: sourceMessages[0].id,
          },
        }),
        1,
      );
      const deletedFile = await app.httpRequest()
        .get(`/api/files/${deletedAttachment.get("id")}`)
        .set("Authorization", ownerAuth)
        .expect(410);
      assert.equal(deletedFile.body.error.code, "MESSAGE_DELETED_FOR_USER");
      await app.httpRequest()
        .get(`/api/files/${deletedAttachment.get("id")}`)
        .set("Authorization", memberAuth)
        .expect(404);
    } finally {
      await app.chatDb.MessageUserState.destroy({
        where: { messageId: { [Op.in]: createdMessageIds } },
        force: true,
      });
      await app.chatDb.Attachment.destroy({
        where: { messageId: { [Op.in]: createdMessageIds } },
        force: true,
      });
      await app.chatDb.Message.destroy({
        where: { id: { [Op.in]: createdMessageIds } },
        force: true,
      });
      await app.chatDb.SyncEvent.destroy({
        where: { id: { [Op.gt]: Number(latestSync || 0) } },
        force: true,
      });
      await conversationRow?.update({
        lastMessage: conversationState.lastMessage,
        lastMessageAt: conversationState.lastMessageAt,
      });
    }
  });
});
