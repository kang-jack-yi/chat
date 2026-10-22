// PROTOTYPE：通过真实 HTTP/SQLite 和不同 Node 进程验证闭环，不接生产路由。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  bootPrototype,
  closePrototype,
  fixture,
  login,
  reviewInput,
  scratchDatabase,
} from "./harness";

/** 从命令行读取父进程传递的隔离库和阶段标识。 */
function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

/** 通过普通业务接口读取负责人可观察的通知，而不是直接断言原型内部表。 */
async function notifications(app: any, authorization: string, taskId: number) {
  const response = await app
    .httpRequest()
    .get("/api/notifications?limit=100")
    .set("Authorization", authorization)
    .expect(200);
  return response.body.data.items.filter((item: any) => item.taskId === taskId);
}

/** 通过已有聊天接口检查群消息是否实际可见。 */
async function messages(
  app: any,
  authorization: string,
  conversationId: number,
) {
  const response = await app
    .httpRequest()
    .get(`/api/conversations/${conversationId}/messages?limit=100`)
    .set("Authorization", authorization)
    .expect(200);
  return response.body.data.items;
}

/** 启动一个真实应用进程，完成单个检查阶段并输出可复核状态。 */
async function phase(name: string, databasePath: string, reviewId?: number) {
  const { app, workflow } = await bootPrototype(databasePath);
  const checks: string[] = [];
  let data: any = {};
  try {
    if (name === "submit") {
      const actors = await fixture(app);
      const input = reviewInput(actors);
      const created = await app
        .httpRequest()
        .post("/prototype/reviews")
        .set("Authorization", actors.owner.authorization)
        .send(input)
        .expect(200);
      const review = created.body.data;
      assert.equal(review.status, "pending_review");
      assert.equal(review.taskId, null);
      assert.equal(review.definitionVersion, 1);
      checks.push("提交文档进入指定成员待审批，尚未创建任务");
      const repeated = await app
        .httpRequest()
        .post("/prototype/reviews")
        .set("Authorization", actors.owner.authorization)
        .send(input)
        .expect(200);
      assert.equal(repeated.body.data.id, review.id);
      const pending = await app
        .httpRequest()
        .get("/api/notifications?limit=100")
        .set("Authorization", actors.approver.authorization)
        .expect(200);
      assert.equal(
        pending.body.data.items.filter(
          (item: any) =>
            item.title === "文档评审待审批" &&
            item.documentId === actors.document.id,
        ).length,
        1,
      );
      checks.push("重复提交不重复创建评审和审批通知");
      await app
        .httpRequest()
        .post(`/prototype/reviews/${review.id}/decision`)
        .set("Authorization", actors.owner.authorization)
        .send({ requestKey: "not-approver", decision: "approve" })
        .expect(403);
      checks.push("提交者不能代替指定审批人批准");
      data = {
        reviewId: review.id,
        conversationId: review.conversationId,
        documentId: review.documentId,
      };
    } else {
      const owner = await login(app, "13800000001");
      const approver = await login(app, "13800000002");
      const assignee = await login(app, "13800000003");
      const read = await app
        .httpRequest()
        .get(`/prototype/reviews/${reviewId}`)
        .set("Authorization", owner.authorization)
        .expect(200);
      let review = read.body.data;
      if (name === "approve") {
        assert.equal(review.status, "pending_review");
        checks.push("新 Node 进程恢复待审批实例");
        const decision = {
          requestKey: "approval-callback-1",
          decision: "approve",
        };
        review = (
          await app
            .httpRequest()
            .post(`/prototype/reviews/${reviewId}/decision`)
            .set("Authorization", approver.authorization)
            .send(decision)
            .expect(200)
        ).body.data;
        assert.equal(review.status, "approved");
        assert.ok(review.taskId);
        const repeated = await app
          .httpRequest()
          .post(`/prototype/reviews/${reviewId}/decision`)
          .set("Authorization", approver.authorization)
          .send(decision)
          .expect(200);
        assert.equal(repeated.body.data.taskId, review.taskId);
        const tasks = (
          await app
            .httpRequest()
            .get("/api/tasks")
            .set("Authorization", assignee.authorization)
            .expect(200)
        ).body.data;
        assert.equal(
          tasks.filter((item: any) => item.id === review.taskId).length,
          1,
        );
        assert.equal(
          tasks.find((item: any) => item.id === review.taskId).assigneeId,
          assignee.user.id,
        );
        checks.push("审批通过创建真实任务，重复回调复用同一任务");
        assert.equal(
          (
            await notifications(app, assignee.authorization, review.taskId)
          ).filter((item: any) => item.type === "task_assigned").length,
          1,
        );
        checks.push("负责人收到唯一任务分配通知");
        const items = await messages(
          app,
          owner.authorization,
          review.conversationId,
        );
        assert.equal(
          items.filter(
            (item: any) =>
              item.kind === "system" &&
              item.parts.some(
                (part: any) =>
                  part.type === "system_event" &&
                  part.event.type === "task_created" &&
                  part.event.title === review.title,
              ),
          ).length,
          1,
        );
        checks.push("群聊可读取唯一的任务创建系统消息");
        const early = await workflow.scan(
          new Date(new Date(review.dueAt).getTime() - 1),
        );
        assert.equal(early.remindersCreated, 0);
        assert.equal(early.groupMessagesCreated, 0);
        checks.push("截止时间前一毫秒不触发提醒或群消息");
      } else if (name === "crash-after-reminder") {
        const created = await app
          .createAnonymousContext()
          .service.tasks.sendDueReminders(new Date(review.dueAt));
        assert.equal(created, 1);
        assert.equal(
          (
            await notifications(app, assignee.authorization, review.taskId)
          ).filter((item: any) => item.type === "task_due").length,
          1,
        );
        assert.equal(review.dueMessageIds.length, 0);
        checks.push("到期通知已持久化、群消息尚未处理时异常退出");
        const result = {
          phase: name,
          pid: process.pid,
          checks,
          data: { reviewId: review.id, taskId: review.taskId },
          deliberateCrash: true,
        };
        // 模拟通知提交之后的真实进程中止；不运行 finally 清理，让下个进程恢复数据库。
        await new Promise<void>((resolve) =>
          process.stdout.write(
            `PROTOTYPE_RESULT=${JSON.stringify(result)}\n`,
            () => resolve(),
          ),
        );
        process.exit(73);
      } else if (name === "resume") {
        const resumed = await workflow.scan(new Date(review.dueAt));
        assert.deepEqual(resumed, {
          remindersCreated: 0,
          groupMessagesCreated: 1,
          blocked: 0,
        });
        checks.push("异常退出后新进程补投群消息，不重复到期通知");
        const repeated = await workflow.scan(new Date(review.dueAt));
        assert.deepEqual(repeated, {
          remindersCreated: 0,
          groupMessagesCreated: 0,
          blocked: 0,
        });
        const notices = await notifications(
          app,
          assignee.authorization,
          review.taskId,
        );
        assert.equal(
          notices.filter((item: any) => item.type === "task_due").length,
          1,
        );
        review = (
          await app
            .httpRequest()
            .get(`/prototype/reviews/${reviewId}`)
            .set("Authorization", owner.authorization)
            .expect(200)
        ).body.data;
        assert.equal(review.dueMessageIds.length, 1);
        const items = await messages(
          app,
          owner.authorization,
          review.conversationId,
        );
        assert.equal(
          items.filter((item: any) => review.dueMessageIds.includes(item.id))
            .length,
          1,
        );
        assert.match(
          items.find((item: any) => item.id === review.dueMessageIds[0])
            .summary,
          /已到期/,
        );
        checks.push("重复扫描后仍只有一条到期通知和一条群消息");
      } else if (name === "completed-and-rejected") {
        assert.equal(review.dueMessageIds.length, 1);
        checks.push("再次重启仍可读取已完成的投递记录");
        const actors = await fixture(app);
        const input = {
          ...reviewInput(actors, "completed-submit"),
          title: "已完成任务不再催办",
        };
        const created = (
          await app
            .httpRequest()
            .post("/prototype/reviews")
            .set("Authorization", owner.authorization)
            .send(input)
            .expect(200)
        ).body.data;
        const approved = (
          await app
            .httpRequest()
            .post(`/prototype/reviews/${created.id}/decision`)
            .set("Authorization", approver.authorization)
            .send({ requestKey: "completed-approval", decision: "approve" })
            .expect(200)
        ).body.data;
        await app
          .httpRequest()
          .patch(`/api/tasks/${approved.taskId}`)
          .set("Authorization", owner.authorization)
          .send({ status: "done" })
          .expect(200);
        const scan = await workflow.scan(new Date(input.dueAt));
        assert.equal(scan.remindersCreated, 0);
        assert.equal(scan.groupMessagesCreated, 0);
        checks.push("真实任务完成后不产生到期通知或催办群消息");
        const rejected = (
          await app
            .httpRequest()
            .post("/prototype/reviews")
            .set("Authorization", owner.authorization)
            .send({
              ...input,
              requestKey: "rejected-submit",
              title: "未通过评审不创建任务",
            })
            .expect(200)
        ).body.data;
        const refused = (
          await app
            .httpRequest()
            .post(`/prototype/reviews/${rejected.id}/decision`)
            .set("Authorization", approver.authorization)
            .send({ requestKey: "rejected-decision", decision: "reject" })
            .expect(200)
        ).body.data;
        assert.equal(refused.status, "rejected");
        assert.equal(refused.taskId, null);
        await app
          .httpRequest()
          .post(`/prototype/reviews/${rejected.id}/decision`)
          .set("Authorization", approver.authorization)
          .send({ requestKey: "rejected-decision", decision: "reject" })
          .expect(200);
        await app
          .httpRequest()
          .post(`/prototype/reviews/${rejected.id}/decision`)
          .set("Authorization", approver.authorization)
          .send({ requestKey: "approve-after-reject", decision: "approve" })
          .expect(409);
        checks.push("驳回不创建任务，重复驳回安全，驳回后批准返回冲突");
      } else if (name === "rollback") {
        const actors = await fixture(app);
        const input = {
          ...reviewInput(actors, "rollback-submit"),
          title: "事务回滚验证任务",
        };
        const created = (
          await app
            .httpRequest()
            .post("/prototype/reviews")
            .set("Authorization", owner.authorization)
            .send(input)
            .expect(200)
        ).body.data;
        await app.chatDb.sequelize.query(
          "CREATE TRIGGER prototype_task_failure BEFORE INSERT ON tasks WHEN NEW.title = '事务回滚验证任务' BEGIN SELECT RAISE(ABORT, 'PROTOTYPE_TASK_FAILURE'); END",
        );
        const decision = {
          requestKey: "rollback-callback",
          decision: "approve",
        };
        await app
          .httpRequest()
          .post(`/prototype/reviews/${created.id}/decision`)
          .set("Authorization", approver.authorization)
          .send(decision)
          .expect(400);
        const rolledBack = (
          await app
            .httpRequest()
            .get(`/prototype/reviews/${created.id}`)
            .set("Authorization", owner.authorization)
            .expect(200)
        ).body.data;
        assert.equal(rolledBack.status, "pending_review");
        assert.equal(rolledBack.taskId, null);
        checks.push("真实 SQLite 写入故障使审批与任务创建一起回滚");
        await app.chatDb.sequelize.query("DROP TRIGGER prototype_task_failure");
        const retry = (
          await app
            .httpRequest()
            .post(`/prototype/reviews/${created.id}/decision`)
            .set("Authorization", approver.authorization)
            .send(decision)
            .expect(200)
        ).body.data;
        assert.ok(retry.taskId);
        const items = (
          await app
            .httpRequest()
            .get("/api/tasks")
            .set("Authorization", assignee.authorization)
            .expect(200)
        ).body.data;
        assert.equal(
          items.filter((item: any) => item.title === input.title).length,
          1,
        );
        checks.push("故障解除后原回调可重试且只创建一个任务");
      } else throw new Error(`未知原型阶段：${name}`);
      data = {
        reviewId: review.id,
        taskId: review.taskId,
        dueMessageIds: review.dueMessageIds,
      };
    }
    return { phase: name, pid: process.pid, checks, data };
  } finally {
    await closePrototype(app);
  }
}

