import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Application, Context } from "egg";
import mm from "egg-mock";
import { Op, Transaction } from "sequelize";
import * as Y from "yjs";
import { initializeDatabase, toPlain } from "../../app/lib/database";
import { signAccessToken } from "../../app/lib/auth";
import { startCollaborationServer } from "../../app/lib/collaboration";
import {
  startReviewProcess,
  type ReviewOperation,
} from "../helpers/document-review-process";

/** 保留全量测试指定的专用临时库；非安全路径必须拒绝，不能覆盖已经启动的 Egg 配置。 */
function isolatedDatabasePath() {
  const configured = process.env.CHAT_DATABASE_PATH;
  if (!configured)
    return path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "chat-document-reviews-")),
      "reviews.sqlite",
    );
  const absolute = path.resolve(configured);
  // 校验真实目录和既有文件，拒绝指向临时目录之外的符号链接或 Windows junction。
  let ancestor = absolute;
  while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor)
    ancestor = path.dirname(ancestor);
  assert.ok(
    fs.existsSync(ancestor),
    `CHAT_DATABASE_PATH 不存在可校验的安全父目录：${configured}`,
  );
  const actual = path.resolve(
    fs.realpathSync(ancestor),
    path.relative(ancestor, absolute),
  );
  const relative = path.relative(fs.realpathSync(os.tmpdir()), actual);
  const segments = relative.split(path.sep);
  assert.ok(
    path.isAbsolute(configured) &&
      !path.isAbsolute(relative) &&
      segments.length >= 2 &&
      /^chat-[a-zA-Z0-9._-]+$/.test(segments[0]) &&
      !segments.includes(".."),
    `CHAT_DATABASE_PATH 必须位于 os.tmpdir() 下的 chat-* 专用临时目录，拒绝路径：${configured}`,
  );
  return absolute;
}

const testDatabase = isolatedDatabasePath();
process.env.CHAT_DATABASE_PATH = testDatabase;
const { app } = require("egg-mock/bootstrap");

/** 为每个 Service 调用创建独立认证上下文，禁止并发请求共享身份。 */
function context(user?: any): Context {
  const ctx = app.createAnonymousContext();
  ctx.currentUser = user;
  return ctx;
}

/** 构造实际 Yjs 段落正文，用于固定版本与后来编辑内容之间的差异。 */
function documentState(text: string): Buffer {
  const document = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph");
  const value = new Y.XmlText();
  value.insert(0, text);
  paragraph.insert(0, [value]);
  document.getXmlFragment("default").insert(0, [paragraph]);
  const state = Buffer.from(Y.encodeStateAsUpdate(document));
  document.destroy();
  return state;
}

