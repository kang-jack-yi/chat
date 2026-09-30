import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Context } from "egg";
import { toPlain } from "../../app/lib/database";
import { ServiceError } from "../../app/lib/service-error";

// 必须在加载 Egg 前使用隔离库；也支持运行命令指定新的临时库。
if (!process.env.CHAT_DATABASE_PATH) {
  process.env.CHAT_DATABASE_PATH = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "chat-comment-thread-race-")),
    "race.sqlite",
  );
}
const { app } = require("egg-mock/bootstrap");

/** 创建身份互不共享的请求上下文，保持真实服务与数据库调用。 */
function context(user: any): Context {
  const ctx = app.createAnonymousContext();
  ctx.currentUser = user;
  return ctx;
}

/** 使用显式屏障固定请求交错，不依赖随机延时猜测读写顺序。 */
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

/** 限时等待调度边界，避免实现变化导致测试无限等待。 */
async function waitForGate(promise: Promise<void>) {
  let timer: NodeJS.Timeout;
  try {
    await Promise.race([
      promise,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error("未命中评论并发调度边界")), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

/** 验证真实业务错误，而不是将数据库错误当作线程关闭拒绝。 */
function assertServiceError(error: unknown, status: number, code: string) {
  assert.ok(error instanceof ServiceError, `预期业务错误，实际为 ${String(error)}`);
  assert.equal(error.status, status);
  assert.equal(error.code, code);
}

describe("评论线程并发一致性", () => {
  let owner: any;
  let rootAuthor: any;
  let replyAuthor: any;
  const documentIds: number[] = [];

  before(async () => {
    assert.equal(app.chatDb.sequelize.options.storage, path.resolve(process.env.CHAT_DATABASE_PATH!));
    owner = toPlain(await app.chatDb.User.findOne({ where: { phone: "13800000001" } }));
    rootAuthor = toPlain(await app.chatDb.User.findOne({ where: { phone: "13800000003" } }));
    replyAuthor = toPlain(await app.chatDb.User.findOne({ where: { phone: "13800000004" } }));
  });

  afterEach(async () => {
    for (const documentId of documentIds.splice(0)) {
      await app.chatDb.Notification.destroy({ where: { documentId }, force: true });
      await app.chatDb.CloudDocumentComment.destroy({ where: { documentId }, force: true });
      await app.chatDb.CloudDocumentVersion.destroy({ where: { documentId }, force: true });
      await app.chatDb.CloudDocumentMember.destroy({ where: { documentId }, force: true });
      await app.chatDb.CloudDocument.destroy({ where: { id: documentId }, force: true });
    }
  });

  /** 创建两个 viewer 参与的线程，并直接构造现有接口不会再产生的旧多级回复。 */
  async function fixture() {
    const document = await context(owner).service.documents.create({ title: "评论并发回归", type: "doc" });
    documentIds.push(document.id);
    await context(owner).service.documents.share(document.id, {
      members: [
        { userId: rootAuthor.id, permission: "viewer" },
        { userId: replyAuthor.id, permission: "viewer" },
      ],
    });
    const root = await context(rootAuthor).service.documents.createComment(document.id, { content: "根评论" });
    const reply = await app.chatDb.CloudDocumentComment.create({
      companyId: owner.companyId,
      documentId: document.id,
      authorId: replyAuthor.id,
      parentId: root.id,
      content: "旧一级回复",
    });
    const nested = await app.chatDb.CloudDocumentComment.create({
      companyId: owner.companyId,
      documentId: document.id,
      authorId: replyAuthor.id,
      parentId: reply.get("id"),
      content: "旧二级回复",
    });
    return { document, root, replyId: Number(reply.get("id")), nestedId: Number(nested.get("id")) };
  }

  for (const target of ["根评论", "旧二级回复"]) {
    it(`回复${target}已读取未解决的根后，另一请求先解决提交，入事务时必须拒绝且不插入回复`, async () => {
      const { document, root, nestedId } = await fixture();
      const parentRead = gate();
      const resumeCreate = gate();
      const model = app.chatDb.CloudDocumentComment;
      const hookName = "comment-race-parent-read";
      let paused = false;
      model.addHook("afterFind", hookName, async (row: any, options: any) => {
        if (paused || Array.isArray(row) || options.transaction || Number(row?.get("id")) !== root.id) return;
        paused = true;
        assert.equal(row.get("resolvedAt"), null);
        parentRead.release();
        await resumeCreate.promise;
      });
      const creating = Promise.allSettled([
        context(replyAuthor).service.documents.createComment(document.id, {
          content: "竞态回复",
          parentId: target === "根评论" ? root.id : nestedId,
        }),
      ]);
      try {
        await waitForGate(parentRead.promise);
        await context(rootAuthor).service.documents.updateComment(document.id, root.id, { resolved: true });
        const beforeResume = await context(owner).service.documents.comments(document.id);
        assert.equal(beforeResume.length, 3);
        assert.ok(beforeResume.every((item) => item.resolved), "解决请求必须已提交且同步旧后代");
        resumeCreate.release();
        const [result] = await creating;
        assert.equal(result.status, "rejected", "事务内必须重新检查根线程是否已解决");
        if (result.status === "rejected") assertServiceError(result.reason, 409, "COMMENT_THREAD_RESOLVED");
        assert.deepEqual(await context(owner).service.documents.comments(document.id), beforeResume);
      } finally {
        resumeCreate.release();
        await creating;
        model.removeHook("afterFind", hookName);
      }
    });
  }

  it("解决已读取旧后代集合但尚未写入时，新回复先提交，解决完成后全线程状态仍须一致", async () => {
    const { document, root, nestedId } = await fixture();
    const resolveReady = gate();
    const resumeResolve = gate();
    const model = app.chatDb.CloudDocumentComment;
    const hookName = "comment-race-before-resolve-write";
    let paused = false;
    model.addHook("beforeBulkUpdate", hookName, async (options: any) => {
      if (paused || Number(options.where?.documentId) !== document.id) return;
      paused = true;
      resolveReady.release();
      await resumeResolve.promise;
    });
    const resolving = Promise.allSettled([
      context(rootAuthor).service.documents.updateComment(document.id, root.id, { resolved: true }),
    ]);
    try {
      await waitForGate(resolveReady.promise);
      const reply = await context(replyAuthor).service.documents.createComment(document.id, {
        content: "解决写入前已提交的新回复",
        parentId: nestedId,
      });
      assert.equal(reply.parentId, root.id, "旧多级回复入口必须归根");
      const beforeResolve = await context(owner).service.documents.comments(document.id);
      assert.equal(beforeResolve.length, 4);
      assert.ok(beforeResolve.every((item) => !item.resolved), "新回复必须在线程尚未解决时真实提交");
      resumeResolve.release();
      const [result] = await resolving;
      assert.equal(result.status, "fulfilled", "解决操作必须成功提交");
      const comments = await context(owner).service.documents.comments(document.id);
      assert.equal(comments.find((item) => item.id === root.id)?.resolved, true);
      assert.ok(
        comments.every((item) => item.resolved),
        `解决提交后不应遗漏并发新回复：${JSON.stringify(comments.map((item) => ({ id: item.id, parentId: item.parentId, resolved: item.resolved })))}`,
      );
    } finally {
      resumeResolve.release();
      await resolving;
      model.removeHook("beforeBulkUpdate", hookName);
    }
  });

  it("不注入屏障的同时回复与解决也不能留下已解决根的未解决回复", async () => {
    const { document } = await fixture();
    const violations: Record<string, unknown>[] = [];
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const root = await context(rootAuthor).service.documents.createComment(document.id, { content: `并发根 ${iteration}` });
      const create = () => context(replyAuthor).service.documents.createComment(document.id, {
        content: `同时回复 ${iteration}`,
        parentId: root.id,
      });
      const resolve = () => context(rootAuthor).service.documents.updateComment(document.id, root.id, { resolved: true });
      const results = await Promise.allSettled(iteration % 2 === 0 ? [create(), resolve()] : [resolve(), create()]);
      const [created, resolved] = iteration % 2 === 0 ? results : [...results].reverse();
      if (resolved.status === "rejected") {
        violations.push({ iteration, operation: "resolve", error: String(resolved.reason) });
      }
      if (created.status === "rejected" && !(created.reason instanceof ServiceError && created.reason.status === 409 && created.reason.code === "COMMENT_THREAD_RESOLVED")) {
        violations.push({ iteration, operation: "create", error: String(created.reason) });
      }
      const thread = (await context(owner).service.documents.comments(document.id))
        .filter((item) => item.id === root.id || item.parentId === root.id);
      const currentRoot = thread.find((item) => item.id === root.id);
      if (resolved.status === "fulfilled" && !currentRoot?.resolved) {
        violations.push({ iteration, operation: "resolve", error: "返回成功但根仍未解决" });
      }
      if (currentRoot?.resolved && thread.some((item) => !item.resolved)) {
        violations.push({ iteration, operation: "consistency", thread: thread.map((item) => ({ id: item.id, resolved: item.resolved })) });
      }
      assert.equal(thread.length, created.status === "fulfilled" ? 2 : 1, "成功仅追加一次，拒绝不能遗留回复");
    }
    assert.deepEqual(violations, [], "同时提交必须保持线程状态一致，且只能使用预期业务错误拒绝回复");
  });

  it("viewer 回复作者无权解决旧多级线程，viewer 根作者经回复入口可解决和重开", async () => {
    const { document, root, nestedId } = await fixture();
    await assert.rejects(
      context(replyAuthor).service.documents.updateComment(document.id, nestedId, { resolved: true }),
      (error) => { assertServiceError(error, 403, "COMMENT_RESOLVE_FORBIDDEN"); return true; },
    );
    const resolved = await context(rootAuthor).service.documents.updateComment(document.id, nestedId, { resolved: true });
    assert.equal(resolved.id, nestedId);
    const comments = await context(owner).service.documents.comments(document.id);
    const resolvedRoot = comments.find((item) => item.id === root.id)!;
    assert.equal(comments.length, 3);
    assert.ok(comments.every((item) => item.resolved && item.resolvedById === rootAuthor.id && item.resolvedAt === resolvedRoot.resolvedAt));
    await assert.rejects(
      context(replyAuthor).service.documents.updateComment(document.id, nestedId, { resolved: false }),
      (error) => { assertServiceError(error, 403, "COMMENT_RESOLVE_FORBIDDEN"); return true; },
    );
    await context(rootAuthor).service.documents.updateComment(document.id, nestedId, { resolved: false });
    assert.ok((await context(owner).service.documents.comments(document.id))
      .every((item) => !item.resolved && item.resolvedAt === null && item.resolvedById === null));
    const reply = await context(replyAuthor).service.documents.createComment(document.id, { content: "重开后回复旧链", parentId: nestedId });
    assert.equal(reply.parentId, root.id);
  });
});
