import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Context } from "egg";
import type { Server } from "@hocuspocus/server";
import * as Y from "yjs";
import { startCollaborationServer } from "../../app/lib/collaboration";
import { signAccessToken } from "../../app/lib/auth";
import { documentText } from "../../app/lib/document-content";
import { toPlain } from "../../app/lib/database";

// 单独执行也必须在加载 Egg 前选择隔离库。
if (!process.env.CHAT_DATABASE_PATH) {
  process.env.CHAT_DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "chat-collaboration-")), "test.sqlite");
}
const { app } = require("egg-mock/bootstrap");

/** 创建可手动释放的异步屏障，精确暂停真实加载、卸载或恢复流程。 */
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

/** 在限定时间内等待真实协作生命周期结束，超时则明确使测试失败。 */
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "等待真实协作生命周期完成超时");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** 替换真实 Yjs 文档的段落正文，用于验证持久化及恢复内容。 */
function replaceText(document: Y.Doc, text: string) {
  const fragment = document.getXmlFragment("default");
  fragment.delete(0, fragment.length);
  const paragraph = new Y.XmlElement("paragraph");
  const value = new Y.XmlText();
  value.insert(0, text);
  paragraph.insert(0, [value]);
  fragment.insert(0, [paragraph]);
}

describe("真实 Hocuspocus 持久化与版本恢复保护", () => {
  let owner: any;
  let editor: any;
  let outsider: any;
  const documentIds: number[] = [];

  /** 创建独立的文档所有者上下文，避免测试共享请求身份。 */
  function context(): Context {
    const ctx = app.createAnonymousContext();
    ctx.currentUser = owner;
    return ctx;
  }

  before(async () => {
    assert.equal(app.chatDb.sequelize.options.storage, path.resolve(process.env.CHAT_DATABASE_PATH!));
    owner = toPlain(await app.chatDb.User.findOne({ where: { phone: "13800000001" } }));
    editor = toPlain(await app.chatDb.User.findOne({ where: { phone: "13800000002" } }));
    outsider = toPlain(await app.chatDb.User.findOne({ where: { phone: "13800000003" } }));
  });

  after(async () => {
    for (const documentId of documentIds) {
      await app.chatDb.CloudDocumentVersion.destroy({ where: { documentId }, force: true });
      await app.chatDb.CloudDocumentMember.destroy({ where: { documentId }, force: true });
      await app.chatDb.CloudDocument.destroy({ where: { id: documentId }, force: true });
    }
  });

  /** 通过业务入口创建测试文档，并登记本组测试的清理范围。 */
  async function createDocument() {
    const document = await context().service.documents.create({ title: "真实协作原始标题", type: "doc" });
    documentIds.push(document.id);
    return document;
  }

  /** 使用随机端口运行真实协作实例，并在结束后释放连接、销毁服务及还原 app。 */
  async function withServer(run: (server: Server<any>, connect: (id: number) => Promise<any>) => Promise<void>) {
    const previousServer = app.collaborationServer;
    const previousPort = process.env.CHAT_COLLABORATION_PORT;
    let server: Server<any>;
    try {
      process.env.CHAT_COLLABORATION_PORT = "0";
      server = await startCollaborationServer(app);
    } finally {
      if (previousPort === undefined) delete process.env.CHAT_COLLABORATION_PORT;
      else process.env.CHAT_COLLABORATION_PORT = previousPort;
    }
    const connections: any[] = [];
    app.collaborationServer = server;
    try {
      assert.ok(server.httpServer.address());
      assert.notEqual((server.httpServer.address() as any).port, 1234);
      await run(server, async (id) => {
        const connection = await server.hocuspocus.openDirectConnection(`document:${id}`, {
          userId: editor.id, companyId: editor.companyId, permission: "editor",
        });
        connections.push(connection);
        return connection;
      });
    } finally {
      try {
        for (const connection of connections) await connection.disconnect();
        await server.destroy();
      } finally {
        app.collaborationServer = previousServer;
      }
    }
  }

  /** 使用指定用户身份请求真实恢复接口，便于校验权限和协作保护响应。 */
  function restore(id: number, versionId: number, user = owner) {
    return app.httpRequest().post(`/api/documents/${id}/versions/${versionId}/restore`)
      .set("Authorization", `Bearer ${signAccessToken(app, user)}`);
  }

  it("尚无版本的既有文档第一次真实自动存储保留更新前正文和最新正文", async () => {
    const fixture = new Y.Doc();
    replaceText(fixture, "既有文档原始正文");
    const originalState = Buffer.from(Y.encodeStateAsUpdate(fixture));
    fixture.destroy();
    const row = await app.chatDb.CloudDocument.create({ companyId: owner.companyId, ownerId: owner.id, title: "既有未建版本文档", yjsState: originalState });
    const documentId = Number(row.get("id"));
    documentIds.push(documentId);
    await app.chatDb.CloudDocumentMember.create({ documentId, userId: owner.id, permission: "owner" });
    assert.equal(await app.chatDb.CloudDocumentVersion.count({ where: { documentId } }), 0);
    await withServer(async (server, connect) => {
      const connection = await connect(documentId);
      assert.equal(documentText(Buffer.from(Y.encodeStateAsUpdate(connection.document))), "既有文档原始正文");
      await connection.transact((doc: Y.Doc) => replaceText(doc, "首次自动存储后的正文"));
      await connection.disconnect();
      await waitFor(() => !server.hocuspocus.documents.has(`document:${documentId}`) && !server.hocuspocus.unloadingDocuments.has(`document:${documentId}`));
      const service = context().service.documentVersions;
      const versions = await service.list(documentId);
      assert.equal(versions.length, 2);
      assert.equal((await service.preview(documentId, versions[1].id)).text, "既有文档原始正文");
      assert.equal(versions[1].author.id, owner.id);
      assert.equal((await service.preview(documentId, versions[0].id)).text, "首次自动存储后的正文");
      assert.equal(versions[0].author.id, editor.id);
      const unchanged = await connect(documentId);
      await unchanged.disconnect();
      assert.equal((await service.list(documentId)).length, 2);
    });
  });

  it("真实存储创建初版和最新快照、去重；活动及待保存时拒绝恢复，释放后恢复并重新加载", async () => {
    const document = await createDocument();
    await withServer(async (server, connect) => {
      const service = context().service.documentVersions;
      const name = `document:${document.id}`;
      const initial = (await service.list(document.id))[0];
      const initialRow = await app.chatDb.CloudDocumentVersion.findByPk(initial.id);
      const initialState = initialRow!.get("yjsState");
      const first = await connect(document.id);
      await first.transact((doc: Y.Doc) => replaceText(doc, "首轮真实保存"));
      await first.disconnect();
      await waitFor(() => !server.hocuspocus.documents.has(name) && !server.hocuspocus.unloadingDocuments.has(name));
      const saved = await app.chatDb.CloudDocument.findByPk(document.id);
      assert.equal(documentText(saved!.get("yjsState") as Buffer), "首轮真实保存");
      assert.equal(saved!.get("lastEditorId"), editor.id);
      const versions = await service.list(document.id);
      assert.equal(versions.length, 2, "初始版本和第一次实际协作保存各一份");
      assert.equal(versions[0].author.id, editor.id);
      assert.equal((await service.preview(document.id, versions[0].id)).text, "首轮真实保存");
      const historical = versions[0];

      const unchanged = await connect(document.id);
      assert.equal(documentText(Buffer.from(Y.encodeStateAsUpdate(unchanged.document))), "首轮真实保存");
      await unchanged.disconnect();
      await waitFor(() => !server.hocuspocus.documents.has(name) && !server.hocuspocus.unloadingDocuments.has(name));
      assert.equal((await service.list(document.id)).length, 2, "相同协作状态不得重复创建自动版本");

      await context().service.documents.update(document.id, { title: "最新标题" });
      const active = await connect(document.id);
      await active.transact((doc: Y.Doc) => replaceText(doc, "恢复前最新正文"));
      const manual = await app.httpRequest().post(`/api/documents/${document.id}/versions`)
        .set("Authorization", `Bearer ${signAccessToken(app, owner)}`).send({ label: "在线手动保存" }).expect(200);
      assert.equal((await service.preview(document.id, manual.body.data.id)).text, "恢复前最新正文");
      const count = await app.chatDb.CloudDocumentVersion.count({ where: { documentId: document.id } });
      const denied = await restore(document.id, historical.id).expect(409);
      assert.equal(denied.body.error.code, "DOCUMENT_COLLABORATION_ACTIVE");
      const hidden = await restore(document.id, historical.id, outsider).expect(404);
      assert.equal(hidden.body.error.code, "DOCUMENT_NOT_FOUND", "活动协作状态不得对非成员暴露");
      assert.equal(await app.chatDb.CloudDocumentVersion.count({ where: { documentId: document.id } }), count);
      await active.disconnect({ unloadImmediately: false });
      assert.equal(active.document, null);
      assert.ok(server.hocuspocus.documents.has(name), "无连接但仍存在真实待保存状态");
      await restore(document.id, historical.id).expect(409);
      await waitFor(() => !server.hocuspocus.documents.has(name) && !server.hocuspocus.unloadingDocuments.has(name));
      await restore(document.id, historical.id).expect(200);
      const restored = await app.chatDb.CloudDocument.findByPk(document.id);
      assert.equal(restored!.get("title"), historical.title);
      assert.equal(documentText(restored!.get("yjsState") as Buffer), "首轮真实保存");
      const backup = (await service.list(document.id)).find((item) => item.label === "恢复前自动备份")!;
      assert.ok(backup);
      assert.equal((await service.preview(document.id, backup.id)).text, "恢复前最新正文");
      assert.deepEqual((await app.chatDb.CloudDocumentVersion.findByPk(initial.id))!.get("yjsState"), initialState);
      assert.equal((await service.preview(document.id, historical.id)).text, "首轮真实保存");
      const reloaded = await connect(document.id);
      assert.equal(documentText(Buffer.from(Y.encodeStateAsUpdate(reloaded.document))), "首轮真实保存");
    });
  });

  it("真实加载尚未完成时 loadingDocuments 阻止恢复且不新增快照", async () => {
    const document = await createDocument();
    await withServer(async (server, connect) => {
      const entered = gate();
      const release = gate();
      const name = `document:${document.id}`;
      server.hocuspocus.configuration.extensions.push({
        async onLoadDocument({ documentName }) {
          if (documentName === name) { entered.release(); await release.promise; }
        },
      });
      const loading = connect(document.id);
      try {
        await entered.promise;
        assert.ok(server.hocuspocus.loadingDocuments.has(name));
        assert.equal(server.hocuspocus.documents.has(name), false);
        const versions = await context().service.documentVersions.list(document.id);
        await restore(document.id, versions[0].id).expect(409);
        assert.equal((await context().service.documentVersions.list(document.id)).length, versions.length);
      } finally {
        release.release();
        await loading;
      }
    });
  });

  it("真实卸载已移除 documents 但 unloadingDocuments 未释放时仍禁止恢复", async () => {
    const document = await createDocument();
    await withServer(async (server, connect) => {
      const entered = gate();
      const release = gate();
      const name = `document:${document.id}`;
      server.hocuspocus.configuration.extensions.push({
        async afterUnloadDocument({ documentName }) {
          if (documentName === name) { entered.release(); await release.promise; }
        },
      });
      const connection = await connect(document.id);
      await connection.transact((doc: Y.Doc) => replaceText(doc, "卸载时保存的正文"));
      const disconnecting = connection.disconnect();
      const initial = (await context().service.documentVersions.list(document.id)).at(-1)!;
      try {
        await entered.promise;
        assert.equal(server.hocuspocus.documents.has(name), false);
        assert.ok(server.hocuspocus.unloadingDocuments.has(name));
        await restore(document.id, initial.id).expect(409);
      } finally {
        release.release();
        await disconnecting;
      }
      await waitFor(() => !server.hocuspocus.unloadingDocuments.has(name));
      await restore(document.id, initial.id).expect(200);
    });
  });

  it("恢复标志阻止恢复事务期间真实加载和第二次恢复，完成后释放并可重新加载", async () => {
    const document = await createDocument();
    await withServer(async (server, connect) => {
      const entered = gate();
      const release = gate();
      const version = (await context().service.documentVersions.list(document.id))[0];
      app.chatDb.CloudDocumentVersion.addHook("beforeFind", "regression-restore-gate", async (options: any) => {
        if (options.where?.id === version.id && options.where?.documentId === document.id) {
          entered.release();
          await release.promise;
        }
      });
      const restoring = context().service.documentVersions.restore(document.id, version.id);
      try {
        await entered.promise;
        assert.ok(app.documentRestores.has(document.id));
        await assert.rejects(connect(document.id), /文档正在恢复/);
        await restore(document.id, version.id).expect(409);
        await restore(document.id, version.id, outsider).expect(404);
      } finally {
        release.release();
        app.chatDb.CloudDocumentVersion.removeHook("beforeFind", "regression-restore-gate");
        await restoring;
      }
      assert.equal(app.documentRestores.has(document.id), false);
      assert.equal(server.hocuspocus.loadingDocuments.has(`document:${document.id}`), false);
      const loaded = await connect(document.id);
      assert.equal(documentText(Buffer.from(Y.encodeStateAsUpdate(loaded.document))), (await context().service.documentVersions.preview(document.id, version.id)).text);
    });
  });

  it("真实 Database 存储扩展的版本写入失败时正文、最后编辑者及版本一起回滚，重试可保存", async () => {
    const document = await createDocument();
    await withServer(async (server, connect) => {
      const name = `document:${document.id}`;
      const before = (await app.chatDb.CloudDocument.findByPk(document.id))!.get({ plain: true });
      const versionCount = await app.chatDb.CloudDocumentVersion.count({ where: { documentId: document.id } });
      const connection = await connect(document.id);
      await connection.transact((doc: Y.Doc) => replaceText(doc, "事务失败后需要重试保存的正文"));
      let failedWrites = 0;
      app.chatDb.CloudDocumentVersion.addHook("beforeCreate", "regression-auto-version-failure", (row: any) => {
        if (row.get("documentId") === document.id && row.get("label") === "自动保存") {
          failedWrites++;
          throw new Error("regression-auto-version-write-failed");
        }
      });
      try {
        // 从真实协作实例立即刷新存储钩子，实际 Database 扩展仍调用 persistCollaboration。
        await server.hocuspocus.storeDocumentHooks(connection.document, {
          clientsCount: connection.document.getConnectionsCount(),
          lastContext: connection.context,
          lastTransactionOrigin: { source: "local", context: connection.context },
          document: connection.document,
          documentName: name,
          instance: server.hocuspocus,
        }, true);
        assert.equal(failedWrites, 1, "必须实际到达自动版本数据库写入");
        const after = (await app.chatDb.CloudDocument.findByPk(document.id))!.get({ plain: true });
        assert.deepEqual(after, before, "正文、编辑者及更新时间不能部分提交");
        assert.equal(await app.chatDb.CloudDocumentVersion.count({ where: { documentId: document.id } }), versionCount);
        assert.equal(documentText(Buffer.from(Y.encodeStateAsUpdate(connection.document))), "事务失败后需要重试保存的正文");
      } finally {
        app.chatDb.CloudDocumentVersion.removeHook("beforeCreate", "regression-auto-version-failure");
      }
      await connection.disconnect();
      await waitFor(() => !server.hocuspocus.documents.has(name) && !server.hocuspocus.unloadingDocuments.has(name));
      const saved = await app.chatDb.CloudDocument.findByPk(document.id);
      assert.equal(documentText(saved!.get("yjsState") as Buffer), "事务失败后需要重试保存的正文");
      assert.equal(saved!.get("lastEditorId"), editor.id);
      assert.equal(await app.chatDb.CloudDocumentVersion.count({ where: { documentId: document.id } }), versionCount + 1);
    });
  });

  it("恢复最终快照失败时回滚正文、标题与备份，释放锁；缺失版本失败也不遗留锁", async () => {
    const document = await createDocument();
    await withServer(async (server, connect) => {
      const name = `document:${document.id}`;
      const service = context().service.documentVersions;
      const original = (await service.list(document.id))[0];
      await context().service.documents.update(document.id, { title: "回滚后必须保留的当前标题" });
      const connection = await connect(document.id);
      await connection.transact((doc: Y.Doc) => replaceText(doc, "回滚后必须保留的当前正文"));
      await connection.disconnect();
      await waitFor(() => !server.hocuspocus.documents.has(name) && !server.hocuspocus.unloadingDocuments.has(name));
      const before = (await app.chatDb.CloudDocument.findByPk(document.id))!.get({ plain: true });
      const versionsBefore = await service.list(document.id);
      app.chatDb.CloudDocumentVersion.addHook("beforeCreate", "regression-restore-version-failure", (row: any) => {
        if (row.get("documentId") === document.id && String(row.get("label")).startsWith("恢复版本 #")) {
          throw new Error("regression-restore-version-write-failed");
        }
      });
      try {
        await assert.rejects(service.restore(document.id, original.id), /regression-restore-version-write-failed/);
      } finally {
        app.chatDb.CloudDocumentVersion.removeHook("beforeCreate", "regression-restore-version-failure");
      }
      assert.deepEqual((await app.chatDb.CloudDocument.findByPk(document.id))!.get({ plain: true }), before);
      assert.deepEqual(await service.list(document.id), versionsBefore, "失败恢复不得留下备份或最终快照");
      assert.equal(app.documentRestores.has(document.id), false);
      const reloaded = await connect(document.id);
      assert.equal(documentText(Buffer.from(Y.encodeStateAsUpdate(reloaded.document))), "回滚后必须保留的当前正文");
      await reloaded.disconnect();
      await waitFor(() => !server.hocuspocus.documents.has(name) && !server.hocuspocus.unloadingDocuments.has(name));
      const missing = await restore(document.id, 2147483647).expect(404);
      assert.equal(missing.body.error.code, "DOCUMENT_VERSION_NOT_FOUND");
      assert.equal(app.documentRestores.has(document.id), false);
      await restore(document.id, original.id).expect(200);
      assert.equal((await app.chatDb.CloudDocument.findByPk(document.id))!.get("title"), original.title);
    });
  });
});