describe("固定文档评审 HTTP / Service 回归", function () {
  this.timeout(150000);
  const now = new Date("2026-10-10T08:00:00.000Z");
  let owner: any;
  let approver: any;
  let assignee: any;
  let observer: any;
  let editor: any;
  let foreign: any;
  let document: any;
  let group: any;
  let input: Record<string, any>;
  const fixtures: Array<{ documentId: number; conversationId: number }> = [];

  /** 在正式路由发送认证请求，并将响应体附在状态断言中便于精确回报。 */
  async function request(
    method: "get" | "post" | "patch",
    url: string,
    user: any,
    body?: any,
    status = 200,
  ) {
    let call = app.httpRequest()[method](url);
    if (user)
      call = call.set("Authorization", `Bearer ${signAccessToken(app, user)}`);
    if (body !== undefined) call = call.send(body);
    const response = await call;
    assert.equal(
      response.status,
      status,
      `${method.toUpperCase()} ${url}: ${JSON.stringify(response.body)}`,
    );
    return response.body;
  }

  /** 使用真实文档、共享与建群 Service 创建权限完整且互相隔离的场景。 */
  async function fixture() {
    const document = await context(owner).service.documents.create({
      type: "doc",
      title: "提交时的文档标题",
    });
    const group = await context(owner).service.chat.create({
      type: "group",
      name: "正式评审回归群",
      memberIds: [approver.id, assignee.id, observer.id, editor.id],
    });
    fixtures.push({ documentId: document.id, conversationId: group.id });
    await context(owner).service.documents.share(document.id, {
      members: [
        { userId: approver.id, permission: "viewer" },
        { userId: assignee.id, permission: "viewer" },
        { userId: observer.id, permission: "viewer" },
        { userId: editor.id, permission: "editor" },
      ],
    });
    await app.chatDb.CloudDocument.update(
      { yjsState: documentState("提交时的不可变正文") },
      { where: { id: document.id } },
    );
    return {
      document,
      group,
      input: {
        requestKey: randomUUID(),
        documentId: document.id,
        conversationId: group.id,
        approverId: approver.id,
        assigneeId: assignee.id,
        title: "固定文档评审任务",
        dueAt: now.toISOString(),
      },
    };
  }

  /** 通过正式提交接口返回新评审，不依赖手工插入评审记录。 */
  async function submit(overrides: Record<string, any> = {}, user = owner) {
    return (
      await request("post", "/api/document-reviews", user, {
        ...input,
        ...overrides,
      })
    ).data;
  }

  /** 通过正式审批接口操作评审，每次请求默认使用新的重试标识。 */
  async function decide(
    reviewId: number,
    decision = "approve",
    user = approver,
    overrides: Record<string, any> = {},
    status = 200,
  ) {
    return request(
      "post",
      `/api/document-reviews/${reviewId}/decision`,
      user,
      {
        requestKey: randomUUID(),
        decision,
        ...overrides,
      },
      status,
    );
  }

  /** 通过正式列表接口读取评审，用于验证权限撤销和默认筛选行为。 */
  async function list(user: any, scope?: string) {
    return (
      await request(
        "get",
        `/api/document-reviews${scope ? `?scope=${scope}` : ""}`,
        user,
      )
    ).data;
  }

  /** 读取正式通知列表并仅保留指定评审的用户可见通知。 */
  async function reviewNotifications(user: any, reviewId: number) {
    const page = await context(user).service.notifications.list({ limit: 100 });
    return page.items.filter(
      (item: any) =>
        item.entityType === "document_review" &&
        item.entityId === String(reviewId),
    );
  }

  /** 记录临时库中的持久化副作用，事务失败或重试不能增加任意一个计数。 */
  async function effects() {
    const models = [
      "DocumentReview",
      "DocumentReviewDelivery",
      "CloudDocumentVersion",
      "Task",
      "Notification",
      "Message",
      "SyncEvent",
    ];
    return Object.fromEntries(
      await Promise.all(
        models.map(async (name) => [name, await app.chatDb[name].count()]),
      ),
    );
  }

  /** 在真实 SQL 写入边界注入单次失败，保留正式路由、事务和任务 Service。 */
  function failInsert(table: string, marker: string) {
    const db = app.chatDb.sequelize;
    const original = db.query.bind(db);
    let hits = 0;
    mm(db, "query", async (sql: any, options: any) => {
      const query = typeof sql === "string" ? sql : sql?.query;
      if (
        new RegExp(`\\bINSERT\\s+INTO\\s+[\"\x60\\[]?${table}\\b`, "i").test(
          query || "",
        )
      ) {
        hits += 1;
        throw new Error(marker);
      }
      return original(sql, options);
    });
    return () => hits;
  }

  /** 只替换 Socket 传输边界，记录提交前是否泄漏用户可见事件。 */
  function capturePushes() {
    const pushes: Array<{ room: string; event: string; payload: any }> = [];
    mm(app.io, "of", () => ({
      /** 保存推送目的地，业务层仍按真实路径执行。 */
      to(room: string) {
        return {
          /** 保存对外推送事件及标识。 */
          emit(event: string, payload: any) {
            pushes.push({ room, event, payload });
          },
        };
      },
    }));
    return pushes;
  }

  /** 按正式扫描顺序先持久化个人通知，再补投群消息。 */
  async function scan(at = now) {
    const ctx = context();
    const notifications = await ctx.service.tasks.sendDueReminders(at);
    const groups = await ctx.service.documentReviews.sendDueGroupReminders(at);
    return { notifications, groups };
  }

  before(async () => {
    assert.equal(app.chatDb.sequelize.options.storage, testDatabase);
    const users = await app.chatDb.User.findAll({ order: [["id", "ASC"]] });
    [owner, approver, assignee, observer, editor] = users.map(toPlain);
    assert.ok(editor, "隔离库必须已完成真实应用初始化");
    const company = await app.chatDb.Company.create({
      name: "外部企业",
      code: `REVIEW-${randomUUID().slice(0, 12)}`,
    });
    foreign = toPlain(
      await app.chatDb.User.create({
        companyId: company.get("id"),
        phone: `review-${randomUUID().slice(0, 12)}`,
        passwordHash: owner.passwordHash,
        name: "外企业成员",
        avatar: "外",
        status: "active",
        role: "member",
      }),
    );
  });

  beforeEach(async () => {
    ({ document, group, input } = await fixture());
  });

  after(async () => {
    if (!foreign) return;
    await app.chatDb.User.destroy({ where: { id: foreign.id } });
    await app.chatDb.Company.destroy({ where: { id: foreign.companyId } });
  });

  afterEach(async () => {
    mm.restore();
    for (const user of [owner, approver, assignee, observer, editor]) {
      await app.chatDb.User.update(
        { companyId: owner.companyId, status: "active" },
        { where: { id: user.id } },
      );
    }
    for (const { documentId, conversationId } of fixtures.splice(0)) {
      const reviews = await app.chatDb.DocumentReview.findAll({
        where: { documentId },
      });
      await app.chatDb.DocumentReviewDelivery.destroy({
        where: {
          reviewId: { [Op.in]: reviews.map((row: any) => row.get("id")) },
        },
      });
      await app.chatDb.DocumentReview.destroy({ where: { documentId } });
      await app.chatDb.Notification.destroy({
        where: { [Op.or]: [{ documentId }, { conversationId }] },
      });
      await app.chatDb.Task.destroy({ where: { conversationId } });
      await app.chatDb.SyncEvent.destroy({ where: { conversationId } });
      await app.chatDb.Message.destroy({ where: { conversationId } });
      await app.chatDb.ConversationMember.destroy({
        where: { conversationId },
      });
      await app.chatDb.Conversation.destroy({ where: { id: conversationId } });
      await app.chatDb.CloudDocumentVersion.destroy({ where: { documentId } });
      await app.chatDb.CloudDocumentMember.destroy({ where: { documentId } });
      await app.chatDb.CloudDocument.destroy({ where: { id: documentId } });
    }
  });

  it("所有评审路由要求认证，不能依赖请求体伪造身份", async () => {
    for (const [method, url, body] of [
      ["get", "/api/document-reviews"],
      [
        "post",
        "/api/document-reviews",
        { ...input, userId: owner.id, companyId: owner.companyId },
      ],
      ["get", "/api/document-reviews/1"],
      [
        "post",
        "/api/document-reviews/1/decision",
        { requestKey: randomUUID(), decision: "approve" },
      ],
      ["get", `/api/documents/${document.id}/review-options`],
    ] as const) {
      await request(method, url, null, body, 401);
    }
  });

  it("选项仅向编辑者开放，群成员必须同时拥有文档权限并处于有效状态", async () => {
    await request(
      "get",
      `/api/documents/${document.id}/review-options`,
      assignee,
      undefined,
      403,
    );
    await request(
      "get",
      `/api/documents/${document.id}/review-options`,
      editor,
    );
    await app.chatDb.CloudDocumentMember.destroy({
      where: { documentId: document.id, userId: observer.id },
    });
    await app.chatDb.ConversationMember.update(
      { leftAt: new Date() },
      { where: { conversationId: group.id, userId: editor.id } },
    );
    await app.chatDb.User.update(
      { status: "disabled" },
      { where: { id: approver.id } },
    );
    const options = (
      await request(
        "get",
        `/api/documents/${document.id}/review-options`,
        owner,
      )
    ).data;
    const selected = options.groups.find((item: any) => item.id === group.id);
    assert.equal(selected.name, group.name);
    assert.deepEqual(
      selected.members
        .map((item: any) => item.id)
        .sort((a: number, b: number) => a - b),
      [owner.id, assignee.id],
    );
    assert.ok(
      selected.members.every(
        (item: any) => Object.keys(item).sort().join(",") === "avatar,id,name",
      ),
    );
    await request(
      "get",
      `/api/documents/${document.id}/review-options`,
      foreign,
      undefined,
      404,
    );
  });

  it("编辑者可提交，认证身份覆盖请求体中的企业与提交人字段", async () => {
    const review = await submit(
      {
        submitterId: foreign.id,
        companyId: foreign.companyId,
        userId: owner.id,
      },
      editor,
    );
    assert.equal(review.submitterId, editor.id);
    assert.equal(review.status, "pending_review");
    assert.equal(review.taskId, null);
    assert.equal(review.documentTitle, "提交时的文档标题");
    assert.equal(review.dueAt, "2026-10-10T08:00:00.000Z");
    assert.ok(review.documentVersionId > 0);
    for (const field of [
      "requestKey",
      "requestHash",
      "decisionKey",
      "yjsState",
      "passwordHash",
    ])
      assert.equal(review[field], undefined);
    assert.equal((await reviewNotifications(approver, review.id)).length, 1);
    await request(
      "post",
      "/api/document-reviews",
      assignee,
      { ...input, requestKey: randomUUID() },
      403,
    );
    await request("post", "/api/document-reviews", foreign, input, 404);
  });

  it("提交自动保存版本，修改标题、正文及新建版本后详情仍预览提交时快照", async () => {
    const review = await submit();
    const before = (
      await request("get", `/api/document-reviews/${review.id}`, approver)
    ).data;
    assert.equal(before.version.id, review.documentVersionId);
    assert.equal(before.version.text, "提交时的不可变正文");
    assert.equal(before.version.title, "提交时的文档标题");
    await context(owner).service.documents.update(document.id, {
      title: "后来修改的标题",
    });
    await app.chatDb.CloudDocument.update(
      { yjsState: documentState("后来修改的正文") },
      { where: { id: document.id } },
    );
    await context(owner).service.documentVersions.create(document.id, {
      label: "后来保存版本",
    });
    const after = (
      await request("get", `/api/document-reviews/${review.id}`, assignee)
    ).data;
    assert.equal(after.documentVersionId, review.documentVersionId);
    assert.deepEqual(after.version, before.version);
    assert.equal(after.documentTitle, "提交时的文档标题");
  });

  it("真实在线协作尚未落库的正文也能提交固定快照，继续编辑不改变评审版本", async () => {
    const previousServer = app.collaborationServer;
    const previousPort = process.env.CHAT_COLLABORATION_PORT;
    process.env.CHAT_COLLABORATION_PORT = "0";
    let server: Awaited<ReturnType<typeof startCollaborationServer>>;
    try {
      server = await startCollaborationServer(app);
    } finally {
      if (previousPort === undefined)
        delete process.env.CHAT_COLLABORATION_PORT;
      else process.env.CHAT_COLLABORATION_PORT = previousPort;
    }
    app.collaborationServer = server;
    let connection: any;
    try {
      connection = await server.hocuspocus.openDirectConnection(
        `document:${document.id}`,
        {
          userId: editor.id,
          companyId: editor.companyId,
          permission: "editor",
        },
      );
      await connection.transact((live: Y.Doc) => {
        const text = live.getXmlFragment("default").get(0) as Y.XmlElement;
        const value = text.get(0) as Y.XmlText;
        value.delete(0, value.length);
        value.insert(0, "在线尚未自动落库的正文");
      });
      const review = await submit();
      const detail = (
        await request("get", `/api/document-reviews/${review.id}`, approver)
      ).data;
      assert.equal(detail.version.text, "在线尚未自动落库的正文");
      await connection.transact((live: Y.Doc) => {
        const value = (
          live.getXmlFragment("default").get(0) as Y.XmlElement
        ).get(0) as Y.XmlText;
        value.insert(value.length, "，之后继续编辑");
      });
      assert.deepEqual(
        (await request("get", `/api/document-reviews/${review.id}`, approver))
          .data.version,
        detail.version,
      );
    } finally {
      try {
        await connection?.disconnect();
        await server.destroy();
      } finally {
        app.collaborationServer = previousServer;
      }
    }
  });

  it("提交同 key 同 payload 重试不重复快照和通知，同 key 改变任一业务字段返回 409", async () => {
    const review = await submit();
    const other = await fixture();
    const before = await effects();
    const pushes = capturePushes();
    assert.deepEqual(await submit(), review);
    const changes = [
      { title: "另一标题" },
      { dueAt: "2026-10-11T08:00:00.000Z" },
      { approverId: assignee.id },
      { assigneeId: approver.id },
      { documentId: other.document.id },
      { conversationId: other.group.id },
    ];
    for (const change of changes) {
      const result = await request(
        "post",
        "/api/document-reviews",
        owner,
        { ...input, ...change },
        409,
      );
      assert.equal(result.error.code, "REQUEST_KEY_CONFLICT");
    }
    assert.deepEqual(await effects(), before);
    assert.deepEqual(pushes, []);
  });

  it("提交字段上限可取等号，非法类型、空值和超过上限不产生持久化副作用", async () => {
    await submit({ requestKey: "k".repeat(80), title: "题".repeat(180) });
    const before = await effects();
    for (const change of [
      { requestKey: "k".repeat(81) },
      { requestKey: " " },
      { requestKey: 1 },
      { title: "题".repeat(181) },
      { title: " " },
      { title: 123 },
      { dueAt: "invalid" },
      { dueAt: null },
      { documentId: 0 },
      { conversationId: -1 },
      { approverId: "NaN" },
      { assigneeId: 0 },
    ])
      await request(
        "post",
        "/api/document-reviews",
        owner,
        { ...input, requestKey: randomUUID(), ...change },
        400,
      );
    assert.deepEqual(await effects(), before);
  });

  for (const role of ["审批人", "负责人"]) {
    for (const revoked of ["文档权限", "群权限", "停用", "外企业"]) {
      it(`提交时${role}缺失${revoked}必须拒绝且不留快照或通知`, async () => {
        const target = role === "审批人" ? approver : assignee;
        if (revoked === "文档权限")
          await app.chatDb.CloudDocumentMember.destroy({
            where: { documentId: document.id, userId: target.id },
          });
        if (revoked === "群权限")
          await app.chatDb.ConversationMember.update(
            { leftAt: new Date() },
            { where: { conversationId: group.id, userId: target.id } },
          );
        if (revoked === "停用")
          await app.chatDb.User.update(
            { status: "disabled" },
            { where: { id: target.id } },
          );
        const before = await effects();
        const change =
          revoked === "外企业"
            ? { [role === "审批人" ? "approverId" : "assigneeId"]: foreign.id }
            : {};
        await request(
          "post",
          "/api/document-reviews",
          owner,
          { ...input, ...change },
          403,
        );
        assert.deepEqual(await effects(), before);
      });
    }
  }

  it("单聊、已退出群和已删除文档不能发起评审", async () => {
    const direct = await context(owner).service.chat.create({
      type: "direct",
      userId: approver.id,
    });
    await request(
      "post",
      "/api/document-reviews",
      owner,
      { ...input, conversationId: direct.id },
      403,
    );
    await app.chatDb.ConversationMember.update(
      { leftAt: new Date() },
      { where: { conversationId: group.id, userId: owner.id } },
    );
    await request("post", "/api/document-reviews", owner, input, 403);
    await app.chatDb.CloudDocument.update(
      { trashedAt: new Date() },
      { where: { id: document.id } },
    );
    await request("post", "/api/document-reviews", owner, input, 404);
  });

  it("默认 pending 仅指定审批人可见，submitted 与 all 严格限制参与者及现有访问", async () => {
    const pending = await submit();
    const rejected = await submit({ requestKey: randomUUID() });
    await decide(rejected.id, "reject");
    assert.deepEqual(
      (await list(approver)).map((item: any) => item.id),
      [pending.id],
    );
    assert.deepEqual(await list(owner), []);
    assert.deepEqual(await list(assignee), []);
    assert.deepEqual(
      (await list(owner, "submitted")).map((item: any) => item.id),
      [rejected.id, pending.id],
    );
    assert.deepEqual(await list(approver, "submitted"), []);
    for (const user of [owner, approver, assignee])
      assert.equal((await list(user, "all")).length, 2);
    assert.deepEqual(await list(observer, "all"), []);
    await request(
      "get",
      `/api/document-reviews/${pending.id}`,
      observer,
      undefined,
      403,
    );
    await request(
      "get",
      `/api/document-reviews/${pending.id}`,
      foreign,
      undefined,
      404,
    );
    await decide(pending.id, "approve", foreign, {}, 404);
    assert.deepEqual(await list(foreign, "all"), []);
    await request(
      "get",
      "/api/document-reviews?scope=unknown",
      owner,
      undefined,
      400,
    );
    await app.chatDb.CloudDocumentMember.destroy({
      where: { documentId: document.id, userId: approver.id },
    });
    assert.deepEqual(await list(approver, "all"), []);
    await request(
      "get",
      `/api/document-reviews/${pending.id}`,
      approver,
      undefined,
      403,
    );
    await decide(pending.id, "approve", approver, {}, 403);
    await app.chatDb.ConversationMember.update(
      { leftAt: new Date() },
      { where: { conversationId: group.id, userId: assignee.id } },
    );
    assert.deepEqual(await list(assignee, "all"), []);
    await request(
      "get",
      `/api/document-reviews/${pending.id}`,
      assignee,
      undefined,
      403,
    );
  });

  it("列表最多返回最近 100 条，不因 limit 参数或额外非参与记录泄漏", async () => {
    const ids: number[] = [];
    for (let index = 0; index < 101; index += 1) {
      const review = await context(owner).service.documentReviews.submit({
        ...input,
        requestKey: randomUUID(),
      });
      ids.unshift(review.id);
    }
    const page = (
      await request("get", "/api/document-reviews?scope=all&limit=1000", owner)
    ).data;
    assert.equal(page.length, 100);
    assert.deepEqual(
      page.map((item: any) => item.id),
      ids.slice(0, 100),
    );
    assert.deepEqual(await list(observer, "all"), []);
  });

  for (const decision of ["approve", "reject"]) {
    it(`${decision} 仅指定审批人可执行，同终态重试不重复 effects，另一决定返回 409`, async () => {
      const review = await submit();
      for (const user of [owner, assignee, observer]) {
        await decide(
          review.id,
          decision,
          user,
          {
            userId: approver.id,
            approverId: user.id,
            companyId: owner.companyId,
          },
          403,
        );
      }
      const key = randomUUID();
      const result = (
        await decide(review.id, decision, approver, {
          requestKey: key,
          comment: "审批意见",
        })
      ).data;
      assert.equal(result.id, review.id);
      assert.equal(
        result.status,
        decision === "approve" ? "approved" : "rejected",
      );
      assert.equal(result.decisionComment, "审批意见");
      assert.ok(result.decidedAt);
      if (decision === "approve") {
        assert.ok(result.taskId);
        const tasks = await context(assignee).service.tasks.list({
          scope: "all",
        });
        const task = tasks.find((item: any) => item.id === result.taskId)!;
        assert.equal(task.creatorId, owner.id);
        assert.equal(task.assigneeId, assignee.id);
        assert.equal(task.conversationId, group.id);
        assert.equal(task.title, "固定文档评审任务");
        assert.equal(task.dueAt, now.toISOString());
        assert.equal(task.priority, "high");
      } else assert.equal(result.taskId, null);
      assert.equal((await reviewNotifications(owner, review.id)).length, 1);
      assert.ok((await reviewNotifications(approver, review.id))[0].readAt);
      const before = await effects();
      const pushes = capturePushes();
      assert.deepEqual(
        (
          await decide(review.id, decision, approver, {
            requestKey: key,
            comment: "审批意见",
          })
        ).data,
        result,
      );
      assert.deepEqual(
        (
          await decide(review.id, decision, approver, {
            comment: "后来的意见不能覆盖原决定",
          })
        ).data,
        result,
      );
      await decide(
        review.id,
        decision === "approve" ? "reject" : "approve",
        approver,
        {},
        409,
      );
      assert.deepEqual(await effects(), before);
      assert.deepEqual(pushes, []);
    });
  }

  it("审批参数错误不产生任务；500 字审批意见合法，501 字和非字符串拒绝", async () => {
    const review = await submit();
    const before = await effects();
    for (const change of [
      { decision: "done" },
      { requestKey: "k".repeat(81) },
      { requestKey: "" },
      { comment: "字".repeat(501) },
      { comment: 123 },
    ])
      await decide(review.id, "approve", approver, change, 400);
    assert.deepEqual(await effects(), before);
    assert.equal(
      (
        await decide(review.id, "reject", approver, {
          comment: "字".repeat(500),
        })
      ).data.decisionComment.length,
      500,
    );
  });

  for (const decision of ["approve", "reject"]) {
    it(`${decision} 使用同一审批 key 改变 comment 必须 409，原决定和副作用保持不变`, async () => {
      const review = await submit();
      const requestKey = randomUUID();
      const original = (
        await decide(review.id, decision, approver, {
          requestKey,
          comment: "原始审批意见",
        })
      ).data;
      const before = await effects();
      const pushes = capturePushes();
      const conflict = await decide(
        review.id,
        decision,
        approver,
        { requestKey, comment: "不同的审批意见" },
        409,
      );
      assert.equal(conflict.error.code, "REQUEST_KEY_CONFLICT");
      assert.deepEqual(await effects(), before);
      assert.deepEqual(pushes, []);
      assert.equal(
        (await request("get", `/api/document-reviews/${review.id}`, owner)).data
          .decisionComment,
        original.decisionComment,
      );
    });
  }

  it("评审任务详情要求认证，同企业非指定审批人 403，外企业与不存在任务 404", async () => {
    const review = await submit();
    const approved = (await decide(review.id)).data;
    const url = `/api/tasks/${approved.taskId}`;
    await request("get", url, null, undefined, 401);
    for (const user of [observer, editor])
      await request("get", url, user, undefined, 403);
    await request("get", url, foreign, undefined, 404);
    await request("get", "/api/tasks/2147483647", owner, undefined, 404);
    const other = await submit({
      requestKey: randomUUID(),
      approverId: observer.id,
    });
    const otherTask = (await decide(other.id, "approve", observer)).data;
    await request(
      "get",
      `/api/tasks/${otherTask.taskId}`,
      approver,
      undefined,
      403,
    );
    assert.equal(
      (await request("get", `/api/tasks/${otherTask.taskId}`, observer)).data
        .id,
      otherTask.taskId,
    );
  });

  it("指定审批人可读取已批准任务但不可修改，默认及 mine 列表不扩容", async () => {
    const review = await submit();
    const approved = (await decide(review.id)).data;
    const url = `/api/tasks/${approved.taskId}`;
    const task = (await request("get", url, approver)).data;
    assert.equal(task.id, approved.taskId);
    assert.equal(task.creatorId, owner.id);
    assert.equal(task.assigneeId, assignee.id);
    for (const query of ["", "?scope=mine"]) {
      const items = (await request("get", `/api/tasks${query}`, approver)).data;
      assert.equal(
        items.some((item: any) => item.id === task.id),
        false,
      );
    }
    const before = await effects();
    for (const body of [
      { status: "done" },
      {
        title: "审批人不能重命名",
        creatorId: approver.id,
        assigneeId: approver.id,
      },
    ])
      await request("patch", url, approver, body, 403);
    assert.deepEqual((await request("get", url, approver)).data, task);
    assert.deepEqual(await effects(), before);
    for (const user of [owner, assignee]) {
      assert.equal((await request("get", url, user)).data.id, task.id);
      const mine = (await request("get", "/api/tasks?scope=mine", user)).data;
      assert.ok(mine.some((item: any) => item.id === task.id));
    }
    assert.equal(
      (await request("patch", url, owner, { title: "创建者仍可修改标题" })).data
        .title,
      "创建者仍可修改标题",
    );
    assert.equal(
      (await request("patch", url, assignee, { status: "in_progress" })).data
        .status,
      "in_progress",
    );
  });

  for (const access of ["文档", "群聊"]) {
    it(`审批人被撤销${access}权限后不能读取任务，创建者与负责人仍可读且恢复权限重新可读`, async () => {
      const review = await submit();
      const approved = (await decide(review.id)).data;
      const url = `/api/tasks/${approved.taskId}`;
      await request("get", url, approver);
      if (access === "文档")
        await app.chatDb.CloudDocumentMember.destroy({
          where: { documentId: document.id, userId: approver.id },
        });
      else
        await app.chatDb.ConversationMember.update(
          { leftAt: new Date() },
          { where: { conversationId: group.id, userId: approver.id } },
        );
      const before = await effects();
      await request("get", url, approver, undefined, 403);
      await request("patch", url, approver, { status: "done" }, 403);
      for (const user of [owner, assignee])
        assert.equal(
          (await request("get", url, user)).data.id,
          approved.taskId,
        );
      assert.deepEqual(await effects(), before);
      if (access === "文档")
        await app.chatDb.CloudDocumentMember.create({
          documentId: document.id,
          userId: approver.id,
          permission: "viewer",
        });
      else
        await app.chatDb.ConversationMember.update(
          { leftAt: null },
          { where: { conversationId: group.id, userId: approver.id } },
        );
      assert.equal(
        (await request("get", url, approver)).data.id,
        approved.taskId,
      );
    });
  }

  it("审批人的只读例外仅限已批准评审关联任务，不能读取同群普通任务", async () => {
    const review = await submit();
    await decide(review.id);
    const ordinary = await context(owner).service.tasks.create({
      title: "同群普通任务",
      assigneeId: assignee.id,
      conversationId: group.id,
    });
    await request("get", `/api/tasks/${ordinary.id}`, approver, undefined, 403);
    for (const user of [owner, assignee])
      assert.equal(
        (await request("get", `/api/tasks/${ordinary.id}`, user)).data.id,
        ordinary.id,
      );
  });

  it("八个 HTTP 提交同 key 并发仅生成一个评审、一个快照和一个待审批通知", async () => {
    const before = await effects();
    const reviews = await Promise.all(
      Array.from({ length: 8 }, () => submit()),
    );
    assert.equal(new Set(reviews.map((review) => review.id)).size, 1);
    const after = await effects();
    assert.equal(after.DocumentReview - before.DocumentReview, 1);
    assert.equal(after.CloudDocumentVersion - before.CloudDocumentVersion, 1);
    assert.equal(after.Notification - before.Notification, 1);
    assert.equal(after.Task, before.Task);
  });

  for (const decisions of [
    Array(8).fill("approve"),
    Array(8).fill("reject"),
    [
      "approve",
      "reject",
      "approve",
      "reject",
      "approve",
      "reject",
      "approve",
      "reject",
    ],
  ]) {
    it(`八个 HTTP 审批并发 ${decisions.join("/")} 仅允许一个终态和一份副作用`, async () => {
      const review = await submit();
      const responses = await Promise.all(
        decisions.map((decision) =>
          app
            .httpRequest()
            .post(`/api/document-reviews/${review.id}/decision`)
            .set("Authorization", `Bearer ${signAccessToken(app, approver)}`)
            .send({ requestKey: randomUUID(), decision }),
        ),
      );
      const detail = (
        await request("get", `/api/document-reviews/${review.id}`, owner)
      ).data;
      responses.forEach((response, index) => {
        const won =
          detail.status ===
          (decisions[index] === "approve" ? "approved" : "rejected");
        assert.equal(
          response.status,
          won ? 200 : 409,
          JSON.stringify(response.body),
        );
        if (won) assert.equal(response.body.data.id, review.id);
      });
      assert.equal(
        await app.chatDb.Task.count({ where: { conversationId: group.id } }),
        detail.status === "approved" ? 1 : 0,
      );
      assert.equal((await reviewNotifications(owner, review.id)).length, 1);
      assert.equal((await reviewNotifications(approver, review.id)).length, 1);
    });
  }

  it("提交通知写入失败时快照与评审一起回滚，相同 key 恢复后仍可提交", async () => {
    const before = await effects();
    const pushes = capturePushes();
    const hits = failInsert("notifications", "review-submit-write-failed");
    await assert.rejects(
      context(owner).service.documentReviews.submit(input),
      /review-submit-write-failed/,
    );
    assert.equal(hits(), 1);
    assert.deepEqual(await effects(), before);
    assert.deepEqual(pushes, []);
    mm.restore();
    assert.equal((await submit()).status, "pending_review");
  });

  for (const table of ["messages", "sync_events", "notifications"]) {
    it(`审批在 ${table} 写入失败时评审、任务、通知、群消息及同步全部回滚`, async () => {
      const review = await submit();
      const before = await effects();
      const unread = await reviewNotifications(approver, review.id);
      const pushes = capturePushes();
      const hits = failInsert(table, `review-approve-${table}-failed`);
      const payload = { requestKey: randomUUID(), decision: "approve" };
      await assert.rejects(
        context(approver).service.documentReviews.decide(review.id, payload),
        new RegExp(`review-approve-${table}-failed`),
      );
      assert.equal(hits(), 1);
      assert.deepEqual(await effects(), before);
      assert.deepEqual(await reviewNotifications(approver, review.id), unread);
      assert.deepEqual(pushes, []);
      mm.restore();
      const current = (
        await request("get", `/api/document-reviews/${review.id}`, owner)
      ).data;
      assert.equal(current.status, "pending_review");
      assert.equal(current.taskId, null);
      assert.equal(
        (
          await context(approver).service.documentReviews.decide(
            review.id,
            payload,
          )
        ).status,
        "approved",
      );
    });
  }

  it("群到期扫描不自行生成个人提醒，到期时按顺序扫描且 receipt 和已读保证重复不发送", async () => {
    const review = await submit();
    const approved = (await decide(review.id)).data;
    assert.equal(
      await context().service.documentReviews.sendDueGroupReminders(now),
      0,
    );
    assert.deepEqual(await scan(new Date(now.getTime() - 1)), {
      notifications: 0,
      groups: 0,
    });
    assert.deepEqual(await scan(), { notifications: 1, groups: 1 });
    const receipts = await app.chatDb.DocumentReviewDelivery.findAll({
      where: { reviewId: review.id },
    });
    assert.equal(receipts.length, 1);
    const receipt = toPlain(receipts[0]);
    assert.equal(
      receipt.reminderKey,
      `task:${approved.taskId}:2026-10-10T08:00:00.000Z:${assignee.id}`,
    );
    const page = await context(assignee).service.chat.messages(group.id, {
      limit: 100,
    });
    const message = page.items.find(
      (item: any) => item.id === receipt.messageId,
    )!;
    assert.ok(message);
    assert.equal(message.kind, "system");
    assert.match(message.summary, /固定文档评审任务/);
    assert.match(message.summary, new RegExp(assignee.name));
    const notification = await app.chatDb.Notification.findOne({
      where: { reminderKey: receipt.reminderKey },
    });
    await context(assignee).service.notifications.read(
      Number(notification.get("id")),
    );
    const before = await effects();
    assert.deepEqual(await scan(), { notifications: 0, groups: 0 });
    assert.deepEqual(await effects(), before);
  });

  it("群到期投递凭据写入失败时消息和同步回滚，个人通知保留以便恢复后补投", async () => {
    const review = await submit();
    await decide(review.id);
    assert.equal(await context().service.tasks.sendDueReminders(now), 1);
    const before = await effects();
    const pushes = capturePushes();
    const hits = failInsert(
      "document_review_deliveries",
      "review-delivery-write-failed",
    );
    await assert.rejects(
      context().service.documentReviews.sendDueGroupReminders(now),
      /review-delivery-write-failed/,
    );
    assert.equal(hits(), 1);
    assert.deepEqual(await effects(), before);
    assert.deepEqual(pushes, []);
    mm.restore();
    assert.deepEqual(await scan(), { notifications: 0, groups: 1 });
    assert.deepEqual(await scan(), { notifications: 0, groups: 0 });
  });

  it("待审批和驳回没有到期任务，完成、取消或删除任务后即使已有个人提醒也不补群消息", async () => {
    await submit();
    const rejected = await submit({ requestKey: randomUUID() });
    await decide(rejected.id, "reject");
    assert.deepEqual(await scan(), { notifications: 0, groups: 0 });
    for (const status of ["done", "cancelled", "deleted"]) {
      const review = await submit({ requestKey: randomUUID() });
      const approved = (await decide(review.id)).data;
      await context().service.tasks.sendDueReminders(now);
      if (status === "deleted")
        await context(owner).service.tasks.remove(approved.taskId);
      else
        await context(owner).service.tasks.update(approved.taskId, { status });
      assert.equal(
        await context().service.documentReviews.sendDueGroupReminders(now),
        0,
      );
      assert.equal(
        await app.chatDb.DocumentReviewDelivery.count({
          where: { reviewId: review.id },
        }),
        0,
      );
    }
  });

  it("变更截止或负责人按当前组合再提醒，恢复旧组合与终态重开不重复", async () => {
    const review = await submit();
    const approved = (await decide(review.id)).data;
    assert.deepEqual(await scan(), { notifications: 1, groups: 1 });
    const later = new Date("2026-10-10T09:00:00.000Z");
    await context(owner).service.tasks.update(approved.taskId, {
      dueAt: later.toISOString(),
    });
    assert.deepEqual(await scan(), { notifications: 0, groups: 0 });
    assert.deepEqual(await scan(later), { notifications: 1, groups: 1 });
    await context(owner).service.tasks.update(approved.taskId, {
      assigneeId: editor.id,
    });
    assert.deepEqual(await scan(later), { notifications: 1, groups: 1 });
    await context(owner).service.tasks.update(approved.taskId, {
      assigneeId: assignee.id,
      dueAt: now.toISOString(),
    });
    assert.deepEqual(await scan(later), { notifications: 0, groups: 0 });
    await context(owner).service.tasks.update(approved.taskId, {
      status: "done",
    });
    await context(owner).service.tasks.update(approved.taskId, {
      status: "todo",
    });
    assert.deepEqual(await scan(later), { notifications: 0, groups: 0 });
    assert.equal(
      await app.chatDb.DocumentReviewDelivery.count({
        where: { reviewId: review.id },
      }),
      3,
    );
  });

  for (const access of [
    "文档成员",
    "群成员",
    "有效用户",
    "文档存在",
    "群存在",
  ]) {
    it(`到期补投时撤销${access}不泄漏群消息，恢复后仍能补投且只投一次`, async () => {
      const review = await submit();
      await decide(review.id);
      await context().service.tasks.sendDueReminders(now);
      let restore: () => Promise<any>;
      if (access === "文档成员") {
        await app.chatDb.CloudDocumentMember.destroy({
          where: { documentId: document.id, userId: assignee.id },
        });
        restore = () =>
          app.chatDb.CloudDocumentMember.create({
            documentId: document.id,
            userId: assignee.id,
            permission: "viewer",
          });
      } else if (access === "群成员") {
        await app.chatDb.ConversationMember.update(
          { leftAt: new Date() },
          { where: { conversationId: group.id, userId: assignee.id } },
        );
        restore = () =>
          app.chatDb.ConversationMember.update(
            { leftAt: null },
            { where: { conversationId: group.id, userId: assignee.id } },
          );
      } else if (access === "有效用户") {
        await app.chatDb.User.update(
          { status: "disabled" },
          { where: { id: assignee.id } },
        );
        restore = () =>
          app.chatDb.User.update(
            { status: "active" },
            { where: { id: assignee.id } },
          );
      } else if (access === "文档存在") {
        await app.chatDb.CloudDocument.update(
          { trashedAt: new Date() },
          { where: { id: document.id } },
        );
        restore = () =>
          app.chatDb.CloudDocument.update(
            { trashedAt: null },
            { where: { id: document.id } },
          );
      } else {
        await app.chatDb.Conversation.update(
          { type: "direct" },
          { where: { id: group.id } },
        );
        restore = () =>
          app.chatDb.Conversation.update(
            { type: "group" },
            { where: { id: group.id } },
          );
      }
      const before = await effects();
      assert.equal(
        await context().service.documentReviews.sendDueGroupReminders(now),
        0,
      );
      assert.deepEqual(await effects(), before);
      await restore();
      assert.equal(
        await context().service.documentReviews.sendDueGroupReminders(now),
        1,
      );
      assert.equal(
        await context().service.documentReviews.sendDueGroupReminders(now),
        0,
      );
    });
  }

  it("两个独立 Node 同 key 提交竞争，SQLite 写锁释放后仅保存一个评审和快照", async () => {
    const first = await startReviewProcess(app.baseDir, testDatabase);
    let second: Awaited<ReturnType<typeof startReviewProcess>>;
    try {
      second = await startReviewProcess(app.baseDir, testDatabase);
      assert.notEqual(first.pid, second.pid);
      const before = await effects();
      const lock = await app.chatDb.sequelize.transaction({
        type: Transaction.TYPES.IMMEDIATE,
      });
      const operation: ReviewOperation = {
        action: "submit",
        userId: owner.id,
        input,
      };
      const competing = Promise.all([
        first.run([operation]),
        second.run([operation]),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await lock.commit();
      const results = (await competing).flat();
      assert.deepEqual(
        results.map((result) => result.status),
        [200, 200],
        JSON.stringify(results),
      );
      assert.equal(results[0].data.id, results[1].data.id);
      const after = await effects();
      assert.equal(after.DocumentReview - before.DocumentReview, 1);
      assert.equal(after.CloudDocumentVersion - before.CloudDocumentVersion, 1);
      assert.equal(after.Notification - before.Notification, 1);
    } finally {
      await Promise.all([first.close(), second?.close()]);
    }
  });

  it("两个独立 Node 发出八个 approve/reject 竞争，终态唯一且不会遗留重复任务", async () => {
    const review = await submit();
    const first = await startReviewProcess(app.baseDir, testDatabase);
    let second: Awaited<ReturnType<typeof startReviewProcess>>;
    try {
      second = await startReviewProcess(app.baseDir, testDatabase);
      const operations = [
        "approve",
        "reject",
        "approve",
        "reject",
        "reject",
        "approve",
        "reject",
        "approve",
      ].map((decision): ReviewOperation => ({
        action: "decide",
        userId: approver.id,
        reviewId: review.id,
        input: { requestKey: randomUUID(), decision },
      }));
      const results = (
        await Promise.all([
          first.run(operations.slice(0, 4)),
          second.run(operations.slice(4)),
        ])
      ).flat();
      const detail = (
        await request("get", `/api/document-reviews/${review.id}`, owner)
      ).data;
      results.forEach((result, index) => {
        const won =
          detail.status ===
          (operations[index].input!.decision === "approve"
            ? "approved"
            : "rejected");
        assert.equal(result.status, won ? 200 : 409, JSON.stringify(results));
        if (won) assert.equal(result.data.id, review.id);
        else assert.equal(result.code, "REVIEW_ALREADY_DECIDED");
      });
      assert.equal(
        await app.chatDb.Task.count({ where: { conversationId: group.id } }),
        detail.status === "approved" ? 1 : 0,
      );
      assert.equal((await reviewNotifications(owner, review.id)).length, 1);
    } finally {
      await Promise.all([first.close(), second?.close()]);
    }
  });

  it("独立 Node 并发补投及真实退出重启依靠持久化 receipt 去重，并恢复未投递提醒", async () => {
    const review = await submit();
    await decide(review.id);
    await context().service.tasks.sendDueReminders(now);
    const first = await startReviewProcess(app.baseDir, testDatabase);
    let second: Awaited<ReturnType<typeof startReviewProcess>>;
    const operation: ReviewOperation = {
      action: "scan",
      now: now.toISOString(),
    };
    try {
      second = await startReviewProcess(app.baseDir, testDatabase);
      const results = (
        await Promise.all([first.run([operation]), second.run([operation])])
      ).flat();
      assert.ok(
        results.every((result) => result.status === 200),
        JSON.stringify(results),
      );
      assert.equal(
        results.reduce((sum, result) => sum + result.data.groups, 0),
        1,
      );
      assert.equal(
        await app.chatDb.DocumentReviewDelivery.count({
          where: { reviewId: review.id },
        }),
        1,
      );
    } finally {
      await Promise.all([first.close(), second?.close()]);
    }
    const waiting = await submit({ requestKey: randomUUID() });
    await decide(waiting.id);
    await context().service.tasks.sendDueReminders(now);
    const restarted = await startReviewProcess(app.baseDir, testDatabase);
    try {
      assert.notEqual(restarted.pid, first.pid);
      const [result] = await restarted.run([operation]);
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.deepEqual(result.data, { notifications: 0, groups: 1 });
      const [retry] = await restarted.run([operation]);
      assert.deepEqual(retry.data, { notifications: 0, groups: 0 });
      assert.equal(
        await app.chatDb.DocumentReviewDelivery.count({
          where: { reviewId: review.id },
        }),
        1,
      );
      assert.equal(
        await app.chatDb.DocumentReviewDelivery.count({
          where: { reviewId: waiting.id },
        }),
        1,
      );
    } finally {
      await restarted.close();
    }
  });

  it("旧临时库缺评审表时真实初始化补表，保留原用户、文档、版本、通知和任务", async () => {
    const legacyDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "chat-review-legacy-"),
    );
    const legacyPath = path.join(legacyDirectory, "legacy.sqlite");
    let db: any;
    const savedPath = process.env.CHAT_DATABASE_PATH;
    /** 关闭旧连接后重新初始化同一临时库，模拟正式增量升级和再次重启。 */
    async function reopen() {
      await db?.sequelize.close();
      process.env.CHAT_DATABASE_PATH = legacyPath;
      db = await initializeDatabase({
        baseDir: legacyDirectory,
      } as Application);
      assert.equal(db.sequelize.options.storage, legacyPath);
      return db;
    }
    try {
      await reopen();
      const oldDocument = await db.CloudDocument.create({
        companyId: owner.companyId,
        ownerId: owner.id,
        title: "旧库正文",
        yjsState: documentState("旧库不可丢失的正文"),
      });
      const oldVersion = await db.CloudDocumentVersion.create({
        companyId: owner.companyId,
        documentId: oldDocument.get("id"),
        authorId: owner.id,
        title: "旧库版本",
        label: "旧版",
        contentHash: "legacy",
        yjsState: documentState("旧库版本正文"),
      });
      const oldTask = await db.Task.create({
        companyId: owner.companyId,
        creatorId: owner.id,
        assigneeId: assignee.id,
        title: "旧库任务",
      });
      const oldNotification = await db.Notification.create({
        companyId: owner.companyId,
        recipientUserId: assignee.id,
        type: "system",
        title: "旧库通知",
        entityType: "task",
        entityId: String(oldTask.get("id")),
      });
      const preserved = await Promise.all(
        [oldDocument, oldVersion, oldTask, oldNotification].map(async (row) =>
          toPlain(await row.reload()),
        ),
      );
      const userCount = await db.User.count();
      await db.sequelize
        .getQueryInterface()
        .dropTable("document_review_deliveries");
      await db.sequelize.getQueryInterface().dropTable("document_reviews");
      await reopen();
      assert.equal(await db.User.count(), userCount);
      assert.equal(await db.DocumentReview.count(), 0);
      assert.equal(await db.DocumentReviewDelivery.count(), 0);
      const models = [
        db.CloudDocument,
        db.CloudDocumentVersion,
        db.Task,
        db.Notification,
      ];
      for (let index = 0; index < models.length; index += 1)
        assert.deepEqual(
          toPlain(await models[index].findByPk(preserved[index].id)),
          preserved[index],
        );
      const query = db.sequelize.getQueryInterface();
      const reviewIndexes = await query.showIndex("document_reviews");
      assert.ok(
        reviewIndexes.some(
          (item: any) =>
            item.unique &&
            item.fields.map((field: any) => field.attribute).join(",") ===
              "company_id,submitter_id,request_key",
        ),
      );
      const deliveryIndexes = await query.showIndex(
        "document_review_deliveries",
      );
      assert.ok(
        deliveryIndexes.some(
          (item: any) =>
            item.unique &&
            item.fields.map((field: any) => field.attribute).join(",") ===
              "review_id,reminder_key",
        ),
      );
      await reopen();
      assert.equal(await db.User.count(), userCount);
      assert.deepEqual(
        toPlain(await db.CloudDocument.findByPk(preserved[0].id)),
        preserved[0],
      );
    } finally {
      await db?.sequelize.close();
      process.env.CHAT_DATABASE_PATH = savedPath;
    }
  });
});
