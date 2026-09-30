import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Application } from "egg";
import * as Y from "yjs";
import { initializeDatabase, type ChatDatabase } from "../../app/lib/database";

describe("隔离旧数据库升级", () => {
  /** 在独立临时目录初始化数据库并最终清理，不关闭或替换全局 Egg 数据库。 */
  async function withDatabase(run: (baseDir: string, databasePath: string, db: ChatDatabase, reopen: () => Promise<ChatDatabase>) => Promise<void>) {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "chat-database-upgrade-"));
    const databasePath = path.join(baseDir, "legacy.sqlite");
    const previousPath = process.env.CHAT_DATABASE_PATH;
    const opened: ChatDatabase[] = [];
    /** 关闭当前隔离连接，再以同一临时库执行真实初始化，模拟数据库升级或重启。 */
    async function reopen() {
      if (opened.length) await opened.pop()!.sequelize.close();
      process.env.CHAT_DATABASE_PATH = databasePath;
      const isolated = { baseDir } as Application;
      const db = await initializeDatabase(isolated);
      assert.equal((db.sequelize as any).options.storage, databasePath);
      opened.push(db);
      return db;
    }
    try {
      const db = await reopen();
      await run(baseDir, databasePath, db, reopen);
    } finally {
      for (const db of opened) await db.sequelize.close();
      if (previousPath === undefined) delete process.env.CHAT_DATABASE_PATH;
      else process.env.CHAT_DATABASE_PATH = previousPath;
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  }

  it("旧库缺 reminder_key 和版本表时升级保留用户、通知和协作数据，并持久化唯一去重约束", async () => {
    await withDatabase(async (_baseDir, _databasePath, db, reopen) => {
      const user = await db.User.findOne({ where: { phone: "13800000001" } });
      const userId = Number(user!.get("id"));
      const companyId = Number(user!.get("companyId"));
      const companyCount = await db.Company.count();
      const userCount = await db.User.count();
      const doc = new Y.Doc();
      doc.getText("migration-fixture").insert(0, "必须保留的旧协作正文");
      const state = Buffer.from(Y.encodeStateAsUpdate(doc));
      doc.destroy();
      const document = await db.CloudDocument.create({ companyId, ownerId: userId, title: "旧文档", yjsState: state });
      const notification = await db.Notification.create({ companyId, recipientUserId: userId, type: "system", title: "必须保留的旧通知", entityType: "document", entityId: String(document.get("id")), payload: { marker: "legacy" } });
      const beforeNotification = (await notification.reload()).get({ plain: true });
      const query = db.sequelize.getQueryInterface();
      await query.removeIndex("notifications", "notifications_reminder_key");
      await db.sequelize.query("ALTER TABLE notifications DROP COLUMN reminder_key");
      await query.dropTable("cloud_document_versions");
      assert.equal((await query.describeTable("notifications")).reminder_key, undefined);
      const upgraded = await reopen();
      assert.equal(await upgraded.Company.count(), companyCount);
      assert.equal(await upgraded.User.count(), userCount);
      assert.equal((await upgraded.User.findByPk(userId))!.get("phone"), "13800000001");
      const preserved = (await upgraded.Notification.findByPk(notification.get("id") as number))!.get({ plain: true });
      assert.deepEqual(preserved, { ...beforeNotification, reminderKey: null });
      assert.deepEqual((await upgraded.CloudDocument.findByPk(document.get("id") as number))!.get("yjsState"), state);
      assert.ok((await upgraded.sequelize.getQueryInterface().describeTable("notifications")).reminder_key);
      assert.equal(await upgraded.CloudDocumentVersion.count(), 0);
      const indexes = await upgraded.sequelize.getQueryInterface().showIndex("notifications") as any[];
      assert.ok(indexes.some((index) => index.unique && index.fields.some((field: any) => field.attribute === "reminder_key")));
      const reminder = { companyId, recipientUserId: userId, type: "task_due", title: "到期通知", entityType: "task", entityId: "legacy-task", reminderKey: "task:legacy:2026-09-30T08:00:00.000Z:1" };
      await upgraded.Notification.create(reminder);
      await assert.rejects(upgraded.Notification.create(reminder), (error: any) => error.name === "SequelizeUniqueConstraintError");
      // 非提醒通知的 NULL 键应允许多条，不得误伤历史写入路径。
      await upgraded.Notification.bulkCreate([{ ...reminder, reminderKey: null }, { ...reminder, reminderKey: null }]);
      const restarted = await reopen();
      await assert.rejects(restarted.Notification.create(reminder), (error: any) => error.name === "SequelizeUniqueConstraintError");
      assert.equal(await restarted.Notification.count({ where: { reminderKey: reminder.reminderKey } }), 1);
      assert.equal((await restarted.Notification.findByPk(notification.get("id") as number))!.get("title"), "必须保留的旧通知");
    });
  });

  it("字段已存在但唯一索引缺失时补建索引，重复初始化不重置数据", async () => {
    await withDatabase(async (_baseDir, _databasePath, db, reopen) => {
      const user = await db.User.findOne({ where: { phone: "13800000001" } });
      const reminder = { companyId: user!.get("companyId"), recipientUserId: user!.get("id"), type: "task_due", title: "升级前提醒", entityType: "task", entityId: "1", reminderKey: "old-existing-key" };
      const original = await db.Notification.create(reminder);
      await db.sequelize.getQueryInterface().removeIndex("notifications", "notifications_reminder_key");
      const upgraded = await reopen();
      await assert.rejects(upgraded.Notification.create(reminder), (error: any) => error.name === "SequelizeUniqueConstraintError");
      assert.equal((await upgraded.Notification.findByPk(original.get("id") as number))!.get("title"), "升级前提醒");
      const restarted = await reopen();
      assert.equal(await restarted.Notification.count({ where: { reminderKey: reminder.reminderKey } }), 1);
      await assert.rejects(restarted.Notification.create(reminder), (error: any) => error.name === "SequelizeUniqueConstraintError");
    });
  });
});
