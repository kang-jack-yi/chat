import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { createServer } from "vite";

const desktopRoot = path.resolve(import.meta.dirname, "..");
const serverRoot = path.resolve(desktopRoot, "../server");
const serverRequire = createRequire(path.join(serverRoot, "package.json"));
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "chat-review-browser-"),
);
const databasePath = path.join(directory, "verification.sqlite");
const checks = [];
const errors = [];
const failureUi = [];
let app;
let api;
let vite;
let browser;

/** 记录已完成的真实页面行为，仅断言通过后写入结果。 */
function passed(name) {
  checks.push(name);
  console.log(`PASS ${name}`);
}

/** 从真实隔离 HTTP 接口读取响应，不在报告里输出认证令牌。 */
async function login(phone) {
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

/** 通过真实下拉菜单选择字段值，保留可观察的鼠标和键盘交互。 */
async function choose(page, label, option) {
  const input = page.getByRole("combobox", { name: label });
  await input.click();
  const controls = await input.getAttribute("aria-controls");
  assert.ok(controls, "下拉框必须关联其选项列表");
  await page
    .locator(".ant-select-dropdown")
    .filter({ has: page.locator(`[id="${controls}"]`) })
    .getByText(option, { exact: true })
    .click();
}

/** 新建真实浏览器上下文，每个账号都有独立登录和 Socket 连接。 */
async function accountPage(url, phone, route = "/documents", theme = "light") {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  let reviewFrames = 0;
  page.on("websocket", (socket) =>
    socket.on("framereceived", (frame) => {
      if (String(frame.payload).includes('"review:updated"')) reviewFrames += 1;
    }),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    `${url}/__review-verification?${new URLSearchParams({ phone, route, theme })}`,
  );
  return { page, context, reviewFrames: () => reviewFrames };
}

/** 在新临时库、真实 Egg HTTP/Socket 服务和正式 React 页面之间运行评审闭环。 */
async function main() {
  process.env.CHAT_DATABASE_PATH = databasePath;
  process.env.CHAT_COLLABORATION_DISABLED = "1";
  process.env.EGG_TYPESCRIPT = "true";
  process.env.EGG_SERVER_ENV = "unittest";
  process.env.CHAT_CONSOLE_LOG_LEVEL = "ERROR";
  serverRequire("ts-node").register({
    project: path.join(serverRoot, "tsconfig.json"),
    files: true,
  });
  app = serverRequire("egg-mock").app({
    baseDir: serverRoot,
    cache: false,
    clean: false,
  });
  await app.ready();
  assert.equal(
    path.resolve(app.chatDb.sequelize.options.storage),
    databasePath,
  );
  const owner = await login("13800000001");
  const approver = await login("13800000002");
  const assignee = await login("13800000003");
  const document = (
    await app
      .httpRequest()
      .post("/api/documents/import")
      .set("Authorization", owner.authorization)
      .attach(
        "file",
        Buffer.from(
          "发布目标：完成企业协作版本上线。\n验收事项：权限隔离、审批去重、到期提醒。\n请确认评审内容，再推进后续任务。",
        ),
        { filename: "发布方案评审.txt", contentType: "text/plain" },
      )
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
  api = http.createServer(app.callback());
  app.io.attach(api);
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const apiUrl = `http://127.0.0.1:${api.address().port}`;
  vite = await createServer({
    root: desktopRoot,
    cacheDir: path.join(directory, "node_modules", ".vite"),
    plugins: [
      {
        name: "isolated-document-review-verification",
        /** 在 Vite 默认首页回退之前挂载专用验收入口。 */
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (!request.url?.startsWith("/__review-verification"))
              return next();
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(
              '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root" style="height:100vh"></div><script type="module" src="/@vite/client"></script><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/scripts/review-browser-entry.tsx"></script></body></html>',
            );
          });
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      proxy: { "/api": apiUrl, "/socket.io": { target: apiUrl, ws: true } },
    },
  });
  await vite.listen();
  const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const entryHtml = await fetch(`${url}/__review-verification`).then(
    (response) => response.text(),
  );
  assert.ok(
    entryHtml.includes("/scripts/review-browser-entry.tsx"),
    "测试入口必须加载专用初始化，不能被 Vite 默认首页接管",
  );
  const playwrightPath = process.argv[2];
  if (!playwrightPath)
    throw new Error(
      "请传入本机已安装的 playwright 模块路径；本脚本不会安装依赖",
    );
  const { chromium } = createRequire(import.meta.url)(playwrightPath);
  browser = await chromium.launch({
    headless: true,
    ...(process.argv[3] ? { channel: process.argv[3] } : {}),
  });
  const ownerBrowser = await accountPage(url, owner.user.phone);
  const ownerPage = ownerBrowser.page;
  const row = ownerPage
    .locator(".ant-table-row")
    .filter({ hasText: "发布方案评审" });
  await row.waitFor();
  await row.locator(".ant-dropdown-trigger").click();
  await ownerPage.getByText("提交评审", { exact: true }).click();
  const options = (
    await app
      .httpRequest()
      .get(`/api/documents/${document.id}/review-options`)
      .set("Authorization", owner.authorization)
      .expect(200)
  ).body.data;
  const group = options.groups.find((item) =>
    [approver.user.id, assignee.user.id].every((id) =>
      item.members.some((member) => member.id === id),
    ),
  );
  assert.ok(group);
  await choose(ownerPage, "关联群聊", group.name);
  await choose(ownerPage, "指定审批人", approver.user.name);
  await choose(ownerPage, "任务负责人", assignee.user.name);
  await ownerPage
    .getByRole("textbox", { name: "任务标题" })
    .fill("确认发布方案并推进上线");
  const due = ownerPage.getByRole("textbox", { name: "任务截止时间" });
  await due.fill("2030-01-02 00:00:00");
  await ownerPage.locator(".ant-picker-ok").getByRole("button").click();
  await ownerPage
    .locator(".ant-picker-dropdown:visible")
    .waitFor({ state: "hidden" });
  await ownerPage
    .getByRole("dialog")
    .screenshot({ path: path.join(directory, "submit-review.png") });
  await ownerPage
    .getByRole("button", { name: "提交评审", exact: true })
    .click();
  await ownerPage
    .getByRole("heading", { name: "确认发布方案并推进上线" })
    .waitFor();
  const reviewId = Number(
    new URL(ownerPage.url()).searchParams.get("reviewId"),
  );
  assert.ok(reviewId);
  await ownerPage
    .getByText(`等待${approver.user.name}审批，只有指定审批人可操作。`, {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await ownerPage.getByRole("button", { name: "通过并建任务" }).count(),
    0,
  );
  passed("文档菜单真实填写提交，发起者无审批按钮，进入评审深链接");
  const { page: approverPage } = await accountPage(
    url,
    approver.user.phone,
    `/reviews?reviewId=${reviewId}`,
  );
  await approverPage.getByRole("button", { name: "通过并建任务" }).waitFor();
  await approverPage
    .getByLabel("审批意见（可选）")
    .fill("方案确认，通过后请按截止时间完成。");
  await approverPage.screenshot({
    path: path.join(directory, "pending-review.png"),
  });
  const beforeDecisionFrames = ownerBrowser.reviewFrames();
  await approverPage.getByRole("button", { name: "通过并建任务" }).click();
  await approverPage
    .getByRole("button", { name: "确认通过", exact: true })
    .click();
  await approverPage
    .getByRole("button", { name: "查看自动创建的任务" })
    .waitFor();
  const detail = (
    await app
      .httpRequest()
      .get(`/api/document-reviews/${reviewId}`)
      .set("Authorization", approver.authorization)
      .expect(200)
  ).body.data;
  assert.equal(detail.status, "approved");
  assert.ok(detail.taskId);
  passed("指定审批人真实确认通过，原子创建关联任务");
  await ownerPage.getByRole("button", { name: "查看自动创建的任务" }).waitFor();
  passed("另一账号页面收到真实 Socket 刷新并显示审批通过");
  assert.ok(
    ownerBrowser.reviewFrames() > beforeDecisionFrames,
    "另一账号必须实际收到审批 Socket 事件，不能仅靠轮询刷新",
  );
  await approverPage.screenshot({
    path: path.join(directory, "approved-review.png"),
  });
  await approverPage
    .getByRole("button", { name: "查看自动创建的任务" })
    .click();
  await approverPage.locator('[data-search-highlighted="true"]').waitFor();
  assert.equal(
    await approverPage
      .getByRole("button", { name: "推进任务", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await approverPage
      .getByRole("button", { name: "编辑任务", exact: true })
      .isDisabled(),
    true,
  );
  passed("自动任务按钮跳转并定位正式任务页面");
  const ctx = app.createAnonymousContext();
  await ctx.service.tasks.sendDueReminders(
    new Date("2030-01-02T00:00:00.000Z"),
  );
  assert.equal(
    await ctx.service.documentReviews.sendDueGroupReminders(
      new Date("2030-01-02T00:00:00.000Z"),
    ),
    1,
  );
  assert.equal(
    await ctx.service.documentReviews.sendDueGroupReminders(
      new Date("2030-01-02T00:00:00.000Z"),
    ),
    0,
  );
  const { page: assigneePage } = await accountPage(
    url,
    assignee.user.phone,
    "/notifications",
  );
  await assigneePage.getByText("任务已到期", { exact: true }).waitFor();
  await assigneePage.getByText("收到一项新任务", { exact: true }).waitFor();
  passed("负责人正式通知页收到分配和唯一到期通知");
  const { page: groupPage } = await accountPage(
    url,
    assignee.user.phone,
    `/chat/${group.id}`,
  );
  const reminderText = `任务“确认发布方案并推进上线”已到期，负责人：${assignee.user.name}，请及时处理。`;
  const messages = (
    await app
      .httpRequest()
      .get(`/api/conversations/${group.id}/messages?limit=50`)
      .set("Authorization", assignee.authorization)
      .expect(200)
  ).body.data.items;
  const dueMessages = messages.filter((item) => item.summary === reminderText);
  assert.equal(dueMessages.length, 1, "群聊历史中只能有一条持久化到期消息");
  await groupPage
    .locator(`#message-${dueMessages[0].id}`)
    .getByText(reminderText, { exact: true })
    .waitFor();
  await groupPage.screenshot({
    path: path.join(directory, "group-reminder.png"),
  });
  passed("真实群聊页面显示到期系统消息，重复扫描不新增");
  await ownerPage.getByRole("link", { name: "审批", exact: true }).click();
  await ownerPage.getByText("我发起的", { exact: true }).click();
  await ownerPage
    .getByRole("button")
    .filter({ hasText: "确认发布方案并推进上线" })
    .click();
  await ownerPage.getByRole("button", { name: "查看自动创建的任务" }).waitFor();
  for (const width of [1440, 800, 375]) {
    await ownerPage.setViewportSize({ width, height: 900 });
    await ownerPage.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await ownerPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `${width}px 不应出现横向溢出`,
    );
  }
  passed("1440/800/375px 视口布局无横向溢出，减少动效模式可操作");
  const { page: darkPage } = await accountPage(
    url,
    approver.user.phone,
    `/reviews?reviewId=${reviewId}`,
    "dark",
  );
  await darkPage.getByRole("button", { name: "查看自动创建的任务" }).waitFor();
  assert.equal(
    await darkPage.locator("html").getAttribute("data-theme"),
    "dark",
  );
  await darkPage.screenshot({
    path: path.join(directory, "approved-review-dark.png"),
  });
  passed("深色主题展示已审批详情和任务入口");
  assert.deepEqual(errors, []);
  passed("全部真实页面没有未捕获 JavaScript 异常");
}

try {
  await main();
} catch (error) {
  console.error(error);
  errors.push(error.stack || error.message);
  if (browser) {
    for (const [index, page] of browser
      .contexts()
      .flatMap((context) => context.pages())
      .entries()) {
      failureUi.push({
        path: new URL(page.url()).pathname,
        text: (await page.locator("body").innerText()).slice(0, 4000),
      });
      await page.screenshot({
        path: path.join(directory, `failure-page-${index}.png`),
      });
    }
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await vite?.close();
  if (app?.io) await new Promise((resolve) => app.io.close(resolve));
  if (api?.listening) await new Promise((resolve) => api.close(resolve));
  await app?.close();
  await app?.chatDb?.sequelize.close();
  fs.writeFileSync(
    path.join(directory, "browser-verification.json"),
    JSON.stringify(
      {
        databasePath,
        passed: checks.length,
        checks,
        errors,
        failureUi,
        scope:
          "真实 React 页面 + 隔离 Egg HTTP/Socket；不包含 Electron 原生窗口、preload 和本地 SQLite 缓存验收",
      },
      null,
      2,
    ),
  );
  console.log(`REPORT ${path.join(directory, "browser-verification.json")}`);
  process.exit(process.exitCode || 0);
}