/** 在不同 Node 进程运行每个阶段，异常阶段必须真的以指定退出码中止。 */
function child(name: string, databasePath: string, reviewId?: number) {
  const args = [
    "-r",
    "ts-node/register",
    __filename,
    "--phase",
    name,
    "--database",
    databasePath,
  ];
  if (reviewId) args.push("--review", String(reviewId));
  const result = spawnSync(process.execPath, args, {
    cwd: path.resolve(__dirname, "../.."),
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, TS_NODE_FILES: "true", EGG_TYPESCRIPT: "true" },
  });
  const expectedExit = name === "crash-after-reminder" ? 73 : 0;
  if (result.error || result.status !== expectedExit) {
    throw new Error(
      `${name} 失败（退出码 ${result.status}）：${result.error?.message || ""}\n${result.stdout}\n${result.stderr}`,
    );
  }
  const line = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("PROTOTYPE_RESULT="));
  assert.ok(line, `${name} 必须输出验证状态`);
  const report = JSON.parse(line.slice("PROTOTYPE_RESULT=".length));
  for (const check of report.checks) console.log(`PASS ${check}`);
  return report;
}

/** 编排多进程验证，并在临时目录保存完整状态和 Markdown 结果。 */
async function main() {
  const name = argument("--phase");
  if (name) {
    const result = await phase(
      name,
      argument("--database")!,
      Number(argument("--review")) || undefined,
    );
    console.log(`PROTOTYPE_RESULT=${JSON.stringify(result)}`);
    return;
  }
  const database = scratchDatabase();
  const first = child("submit", database);
  const results = [first];
  for (const name of [
    "approve",
    "crash-after-reminder",
    "resume",
    "completed-and-rejected",
    "rollback",
  ])
    results.push(child(name, database, first.data.reviewId));
  assert.equal(
    new Set(results.map((result) => result.pid)).size,
    results.length,
    "恢复验证必须使用不同操作系统进程",
  );
  const checks = results.flatMap((result) => result.checks);
  const report = {
    prototype: true,
    database,
    checksPassed: checks.length,
    processCount: results.length,
    logicalDueAt: "2030-01-02T00:00:00.000Z",
    verifiedAt: new Date().toISOString(),
    results,
  };
  const directory = path.dirname(database);
  fs.writeFileSync(
    path.join(directory, "verification.json"),
    JSON.stringify(report, null, 2),
  );
  fs.writeFileSync(
    path.join(directory, "verification.md"),
    [
      "# 文档评审工作流隔离验证",
      "",
      "仅为原型，不接正式路由；所有数据在临时 SQLite。",
      "",
      "扫描时钟推进到固定截止时间，不声称等待了实际业务时间。",
      "",
      `通过 ${checks.length} 项检查，使用 ${results.length} 个独立 Node 进程；异常退出阶段码为 73。`,
      "",
      ...checks.map((check) => `- [x] ${check}`),
      "",
      `数据库：${database}`,
      "",
    ].join("\n"),
  );
  console.log(`PROTOTYPE_REPORT=${path.join(directory, "verification.json")}`);
}

// 显式退出是独立验证 CLI 的行为；之前必须完成断言并清理真实应用和数据库连接。
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
