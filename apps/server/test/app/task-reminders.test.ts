import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Context } from "egg";
import mm from "egg-mock";
import { toPlain } from "../../app/lib/database";

// 在加载 Egg 测试应用前设置隔离库，单独运行本文件也不会落到默认 chat.sqlite。
if (!process.env.CHAT_DATABASE_PATH) {
  process.env.CHAT_DATABASE_PATH = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "chat-task-reminders-")),
    "reminders.sqlite",
  );
}
const { app } = require("egg-mock/bootstrap");

/** 创建互不共享登录身份的服务上下文。 */
function context(user?: any): Context {
  const ctx = app.createAnonymousContext();
  ctx.currentUser = user;
  return ctx;
}

describe("任务到期提醒", () => {
  const now = new Date("2026-09-30T08:00:00.000Z");
  let owner: any;
  let member: any;
  const taskIds: number[] = [];

  /** 通过任务服务创建测试任务，并登记仅属于本组测试的清理范围。 */
  async function createTask(input: Record<string, any> = {}) {
    const task = await context(owner).service.tasks.create({
      title: "到期提醒测试",
      assigneeId: member.id,
      dueAt: now.toISOString(),
      ...input,
    });
    taskIds.push(task.id);
    return task;
  }

  /** 通过通知服务读取某个用户收到的本组任务到期通知。 */
  async function reminders(user = member) {
    const page = await context(user).service.notifications.list({ limit: 100 });
    return page.items.filter(
      (item: any) => item.type === "task_due" && taskIds.includes(item.taskId),
    );
  }

  /** 识别到期通知插入 SQL，兼容原始 SQL 和 Sequelize 的参数绑定形式。 */
  function isDueReminderInsert(sql: any, options: any) {
    const query = typeof sql === "string" ? sql : sql?.query;
    if (!/\bINSERT\s+INTO\s+["`\[]?notifications\b/i.test(query || "")) return false;
    return query.includes("task_due") || [sql?.values, options?.bind, options?.replacements].some(
      (values) => values && Object.values(values).includes("task_due"),
    );
  }

  /** 在真实到期通知 SQL 开始前提交任务更新，确定性复现请求抢先修改任务的交错。 */
  async function updateBeforeReminder(taskId: number, input: Record<string, any>) {
    const sequelize = app.chatDb.sequelize;
    const originalQuery = sequelize.query.bind(sequelize);
    let intercepted = false;
    let updated: any;
    mm(sequelize, "query", async (sql: any, options: any) => {
      if (isDueReminderInsert(sql, options) && !intercepted) {
        intercepted = true;
        updated = await context(owner).service.tasks.update(taskId, input);
        const current = (await context(owner).service.tasks.list({ scope: "all" })).find((item: any) => item.id === taskId);
        assert.ok(current, "另一个服务上下文必须能读到已提交的任务");
        for (const key of Object.keys(input)) {
          assert.equal(current[key], input[key], "任务更新必须在原始通知插入前可见");
        }
      }
      return originalQuery(sql, options);
    });
    try {
      await context().service.tasks.sendDueReminders(now);
      assert.ok(intercepted && updated, "必须命中到期通知 SQL 边界，且任务更新已提交");
      return updated;
    } finally {
      mm.restore();
    }
  }

  before(async () => {
    owner = toPlain(await app.chatDb.User.findOne({ where: { phone: "13800000001" } }));
    member = toPlain(await app.chatDb.User.findOne({ where: { phone: "13800000003" } }));
    assert.equal(app.chatDb.sequelize.options.storage, path.resolve(process.env.CHAT_DATABASE_PATH!));
  });

  afterEach(async () => {
    for (const taskId of taskIds.splice(0)) {
      if (await app.chatDb.Task.findByPk(taskId)) {
        await context(owner).service.tasks.remove(taskId);
      }
      await app.chatDb.Notification.destroy({ where: { taskId } });
    }
  });

  it("截止时刻仅向负责人发送到期通知，重复扫描和已读后不重复", async () => {
    const task = await createTask();
    const scanner = context().service.tasks;
    await scanner.sendDueReminders(new Date(now.getTime() - 1));
    assert.equal((await reminders()).length, 0);
    await scanner.sendDueReminders(now);
    const items = await reminders();
    assert.equal(items.length, 1);
    assert.equal(items[0].taskId, task.id);
    assert.equal(items[0].entityType, "task");
    assert.equal(items[0].entityId, String(task.id));
    assert.equal(items[0].readAt, null);
    assert.match(items[0].body, /到期提醒测试/);
    assert.equal((await reminders(owner)).length, 0);
    await context(member).service.notifications.read(items[0].id);
    await context().service.tasks.sendDueReminders(now);
    assert.equal((await reminders()).length, 1);
  });

  it("定时任务每分钟由一个 worker 执行，unittest 禁止自动扫描", async () => {
    const scheduleFactory = require("../../app/schedule/task_reminders").default;
    const enabled = scheduleFactory({ config: { env: "prod" } }).schedule;
    assert.equal(enabled.interval, "1m");
    assert.equal(enabled.type, "worker");
    assert.equal(enabled.disable, false);
    assert.equal(scheduleFactory(app).schedule.disable, true);
    await createTask({ dueAt: "2020-01-01T00:00:00.000Z" });
    await app.runSchedule("task_reminders");
    assert.equal((await reminders()).length, 1);
  });

  it("仅提醒到期的 todo 和 in_progress，忽略完成、取消、未来和无截止时间任务", async () => {
    const todo = await createTask();
    const progress = await createTask();
    await context(owner).service.tasks.update(progress.id, { status: "in_progress" });
    for (const status of ["done", "cancelled"]) {
      const task = await createTask();
      await context(owner).service.tasks.update(task.id, { status });
    }
    await createTask({ dueAt: new Date(now.getTime() + 1).toISOString() });
    await createTask({ dueAt: null });
    await context().service.tasks.sendDueReminders(now);
    assert.deepEqual((await reminders()).map((item: any) => item.taskId).sort((a: number, b: number) => a - b), [todo.id, progress.id]);
  });

  it("停用、缺失或跨企业的负责人不接收到期提醒", async () => {
    const task = await createTask();
    const user = await app.chatDb.User.findByPk(member.id);
    try {
      await user.update({ status: "disabled" });
      await context().service.tasks.sendDueReminders(now);
      assert.equal((await reminders()).length, 0);
      await user.update({ status: "active" });
      await app.chatDb.Task.update({ assigneeId: -1 }, { where: { id: task.id } });
      await context().service.tasks.sendDueReminders(now);
      assert.equal((await reminders()).length, 0);
      await app.chatDb.Task.update({ assigneeId: owner.id }, { where: { id: task.id } });
      await app.chatDb.User.update({ companyId: owner.companyId + 1000 }, { where: { id: owner.id } });
      await context().service.tasks.sendDueReminders(now);
      assert.equal((await reminders(owner)).length, 0);
    } finally {
      await user.update({ status: "active" });
      await app.chatDb.User.update({ companyId: owner.companyId }, { where: { id: owner.id } });
    }
  });

  it("自己负责的任务也提醒，未改变截止时间的完成重开不重复", async () => {
    const task = await createTask({ assigneeId: owner.id });
    await context().service.tasks.sendDueReminders(now);
    assert.equal((await reminders(owner)).length, 1);
    await context(owner).service.tasks.update(task.id, { status: "done" });
    await context(owner).service.tasks.update(task.id, { status: "todo" });
    await context().service.tasks.sendDueReminders(now);
    assert.equal((await reminders(owner)).length, 1);
  });

  it("变更截止时间或转交负责人可再提醒，恢复旧组合不重复", async () => {
    const task = await createTask();
    await context().service.tasks.sendDueReminders(now);
    const later = "2026-09-30T09:00:00.000Z";
    await context(owner).service.tasks.update(task.id, { dueAt: later });
    await context().service.tasks.sendDueReminders(now);
    assert.equal((await reminders()).length, 1);
    await context().service.tasks.sendDueReminders(new Date(later));
    assert.equal((await reminders()).length, 2);
    await context(owner).service.tasks.update(task.id, { assigneeId: owner.id });
    await context().service.tasks.sendDueReminders(new Date(later));
    assert.equal((await reminders(owner)).length, 1);
    await context(owner).service.tasks.update(task.id, { assigneeId: member.id, dueAt: now.toISOString() });
    await context().service.tasks.sendDueReminders(new Date(later));
    assert.equal((await reminders()).length, 2);
    const original = await app.chatDb.Notification.findOne({
      where: { reminderKey: `task:${task.id}:2026-09-30T08:00:00.000Z:${member.id}` },
    });
    assert.ok(original);
  });

  it("并发扫描只持久化一次提醒且只向负责人推送一次，不新增实时同步数据", async () => {
    await createTask();
    const before = await context(member).service.sync.status();
    const pushes: Array<{ room: string; event: string; payload: any }> = [];
    mm(app.io, "of", () => ({
      /** 记录发送目标，模拟 Socket 传输边界。 */
      to(room: string) {
        return {
          /** 保存实际推送事件及通知标识。 */
          emit(event: string, payload: any) { pushes.push({ room, event, payload }); },
        };
      },
    }));
    try {
      await Promise.all([
        context().service.tasks.sendDueReminders(now),
        context().service.tasks.sendDueReminders(now),
      ]);
      await context().service.tasks.sendDueReminders(now);
      const items = await reminders();
      assert.equal(items.length, 1);
      assert.deepEqual(pushes, [{
        room: `user:${member.id}`,
        event: "notification:available",
        payload: { notificationId: items[0].id },
      }]);
      assert.deepEqual(await context(member).service.sync.status(), before);
    } finally {
      mm.restore();
    }
  });

  it("重新启动 Egg 并打开同一隔离库后仍然不重复提醒", async () => {
    await createTask();
    await context().service.tasks.sendDueReminders(now);
    const restarted = mm.app({ baseDir: app.baseDir, cache: false });
    try {
      await restarted.ready();
      assert.notEqual(restarted.chatDb.sequelize, app.chatDb.sequelize);
      const ctx = restarted.createAnonymousContext();
      await ctx.service.tasks.sendDueReminders(now);
      ctx.currentUser = member;
      const page = await ctx.service.notifications.list({ limit: 100 });
      const items = page.items.filter((item: any) => item.type === "task_due" && taskIds.includes(item.taskId));
      assert.equal(items.length, 1);
    } finally {
      await restarted.close();
      await restarted.chatDb?.sequelize.close();
    }
  });

  it("通知落库失败不推送也不占用去重键，恢复后可以再次扫描", async () => {
    await createTask();
    const pushes: string[] = [];
    mm(app.io, "of", () => ({
      /** 模拟 Socket 接收端并记录是否收到通知。 */
      to() {
        return {
          /** 保存外部可观察的推送事件。 */
          emit(event: string) { pushes.push(event); },
        };
      },
    }));
    const sequelize = app.chatDb.sequelize;
    const originalQuery = sequelize.query.bind(sequelize);
    let failWrite = true;
    let intercepted = false;
    mm(sequelize, "query", async (sql: any, options: any) => {
      if (failWrite && isDueReminderInsert(sql, options)) {
        intercepted = true;
        throw new Error("reminder-write-failed");
      }
      return originalQuery(sql, options);
    });
    try {
      await assert.rejects(context().service.tasks.sendDueReminders(now), /reminder-write-failed/);
      assert.ok(intercepted, "写入失败必须发生在到期通知 SQL 边界");
      assert.equal((await reminders()).length, 0);
      assert.deepEqual(pushes, []);
      failWrite = false;
      await context().service.tasks.sendDueReminders(now);
      assert.equal((await reminders()).length, 1);
      assert.deepEqual(pushes, ["notification:available"]);
    } finally {
      mm.restore();
    }
  });

  it("竞态：插入通知前任务已完成，不应再生成到期提醒", async () => {
    const task = await createTask();
    const updated = await updateBeforeReminder(task.id, { status: "done" });
    assert.equal(updated.status, "done");
    assert.equal((await context(owner).service.tasks.list({ scope: "all" })).find((item: any) => item.id === task.id)?.status, "done");
    assert.equal((await reminders()).length, 0, "完成请求先提交后不应写入迟到的到期提醒");
  });

  it("竞态：插入通知前任务已延期，不应按旧截止时间提醒", async () => {
    const task = await createTask();
    const later = "2026-09-30T09:00:00.000Z";
    const updated = await updateBeforeReminder(task.id, { dueAt: later });
    assert.equal(updated.dueAt, later);
    assert.equal((await reminders()).length, 0, "延期请求先提交后不应写入旧截止时间的提醒");
  });

  it("竞态：插入通知前任务已转交，不应提醒旧负责人", async () => {
    const task = await createTask();
    const updated = await updateBeforeReminder(task.id, { assigneeId: owner.id });
    assert.equal(updated.assigneeId, owner.id);
    await context().service.tasks.sendDueReminders(now);
    assert.equal((await reminders(owner)).length, 1, "新负责人仍应获得唯一一次到期提醒");
    assert.equal((await reminders(member)).length, 0, "转交请求先提交后不应给旧负责人写入提醒");
  });

  it("删除任务保留已经生成的分配和到期通知，后续扫描不再新增提醒", async () => {
    const task = await createTask();
    await context().service.tasks.sendDueReminders(now);
    const before = (await context(member).service.notifications.list({ limit: 100 })).items.filter((item: any) => item.taskId === task.id);
    assert.deepEqual(before.map((item: any) => item.type).sort(), ["task_assigned", "task_due"]);
    await context(owner).service.tasks.remove(task.id);
    assert.equal((await context(owner).service.tasks.list({ scope: "all" })).some((item: any) => item.id === task.id), false);
    const after = (await context(member).service.notifications.list({ limit: 100 })).items.filter((item: any) => item.taskId === task.id);
    assert.deepEqual(after, before, "与既有分配通知一致，删除任务不会级联删除历史到期通知");
    const due = after.find((item: any) => item.type === "task_due");
    assert.ok((await context(member).service.notifications.read(due.id)).readAt);
    await context().service.tasks.sendDueReminders(now);
    assert.equal((await reminders()).length, 1);
  });
});
