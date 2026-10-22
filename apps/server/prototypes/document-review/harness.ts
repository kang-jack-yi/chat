// PROTOTYPE：验证入口不接入正式路由，不启动真实协作编辑或默认数据库。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import {
  DocumentReviewPrototypeService,
  requireScratchDatabase,
} from "./service";

/** 创建带明确原型标识的临时库路径，保留文件供复核。 */
export function scratchDatabase() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "chat-workflow-PROTOTYPE-")),
    "PROTOTYPE-wipe-me.sqlite",
  );
}

/** 启动真实 Egg 应用并仅向测试应用追加三个原型接口。 */
export async function bootPrototype(databasePath: string) {
  process.env.CHAT_DATABASE_PATH = requireScratchDatabase(databasePath);
  process.env.CHAT_COLLABORATION_DISABLED = "1";
  process.env.EGG_SERVER_ENV = "unittest";
  process.env.EGG_TYPESCRIPT = "true";
  process.env.CHAT_CONSOLE_LOG_LEVEL = "ERROR";
  process.env.CHAT_LOG_LEVEL = "ERROR";
  const mm = require("egg-mock");
  const app = mm.app({
    baseDir: path.resolve(__dirname, "../.."),
    cache: false,
    clean: false,
  });
  await app.ready();
  assert.equal(
    path.resolve(app.chatDb.sequelize.options.storage),
    path.resolve(databasePath),
  );
  const workflow = new DocumentReviewPrototypeService(app);
  await workflow.initialize();
  const auth = app.middleware.auth();
  app.router.post("/prototype/reviews", auth, async (ctx) => {
    ctx.body = {
      success: true,
      data: await workflow.submit(ctx, ctx.request.body || {}),
    };
  });
  app.router.get("/prototype/reviews/:id", auth, async (ctx) => {
    ctx.body = {
      success: true,
      data: await workflow.detail(ctx, Number(ctx.params.id)),
    };
  });
  app.router.post("/prototype/reviews/:id/decision", auth, async (ctx) => {
    ctx.body = {
      success: true,
      data: await workflow.decide(
        ctx,
        Number(ctx.params.id),
        ctx.request.body || {},
      ),
    };
  });
  return { app, workflow };
}

/** 通过真实登录接口获取演示账号身份，仅在运行时保留凭据。 */
export async function login(app: any, phone: string) {
  const response = await app
    .httpRequest()
    .post("/api/auth/login")
    .send({ phone, password: "123456" })
    .expect(200);
  return {
    authorization: `Bearer ${response.body.data.accessToken}`,
    user: response.body.data.user,
  };
}

/** 创建真实文档并分享给评审成员，群聊沿用隔离库内的演示群。 */
export async function fixture(app: any) {
  const owner = await login(app, "13800000001");
  const approver = await login(app, "13800000002");
  const assignee = await login(app, "13800000003");
  const outsider = await login(app, "13800000004");
  const document = (
    await app
      .httpRequest()
      .post("/api/documents")
      .set("Authorization", owner.authorization)
      .send({ title: "工作流原型评审文档", type: "doc" })
      .expect(200)
  ).body.data;
  await app
    .httpRequest()
    .put(`/api/documents/${document.id}/members`)
    .set("Authorization", owner.authorization)
    .send({
      members: [
        { userId: approver.user.id, permission: "viewer" },
        { userId: assignee.user.id, permission: "viewer" },
      ],
    })
    .expect(200);
  const conversations = (
    await app
      .httpRequest()
      .get("/api/conversations")
      .set("Authorization", owner.authorization)
      .expect(200)
  ).body.data;
  const conversation = conversations.find((item: any) => item.type === "group");
  assert.ok(conversation);
  return { owner, approver, assignee, outsider, document, conversation };
}

/** 返回固定版本示例输入，时钟由验证脚本推进而不依赖真实等待。 */
export function reviewInput(
  data: Awaited<ReturnType<typeof fixture>>,
  requestKey = "submit-1",
) {
  return {
    requestKey,
    documentId: data.document.id,
    conversationId: data.conversation.id,
    approverId: data.approver.user.id,
    assigneeId: data.assignee.user.id,
    title: "确认文档评审结论并完成后续工作",
    dueAt: "2030-01-02T00:00:00.000Z",
  };
}

/** 关闭应用和真实数据库连接，允许同一文件在新进程继续使用。 */
export async function closePrototype(app: any) {
  await app.chatDb.sequelize.close();
  await app.close();
}
