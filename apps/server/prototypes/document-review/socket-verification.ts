// PROTOTYPE：本地端口 0、真实认证 WebSocket；不连接真实企业数据或默认服务。
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {
  bootPrototype,
  closePrototype,
  fixture,
  reviewInput,
  scratchDatabase,
} from "./harness";

/** 等待某条真实网络事件，超时应让验证明确失败。 */
function event(
  socket: any,
  name: string,
  predicate: (data: any) => boolean = () => true,
) {
  return new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(name, handler);
      reject(new Error(`等待 ${name} 超时`));
    }, 5000);
    const handler = (data: any) => {
      if (!predicate(data)) return;
      clearTimeout(timeout);
      socket.off(name, handler);
      resolve(data);
    };
    socket.on(name, handler);
  });
}

/** 使用真实登录令牌连接原有 Socket.IO 认证中间件，令牌不输出到报告。 */
async function connect(url: string, authorization: string) {
  const io = require("socket.io-client");
  const socket = io(url, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    autoConnect: false,
    query: { token: authorization.replace(/^Bearer /, "") },
    path: "/socket.io",
  });
  const connected = event(socket, "connect");
  socket.connect();
  await connected;
  return socket;
}

/** 验证提交、分配、到期和群同步提示确实到达正确身份的客户端。 */
async function main() {
  const database = scratchDatabase();
  const { app, workflow } = await bootPrototype(database);
  const clients: any[] = [];
  let server: http.Server | undefined;
  const checks: string[] = [];
  try {
    const data = await fixture(app);
    const foreignResponse = await app
      .httpRequest()
      .post("/api/auth/company-register")
      .send({
        companyName: "工作流原型隔离企业",
        name: "隔离成员",
        phone: "13990000001",
        password: "123456",
      })
      .expect(200);
    const foreignAuth = `Bearer ${foreignResponse.body.data.accessToken}`;
    server = http.createServer(app.callback());
    app.io.attach(server);
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const approver = await connect(url, data.approver.authorization);
    clients.push(approver);
    const assignee = await connect(url, data.assignee.authorization);
    clients.push(assignee);
    const foreign = await connect(url, foreignAuth);
    clients.push(foreign);
    let foreignEvents = 0;
    foreign.on("sync:available", () => (foreignEvents += 1));
    foreign.on("notification:available", () => (foreignEvents += 1));
    let groupEvents = 0;
    assignee.on("sync:available", () => (groupEvents += 1));
    checks.push("三个不同身份通过真实认证 WebSocket 连接，含跨企业成员");

    const pendingNotice = event(approver, "notification:available");
    const review = (
      await app
        .httpRequest()
        .post("/prototype/reviews")
        .set("Authorization", data.owner.authorization)
        .send(reviewInput(data, "socket-submit"))
        .expect(200)
    ).body.data;
    assert.ok((await pendingNotice).notificationId);
    checks.push("提交之后指定审批人实际收到通知事件");

    const assignmentNotice = event(assignee, "notification:available");
    const taskSync = event(assignee, "sync:available", (payload) =>
      Boolean(payload.taskId),
    );
    const decision = { requestKey: "socket-approve", decision: "approve" };
    const approved = (
      await app
        .httpRequest()
        .post(`/prototype/reviews/${review.id}/decision`)
        .set("Authorization", data.approver.authorization)
        .send(decision)
        .expect(200)
    ).body.data;
    assert.ok((await assignmentNotice).notificationId);
    assert.equal((await taskSync).taskId, approved.taskId);
    const tasks = (
      await app
        .httpRequest()
        .get("/api/tasks")
        .set("Authorization", data.assignee.authorization)
        .expect(200)
    ).body.data;
    assert.equal(
      tasks.filter((task: any) => task.id === approved.taskId).length,
      1,
    );
    checks.push("批准后负责人收到分配通知及群同步提示，任务已提交可读取");

    const dueNotice = event(assignee, "notification:available");
    const dueSync = event(assignee, "sync:available", (payload) =>
      Boolean(payload.messageId),
    );
    const scan = await workflow.scan(new Date(approved.dueAt));
    assert.equal(scan.groupMessagesCreated, 1);
    assert.ok((await dueNotice).notificationId);
    const messageId = (await dueSync).messageId;
    const messages = (
      await app
        .httpRequest()
        .get(`/api/conversations/${data.conversation.id}/messages?limit=100`)
        .set("Authorization", data.assignee.authorization)
        .expect(200)
    ).body.data.items;
    assert.match(
      messages.find((message: any) => message.id === messageId).summary,
      /已到期/,
    );
    checks.push("实际到期通知和群同步提示抵达，群消息可通过真实 API 读取");

    await app
      .httpRequest()
      .post(`/prototype/reviews/${review.id}/decision`)
      .set("Authorization", data.approver.authorization)
      .send(decision)
      .expect(200);
    assert.deepEqual(await workflow.scan(new Date(approved.dueAt)), {
      remindersCreated: 0,
      groupMessagesCreated: 0,
      blocked: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(groupEvents, 2);
    assert.equal(foreignEvents, 0);
    checks.push("重复回调与扫描不追加群提示，另一企业不收到流程事件");
    const report = {
      prototype: true,
      database,
      checksPassed: checks.length,
      checks,
      authenticatedClients: clients.length,
      groupEvents,
      foreignEvents,
      transport: "websocket",
      verifiedAt: new Date().toISOString(),
    };
    const reportPath = path.join(
      path.dirname(database),
      "socket-verification.json",
    );
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    for (const check of checks) console.log(`PASS ${check}`);
    console.log(`PROTOTYPE_SOCKET_REPORT=${reportPath}`);
  } finally {
    for (const client of clients) client.disconnect();
    if (server) await new Promise<void>((resolve) => app.io.close(resolve));
    await closePrototype(app);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
