// 用法：node apps/desktop/scripts/verify-workspace-ui.mjs --serve
// 原生文档编辑预览：追加 --collaboration，手动启用隔离随机端口协作服务。
// 自动验收：node apps/desktop/scripts/verify-workspace-ui.mjs <playwright模块路径> msedge
// 追加 --links-only 只测链接；--chat-only 测链接、中性色与消息截图，JSON 中标明局部范围。
// 追加 --sections-only 验证工作中心/团队的筛选、深链接、权限及真实审批流程。
// 所有数据库、缓存、截图和报告保留在系统临时目录；本脚本不会删除目录或重建原生依赖。
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
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chat-workspace-ui-"));
const databasePath = path.join(directory, "workspace.sqlite");
const reportPath = path.join(directory, "workspace-verification.json");
const serve = process.argv.includes("--serve");
const checks = [];
const failures = [];
const browserErrors = [];
const consoleErrors = [];
const screenshots = [];
const layoutIssues = [];
const layoutMeasurements = [];
const messageColors = [];
const paletteMeasurements = [];
const paletteViolations = [];
const staticModalColors = [];
const radioColors = [];
const failureUi = [];
const networkFailures = [];
const historyRaceEvidence = [];
let app;
let api;
let vite;
let browser;
let url;
let apiUrl;
let collaboration;
let collaborationUrl;

/** 从真实隔离接口登录演示账号，仅在内存中保存访问令牌。 */
async function login(phone = "13800000001") {
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

/** 记录通过的独立检查；失败项继续运行以收集其他页面的问题。 */
async function check(name, action) {
  try {
    const result = await action();
    checks.push(name);
    console.log(`PASS ${name}`);
    return result;
  } catch (error) {
    failures.push({ name, error: error.stack || error.message });
    console.error(`FAIL ${name}: ${error.message}`);
    if (browser) {
      for (const [index, page] of browser
        .contexts()
        .flatMap((context) => context.pages())
        .entries()) {
        if (page.isClosed()) continue;
        await page
          .screenshot({
            path: path.join(
              directory,
              `failure-${failures.length}-${index}.png`,
            ),
          })
          .catch(() => undefined);
        await page.keyboard.press("Escape").catch(() => undefined);
      }
    }
  }
}

/** 启动真实 Egg HTTP/Socket 和独立缓存 Vite，不改现有 review 验收脚本。 */
async function startServers() {
  process.env.CHAT_DATABASE_PATH = databasePath;
  process.env.CHAT_COLLABORATION_DISABLED = "1";
  process.env.EGG_TYPESCRIPT = "true";
  process.env.EGG_SERVER_ENV = "unittest";
  process.env.CHAT_CONSOLE_LOG_LEVEL = "ERROR";
  process.env.CHAT_VITE_CACHE_DIR = path.join(
    directory,
    "node_modules",
    ".vite",
  );
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
  if (serve && process.argv.includes("--collaboration")) {
    // unittest 生命周期不会自动启动协作服务；只在显式预览选项下手动挂载。
    process.env.CHAT_COLLABORATION_PORT = "0";
    const { startCollaborationServer } = serverRequire(
      path.join(serverRoot, "app/lib/collaboration"),
    );
    collaboration = await startCollaborationServer(app);
    app.collaborationServer = collaboration;
    const address = collaboration.httpServer.address();
    assert.ok(address && typeof address !== "string" && address.port > 0);
    process.env.CHAT_COLLABORATION_PORT = String(address.port);
    collaborationUrl = `ws://127.0.0.1:${address.port}`;
    process.env.CHAT_COLLABORATION_PUBLIC_URL = collaborationUrl;
  }
  api = http.createServer(app.callback());
  app.io.attach(api);
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${api.address().port}`;
  vite = await createServer({
    root: desktopRoot,
    cacheDir: path.join(directory, "node_modules", ".vite"),
    plugins: [
      {
        name: "isolated-workspace-verification",
        /** 所有正式页面深链接使用相同真实入口，避免刷新回到 Electron 启动入口。 */
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            const pathname = new URL(request.url || "/", "http://127.0.0.1")
              .pathname;
            if (
              !/^\/(?:__workspace(?:-verification)?|login|chat(?:\/\d+)?|contacts(?:\/\d+)?|organization|documents|reviews|tasks|notifications|search)?$/.test(
                pathname,
              )
            )
              return next();
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(
              '<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>同频 · 隔离工作台验收</title></head><body><div id="root" style="height:100vh"></div><script type="module" src="/@vite/client"></script><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/scripts/workspace-browser-entry.tsx"></script></body></html>',
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
  url = `http://127.0.0.1:${vite.httpServer.address().port}`;
  assert.ok(
    (
      await fetch(`${url}/__workspace`).then((response) => response.text())
    ).includes("workspace-browser-entry.tsx"),
  );
  console.log(`PREVIEW_URL ${url}/__workspace`);
  console.log(`SIGNED_IN_URL ${url}/__workspace?phone=13800000001&route=/chat`);
  console.log(`API_URL ${apiUrl}`);
  if (collaborationUrl) console.log(`COLLABORATION_URL ${collaborationUrl}`);
  console.log(`TEMP_DIR ${directory}`);
  console.log(`REPORT ${reportPath}`);
}

/** 为每个真实页面安装错误监听，不记录请求头、Cookie 或响应令牌。 */
function observe(page) {
  page.on("pageerror", (error) =>
    browserErrors.push({
      path: new URL(page.url()).pathname,
      message: error.message,
    }),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      consoleErrors.push({
        path: new URL(page.url()).pathname,
        message: message.text(),
      });
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/") && response.status() >= 500)
      networkFailures.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
  });
}

/** 通过界面完成登录，覆盖无 session 的正式 App 登录守卫和表单。 */
async function signIn(page, phone = "13800000001") {
  await page.goto(`${url}/__workspace`);
  await page.getByRole("button", { name: "登录企业空间" }).waitFor();
  assert.equal(
    await page.evaluate(() => Boolean(window.desktop)),
    false,
    "不能设置假 native bridge",
  );
  await page.getByRole("textbox", { name: "手机号" }).fill(phone);
  await page.locator('input[name="password"]').fill("123456");
  await page.getByRole("button", { name: "登录企业空间" }).click();
  await page.getByRole("link", { name: "消息", exact: true }).waitFor();
}

/** 经侧栏区域与二级导航切换页面，区域内切换保留最近的深链接。 */
async function navigate(page, name) {
  const section = ["任务", "审批", "通知"].includes(name)
    ? "工作中心"
    : ["通讯录", "组织管理"].includes(name)
      ? "团队"
      : undefined;
  if (section) {
    const navigation = page.getByRole("navigation", {
      name: `${section}视图`,
      exact: true,
    });
    if (!(await navigation.isVisible()))
      await page.getByRole("link", { name: section, exact: true }).click();
    await navigation.getByRole("link", { name, exact: true }).click();
  } else {
    await page.getByRole("link", { name, exact: true }).click();
  }
  await page.locator(".workspace-main").waitFor();
}

/** 选择真实 Ant Design 下拉选项，不通过设置组件内部状态绕过交互。 */
async function choose(page, label, option) {
  const input = page.getByRole("combobox", { name: label, exact: true });
  await input.click();
  const controls = await input.getAttribute("aria-controls");
  assert.ok(controls, "下拉框必须关联选项列表");
  await recordNeutralBackgrounds(page, `下拉：${label}`);
  await page
    .locator(".ant-select-dropdown")
    .filter({ has: page.locator(`[id="${controls}"]`) })
    .getByText(option, { exact: true })
    .click();
}

/** 等待 UI 操作对应的真实成功响应，返回数据但不输出响应里的认证信息。 */
async function perform(page, method, pathname, action) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === method &&
        new URL(response.url()).pathname === pathname,
    ),
    Promise.resolve().then(action),
  ]);
  assert.equal(response.status(), 200, `${method} ${pathname} 必须成功`);
  const result = await response.json();
  assert.equal(result.success, true);
  return result.data;
}

/** 验证任务新增、编辑、推进、完成与重新打开均落到真实后端。 */
async function verifyTasks(page) {
  await navigate(page, "任务");
  const title = `工作台任务验收 ${Date.now()}`;
  await page
    .getByRole("textbox", { name: "任务标题", exact: true })
    .fill(title);
  await choose(page, "任务优先级", "优先级：高");
  const task = await perform(page, "POST", "/api/tasks", () =>
    page.getByRole("button", { name: "新增任务", exact: true }).click(),
  );
  assert.equal(task.title, title);
  assert.equal(task.priority, "high");
  const card = page
    .getByRole("article")
    .filter({ has: page.getByText(title, { exact: true }) });
  await card.waitFor();
  await card.getByRole("button", { name: "编辑任务", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("textarea").fill(`${title} 已编辑`);
  await choose(page, "编辑任务优先级", "优先级：紧急");
  const edited = await perform(page, "PATCH", `/api/tasks/${task.id}`, () =>
    dialog.getByRole("button", { name: /^保\s*存$/ }).click(),
  );
  assert.equal(edited.title, `${title} 已编辑`);
  assert.equal(edited.priority, "urgent");
  const updatedCard = page
    .getByRole("article")
    .filter({ has: page.getByText(edited.title, { exact: true }) });
  await updatedCard.waitFor();
  for (const [button, expected] of [
    ["推进任务", "in_progress"],
    ["推进任务", "done"],
    ["重新打开任务", "todo"],
  ]) {
    const changed = await perform(page, "PATCH", `/api/tasks/${task.id}`, () =>
      updatedCard.getByRole("button", { name: button, exact: true }).click(),
    );
    assert.equal(changed.status, expected);
    await updatedCard
      .getByText(
        { in_progress: "进行中", done: "已完成", todo: "待处理" }[expected],
        { exact: true },
      )
      .waitFor();
  }
  return edited;
}

/** 在正式文档页新建文档与表格，验证重命名、收藏和列表搜索；不假装打开原生编辑器。 */
async function verifyDocuments(page) {
  await navigate(page, "文档");
  let document;
  for (const [type, label] of [
    ["doc", "创建在线文档"],
    ["sheet", "创建在线表格"],
  ]) {
    const created = await perform(page, "POST", "/api/documents", () =>
      page.getByRole("button", { name: new RegExp(label) }).click(),
    );
    assert.equal(created.type, type);
    await page
      .locator(`.ant-table-row[data-row-key="${created.id}"]`)
      .waitFor();
    if (type === "doc") document = created;
  }
  const row = page.locator(`.ant-table-row[data-row-key="${document.id}"]`);
  await row.getByRole("button", { name: "收藏", exact: true }).click();
  await row.getByRole("button", { name: "取消收藏", exact: true }).waitFor();
  await row
    .getByRole("button", { name: `更多操作：${document.title}`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  const title = `工作台文档验收 ${Date.now()}`;
  await page.getByRole("dialog").getByRole("textbox").fill(title);
  await perform(page, "PATCH", `/api/documents/${document.id}`, () =>
    page
      .getByRole("dialog")
      .getByRole("button", { name: /^保\s*存$/ })
      .click(),
  );
  await row.getByText(title, { exact: true }).waitFor();
  await page
    .getByRole("textbox", { name: "搜索文档", exact: true })
    .fill(title);
  await row.waitFor();
  await page.getByRole("textbox", { name: "搜索文档", exact: true }).fill("");
  return { ...document, title };
}

/** 准备真实评审批快照和待办通知，只检查新增页面，不重复已有 review 端到端脚本。 */
async function reviewFixture(account, group) {
  const approver = await login("13800000002");
  const imported = (
    await app
      .httpRequest()
      .post("/api/documents/import")
      .set("Authorization", account.authorization)
      .attach(
        "file",
        Buffer.from("工作台评审验收正文：确认企业协作工作台保持原业务能力。"),
        { filename: "工作台评审验收.txt", contentType: "text/plain" },
      )
      .expect(200)
  ).body.data;
  await app
    .httpRequest()
    .put(`/api/documents/${imported.id}/members`)
    .set("Authorization", account.authorization)
    .send({ members: [{ userId: approver.user.id, permission: "viewer" }] })
    .expect(200);
  const review = (
    await app
      .httpRequest()
      .post("/api/document-reviews")
      .set("Authorization", account.authorization)
      .send({
        requestKey: crypto.randomUUID(),
        documentId: imported.id,
        conversationId: group.id,
        approverId: approver.user.id,
        assigneeId: account.user.id,
        title: "工作台评审验收",
        dueAt: "2030-01-02T00:00:00.000Z",
      })
      .expect(200)
  ).body.data;
  return { review, approver };
}

/** 验证通知筛选和已读操作，使用另一真实账号创建的任务生成通知。 */
async function verifyNotifications(page, account) {
  const assigner = await login("13800000002");
  await app
    .httpRequest()
    .post("/api/tasks")
    .set("Authorization", assigner.authorization)
    .send({ title: "工作台通知验收", assigneeId: account.user.id })
    .expect(200);
  await navigate(page, "通知");
  await page.getByText("工作台通知验收", { exact: false }).first().waitFor();
  const card = page.getByRole("article").filter({ hasText: "工作台通知验收" });
  const readButton = card.getByRole("button", {
    name: "标为已读",
    exact: true,
  });
  await readButton.click();
  await readButton.waitFor({ state: "hidden" });
  await page.getByText("未读", { exact: true }).click();
  await card.waitFor({ state: "hidden" });
  await page.getByText("全部", { exact: true }).click();
  await card.waitFor();
}

/** 验证通讯录真实筛选、成员详情，以及通过联系人发起单聊。 */
async function verifyContacts(page) {
  await navigate(page, "通讯录");
  await page.getByPlaceholder("搜索姓名、职位或手机号").fill("13800000002");
  const contact = page
    .locator(".workspace-main section button")
    .filter({ hasText: "陈默" });
  await contact.click();
  await page.getByRole("heading", { name: "成员资料", exact: true }).waitFor();
  await page
    .getByRole("button", { name: /发\s*消\s*息/ })
    .first()
    .click();
  await page.getByRole("textbox", { name: "消息输入框" }).waitFor();
}

/** 验证组织成员搜索、筛选清除以及真实创建部门表单。 */
async function verifyOrganization(page) {
  await navigate(page, "组织管理");
  await page.getByRole("textbox", { name: "搜索成员" }).fill("13800000002");
  await page.getByRole("row").filter({ hasText: "13800000002" }).waitFor();
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.getByRole("button", { name: "部门架构", exact: true }).click();
  await page.getByRole("button", { name: "新建部门", exact: true }).click();
  const title = `验收部门 ${Date.now()}`;
  await page.getByPlaceholder("例如：客户成功部").fill(title);
  const department = await perform(page, "POST", "/api/departments", () =>
    page.getByRole("button", { name: "确认创建", exact: true }).click(),
  );
  assert.equal(department.name, title);
  await page.getByText(title, { exact: true }).first().waitFor();
}

/** 检查设置页真实主题选择、减少动效，以及四个设置分区的响应式布局。 */
async function verifySettings(page) {
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const modalPadding = await dialog
    .locator(".ant-modal-container, .ant-modal-content")
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return [
        style.paddingTop,
        style.paddingRight,
        style.paddingBottom,
        style.paddingLeft,
      ];
    });
  assert.deepEqual(
    modalPadding,
    ["0px", "0px", "0px", "0px"],
    "AntD6 设置容器不能额外增加外框 padding",
  );
  for (const [theme, expected] of [
    ["浅色", "light"],
    ["深色", "dark"],
  ]) {
    await dialog.getByRole("button", { name: "外观设置", exact: true }).click();
    const themeButton = dialog.getByRole("button", {
      name: `使用${theme}主题`,
      exact: true,
    });
    await themeButton.click();
    await page.waitForFunction(
      (value) => document.documentElement.dataset.theme === value,
      expected,
    );
    assert.equal(await themeButton.getAttribute("aria-pressed"), "true");
    for (const section of ["个人资料", "聊天设置", "外观设置", "通用设置"]) {
      await dialog.getByRole("button", { name: section, exact: true }).click();
      await dialog
        .getByRole("heading", { name: section, exact: true })
        .waitFor();
      if (section === "聊天设置") {
        const comfortable = dialog
          .locator(".ant-radio-button-wrapper-checked")
          .filter({ hasText: "舒适" });
        await comfortable.waitFor();
        radioColors.push({
          theme: expected,
          ...(await readVisualColors(comfortable)),
        });
      }
      if (expected === "dark")
        await verifyNeutralStates(page, `设置-${section}`);
      for (const width of [1440, 1024, 768, 375])
        await capture(page, `settings-${section}-${expected}`, width);
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  }
  await dialog.getByRole("button", { name: "外观设置", exact: true }).click();
  const reducedMotion = dialog
    .getByText("减少动态效果", { exact: true })
    .locator("..")
    .locator("..")
    .getByRole("switch");
  await reducedMotion.click();
  await page.waitForFunction(() =>
    document.documentElement.classList.contains("reduce-motion"),
  );
  // 单独验证动效偏好后恢复，防止影响其他业务场景的判定。
  await reducedMotion.click();
  await page.waitForFunction(
    () => !document.documentElement.classList.contains("reduce-motion"),
  );
  await dialog
    .getByRole("button", { name: "使用跟随系统主题", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
}

/** 切换正式主题菜单，并等待根节点解析后的实际主题。 */
async function selectTheme(page, name, expected) {
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
  await page.waitForFunction(
    (theme) => document.documentElement.dataset.theme === theme,
    expected,
  );
}

/** 使用正式会话列表打开真实群聊，保留导航和聊天加载流程。 */
async function openChat(page, group) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigate(page, "消息");
  await page
    .locator(".chat-conversation-row")
    .filter({ has: page.getByText(group.name, { exact: true }) })
    .click();
  await page.getByRole("textbox", { name: "消息输入框" }).waitFor();
}

/** 延迟真实历史响应，验证实时消息不被覆盖且原历史仍保留，不伪造任何业务数据。 */
async function verifyMessageHistoryRace(account, group) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  observe(page);
  page.setDefaultTimeout(20_000);
  const pattern = `**/api/conversations/${group.id}/messages?*`;
  let releaseHistory;
  const released = new Promise((resolve) => {
    releaseHistory = resolve;
  });
  let captureHistory;
  let failHistory;
  const captured = new Promise((resolve, reject) => {
    captureHistory = resolve;
    failHistory = reject;
  });
  let delivery = Promise.resolve();
  /** 先取得真实服务响应，只控制交付时机；后续重取请求不再拦截。 */
  const holdHistory = (route) => {
    delivery = (async () => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      const payload = await response.json();
      assert.equal(payload.success, true);
      captureHistory(payload.data);
      await released;
      await route.fulfill({ response });
    })();
    void delivery.catch(failHistory);
    return delivery;
  };
  try {
    await signIn(page, account.user.phone);
    await page.route(pattern, holdHistory, { times: 1 });
    await openChat(page, group);
    const history = await captured;
    const historyId = history.items.at(-1)?.id;
    assert.ok(historyId, "真实历史中必须有旧消息作为响应已应用的可见证据");
    const oldRow = page.locator(`#message-${historyId}`);
    assert.equal(await oldRow.count(), 0, "旧历史响应必须尚未交付");
    const target = `${url}/__workspace-link-target?scheme=history-race`;
    const response = await app
      .httpRequest()
      .post(`/api/conversations/${group.id}/messages`)
      .set("Authorization", account.authorization)
      .send({
        conversationId: group.id,
        clientId: crypto.randomUUID(),
        schemaVersion: 1,
        parts: [{ type: "text", text: target }],
      })
      .expect(200);
    const liveId = response.body.data.id;
    const liveRow = page.locator(`#message-${liveId}`);
    const link = liveRow.getByRole("link", { name: target, exact: true });
    // 历史仍被挂起，此时能显示新消息只能来自真实 Socket 推送。
    await link.waitFor();
    const evidence = {
      historyId,
      liveId,
      liveCopiesBeforeRelease: await liveRow.count(),
    };
    historyRaceEvidence.push(evidence);
    assert.equal(evidence.liveCopiesBeforeRelease, 1);
    console.log(
      `HISTORY_RACE Socket消息 ${liveId} 已显示，正在释放旧历史 ${historyId}`,
    );
    releaseHistory();
    await delivery;
    // 旧消息真正显示后才检查新消息，防止在迟到响应应用前提前通过。
    await oldRow.waitFor();
    evidence.historyCopiesAfterRelease = await oldRow.count();
    evidence.liveCopiesAfterRelease = await liveRow.count();
    assert.equal(
      evidence.historyCopiesAfterRelease,
      1,
      "旧历史应保留或通过权威历史重取恢复",
    );
    assert.equal(
      evidence.liveCopiesAfterRelease,
      1,
      "迟到真实历史响应不能移除或重复 Socket 新消息",
    );
    await link.waitFor();
  } catch (error) {
    await page.screenshot({
      path: path.join(directory, "history-race-failure.png"),
    });
    throw error;
  } finally {
    releaseHistory();
    await delivery.catch(() => undefined);
    await page.unroute(pattern, holdHistory);
    await context.close();
  }
}

/** 仅接管受控本地链接的落地页；消息和所有业务 API 完全走真实服务。 */
async function verifyLinks(page, context, account, group) {
  await openChat(page, group);
  await context.route("**/__workspace-link-target?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><html><head><title>本地链接验收</title></head><body>受控本地链接目标</body></html>",
    }),
  );
  for (const scheme of ["http", "https"]) {
    await check(
      `真实聊天 ${scheme.toUpperCase()} 链接点击打开安全 popup`,
      async () => {
        const target = `${scheme}://127.0.0.1:${vite.httpServer.address().port}/__workspace-link-target?scheme=${scheme}`;
        // 独立准备真实持久化消息，不能让发送框故障遮住链接点击的回归。
        const response = await app
          .httpRequest()
          .post(`/api/conversations/${group.id}/messages`)
          .set("Authorization", account.authorization)
          .send({
            conversationId: group.id,
            clientId: crypto.randomUUID(),
            schemaVersion: 1,
            parts: [{ type: "text", text: target }],
          })
          .expect(200);
        await page.locator(`#message-${response.body.data.id}`).waitFor();
        const link = page
          .locator("[data-chat-root]")
          .getByRole("link", { name: target, exact: true });
        await link.waitFor();
        const popupPromise = page.waitForEvent("popup", { timeout: 5_000 });
        await link.click();
        const popup = await popupPromise;
        await popup.waitForLoadState("domcontentloaded");
        assert.equal(popup.url(), target);
        await popup.getByText("受控本地链接目标", { exact: true }).waitFor();
        assert.equal(
          await popup.evaluate(() => window.opener === null),
          true,
          "外部链接不应保留可控制聊天窗口的 opener",
        );
        await popup.close();
      },
    );
  }
  await context.unroute("**/__workspace-link-target?**");
}

/** 将浏览器实际计算的 RGB 颜色转换为通道值，拒绝透明背景导致的错误对比度。 */
function rgbChannels(value) {
  const match = /^rgba?\(([^)]+)\)$/.exec(value);
  assert.ok(match, `需要实际 RGB 颜色，收到 ${value}`);
  const values = match[1]
    .split(/[,\s/]+/)
    .filter(Boolean)
    .map(Number);
  assert.ok(
    values.length === 3 || (values.length === 4 && values[3] === 1),
    "对比度必须基于不透明的实际背景",
  );
  return values.slice(0, 3);
}

/** 按 WCAG sRGB 线性化公式计算实际文字与背景的对比度。 */
function contrastRatio(foreground, background) {
  /** 将三个颜色通道换算为相对亮度。 */
  function luminance(channels) {
    const linear = channels.map((value) => {
      const channel = value / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  }
  const light = luminance(rgbChannels(foreground));
  const dark = luminance(rgbChannels(background));
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}

/** 读取真实 DOM 的文字与有效背景；合成透明层，避免误用透明按钮背景计算对比度。 */
async function readVisualColors(locator) {
  return locator.evaluate((element) => {
    /** 解析浏览器 RGB 颜色与透明度。 */
    function rgba(value) {
      const values = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
      return [values[0], values[1], values[2], values[3] ?? 1];
    }
    const background = [0, 0, 0];
    let opacity = 0;
    let node = element;
    while (node && opacity < 0.999) {
      const color = rgba(getComputedStyle(node).backgroundColor);
      const weight = (1 - opacity) * color[3];
      for (let i = 0; i < 3; i += 1) background[i] += color[i] * weight;
      opacity += weight;
      node = node.parentElement;
    }
    const color = rgba(getComputedStyle(element).color);
    const foreground = color
      .slice(0, 3)
      .map((channel, index) =>
        Math.round(channel * color[3] + background[index] * (1 - color[3])),
      );
    return {
      label: element.textContent?.trim().slice(0, 80),
      foreground: `rgb(${foreground.join(", ")})`,
      background: `rgb(${background.map(Math.round).join(", ")})`,
    };
  });
}

/** 从正式文档操作打开静态确认框，验证全局主题桥接而非页面内临时包装。 */
async function verifyStaticRenameTheme(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigate(page, "文档");
  for (const [name, theme] of [
    ["浅色模式", "light"],
    ["深色模式", "dark"],
  ]) {
    await selectTheme(page, name, theme);
    await page
      .locator(".ant-table-row")
      .first()
      .getByRole("button", { name: /^更多操作：/ })
      .click();
    await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator(".ant-modal-confirm-title").waitFor();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    const samples = [];
    for (const [part, locator] of [
      ["title", dialog.locator(".ant-modal-confirm-title")],
      ["input", dialog.getByRole("textbox")],
      ["cancel", dialog.getByRole("button", { name: /^取\s*消$/ })],
      ["save", dialog.getByRole("button", { name: /^保\s*存$/ })],
    ]) {
      const colors = await readVisualColors(locator);
      samples.push({
        part,
        ...colors,
        contrast: contrastRatio(colors.foreground, colors.background),
      });
    }
    staticModalColors.push({ theme, samples });
    for (const width of [1440, 1024, 768, 375])
      await capture(page, `static-rename-${theme}`, width);
    for (const sample of samples)
      assert.ok(
        sample.contrast >= 4.5,
        `静态重命名 ${theme}/${sample.part} 对比度 ${sample.contrast.toFixed(2)} < 4.5：${JSON.stringify(sample)}`,
      );
    if (theme === "dark") {
      const title = samples.find((sample) => sample.part === "title");
      const cancel = samples.find((sample) => sample.part === "cancel");
      const save = samples.find((sample) => sample.part === "save");
      assert.ok(
        Math.min(...rgbChannels(title.foreground)) >= 200,
        "暗色静态确认框标题不能继承黑字",
      );
      assert.ok(
        Math.max(...rgbChannels(cancel.background)) < 100,
        "暗色取消按钮不能继承白底",
      );
      assert.deepEqual(
        rgbChannels(save.background),
        [76, 102, 187],
        "暗色静态主按钮必须使用沉稳蓝而非算法浅蓝",
      );
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await dialog.getByRole("button", { name: /^取\s*消$/ }).click();
    await dialog.waitFor({ state: "hidden" });
  }
}

/** 用真实 API 准备消息后测量实际气泡与画布，不把此 fixture 当成浏览器发送框验收。 */
async function verifyNeutralMessages(page, account, group) {
  await openChat(page, group);
  const peer = await login("13800000002");
  const fixtures = [];
  for (const [sender, text] of [
    [account, "我的消息：使用克制的中性背景，阅读更自然。"],
    [peer, "同事回复：亮暗主题保持协调与清晰。"],
  ]) {
    const response = await app
      .httpRequest()
      .post(`/api/conversations/${group.id}/messages`)
      .set("Authorization", sender.authorization)
      .send({
        conversationId: group.id,
        clientId: crypto.randomUUID(),
        schemaVersion: 1,
        parts: [
          {
            type: "text",
            text: `${text} https://127.0.0.1:${vite.httpServer.address().port}/neutral-colors`,
          },
        ],
      })
      .expect(200);
    fixtures.push(response.body.data.id);
    await page
      .locator(`#message-${response.body.data.id} [data-message-content]`)
      .first()
      .waitFor();
  }
  for (const [themeName, theme, expected] of [
    ["浅色模式", "light", [238, 240, 244]],
    ["深色模式", "dark", [48, 53, 59]],
  ]) {
    await selectTheme(page, themeName, theme);
    const colors = await page.evaluate(([ownId, peerId]) => {
      const own = document.querySelector(
        `#message-${ownId} [data-message-content]`,
      );
      const peer = document.querySelector(
        `#message-${peerId} [data-message-content]`,
      );
      const canvas = document.querySelector("[data-chat-root] > section");
      if (!own || !peer || !canvas)
        throw new Error("中性消息 fixture 或消息画布未渲染");
      return {
        ownBackground: getComputedStyle(own).backgroundColor,
        peerBackground: getComputedStyle(peer).backgroundColor,
        canvasBackground: getComputedStyle(canvas).backgroundColor,
        links: [own, peer].map((bubble) => {
          const link = bubble.querySelector("a");
          if (!link) throw new Error("消息正文必须实际渲染链接");
          return {
            foreground: getComputedStyle(link).color,
            background: getComputedStyle(bubble).backgroundColor,
          };
        }),
      };
    }, fixtures);
    const ratios = colors.links.map((link) =>
      contrastRatio(link.foreground, link.background),
    );
    messageColors.push({
      theme,
      ...colors,
      linkContrastRatios: ratios,
      fixtureSource: "真实 API 持久化；不是 web 发送框",
    });
    assert.deepEqual(
      rgbChannels(colors.ownBackground),
      expected,
      `${theme} 自己的气泡必须使用指定中性色`,
    );
    const canvas = rgbChannels(colors.canvasBackground);
    assert.ok(
      Math.abs(canvas[0] - canvas[2]) <= 20,
      `${theme} 消息画布红蓝通道差必须不超过 20`,
    );
    if (theme === "dark")
      for (const ratio of ratios)
        assert.ok(
          ratio >= 4.5,
          `暗色链接实际对比度 ${ratio.toFixed(2)} 必须至少 4.5`,
        );
    for (const width of [1440, 1024, 768, 375])
      await capture(page, `chat-neutral-${theme}`, width);
    await page.setViewportSize({ width: 1440, height: 900 });
  }
}

/** 测量选中态和输入框的有效背景；仅确认控件允许指定沉稳蓝，透明层按祖先背景合成。 */
async function recordNeutralBackgrounds(page, scope) {
  if ((await page.locator("html").getAttribute("data-theme")) !== "dark")
    return;
  const measured = await page.evaluate(() => {
    const selectors = [
      ".workspace-nav-item.is-active",
      ".chat-conversation-row",
      ".contacts-member[aria-current]",
      "button[aria-current='page']",
      "button[aria-pressed='true']",
      "[aria-selected='true']",
      ".ant-segmented-item-selected",
      ".ant-radio-button-wrapper-checked",
      ".ant-checkbox-checked .ant-checkbox-inner",
      ".ant-radio-checked .ant-radio-inner",
      ".ant-switch-checked",
      ".ant-picker-cell-selected .ant-picker-cell-inner",
      ".ant-picker-cell-range-start .ant-picker-cell-inner",
      ".ant-picker-cell-range-end .ant-picker-cell-inner",
      ".ant-select-item-option-selected",
      ".ant-select-item-option-active",
      ".ant-select-dropdown",
      ".ant-dropdown-menu-item:hover",
      ".ant-table-cell-row-hover",
      ".ant-table-row-selected > td",
      ".ant-input",
      ".ant-input-affix-wrapper",
      ".ant-select",
      ".ant-select-selector",
      "input:not([type='checkbox']):not([type='radio']):not([type='hidden'])",
      "textarea",
      "[contenteditable='true']",
      ".workspace-nav-item:hover",
      ".contacts-member:hover",
      ".chat-conversation-row:hover",
      ".search-result-card:hover",
      ".organization-menu-item:hover",
      ".documents-file-button:hover",
      ".notifications-card-content:hover",
      ".ant-segmented-item:hover",
    ];
    /** 把计算样式中的 RGB 值与透明度解析为数值通道。 */
    function rgba(value) {
      const values = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
      return [values[0], values[1], values[2], values[3] ?? 1];
    }
    /** 由内到外合成不透明背景，避免把透明输入误判为黑色或蓝色。 */
    function background(element) {
      let node = element;
      let opacity = 0;
      const result = [0, 0, 0];
      while (node && opacity < 0.999) {
        const color = rgba(getComputedStyle(node).backgroundColor);
        const weight = (1 - opacity) * color[3];
        for (let i = 0; i < 3; i += 1) result[i] += color[i] * weight;
        opacity += weight;
        node = node.parentElement;
      }
      return result.map((value) => Math.round(value));
    }
    const samples = [...new Set(document.querySelectorAll(selectors.join(",")))]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          element.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          }) &&
          rect.width > 2 &&
          rect.height > 2 &&
          rect.right > 0 &&
          rect.left < innerWidth &&
          rect.bottom > 0 &&
          rect.top < innerHeight &&
          style.display !== "none" &&
          !element.closest(".ant-btn-primary")
        );
      })
      .map((element) => ({
        tag: element.tagName,
        className: String(element.className).slice(0, 200),
        label:
          element.getAttribute("aria-label") ||
          element.getAttribute("placeholder") ||
          element.textContent?.trim().slice(0, 45),
        ownBackground: getComputedStyle(element).backgroundColor,
        effectiveBackground: background(element),
        confirmationControl: Boolean(
          element.closest(
            ".ant-checkbox-checked, .ant-radio-checked, .ant-switch-checked",
          ),
        ),
      }));
    const root = getComputedStyle(document.documentElement);
    const tokens = Object.fromEntries(
      [
        "--app-canvas",
        "--app-surface",
        "--app-surface-soft",
        "--app-surface-muted",
        "--app-primary-soft",
        "--app-line",
      ].map((key) => [key, root.getPropertyValue(key).trim()]),
    );
    return { tokens, samples };
  });
  paletteMeasurements.push({ scope, ...measured });
  for (const sample of measured.samples) {
    // 最新视觉约定允许确认控件与主按钮共用明确的常态、悬停、按下色；不接受旧算法浅蓝。
    const allowedConfirmationBlue =
      sample.confirmationControl &&
      [
        [76, 102, 187],
        [96, 121, 204],
        [67, 90, 171],
      ].some((color) =>
        color.every(
          (channel, index) => channel === sample.effectiveBackground[index],
        ),
      );
    if (
      !allowedConfirmationBlue &&
      Math.max(...sample.effectiveBackground) -
        Math.min(...sample.effectiveBackground) >
        20
    )
      paletteViolations.push({ scope, ...sample });
  }
}

/** 通过真实鼠标依次检查页面的代表性 hover、焦点与展开选项，不改组件内部状态。 */
async function verifyNeutralStates(page, scope) {
  await recordNeutralBackgrounds(page, `${scope}-选中与输入`);
  const dialog = page.getByRole("dialog").first();
  const root = (await dialog.isVisible()) ? dialog : page;
  const selectors = [
    ".workspace-nav-item:not(.is-active)",
    ".chat-conversation-row",
    ".contacts-member",
    ".ant-table-tbody > tr > td",
    ".search-result-card",
    ".organization-menu-item",
    ".notifications-card-content",
    ".ant-segmented-item",
    ".ant-input:not([type='password'])",
    ".ant-select",
    ".ant-radio-button-wrapper-checked",
    ".ant-switch-checked",
  ];
  for (const selector of selectors) {
    const target = root.locator(`${selector}:visible`).first();
    if (!(await target.count()) || !(await target.isVisible())) continue;
    const box = await target.boundingBox();
    if (!box || box.x < 0 || box.y < 0 || box.y > 850) continue;
    await target.hover();
    await page.waitForTimeout(200);
    await recordNeutralBackgrounds(page, `${scope}-hover-${selector}`);
  }
  const input = root
    .locator("input.ant-input:visible:not([type='password'])")
    .first();
  if (await input.count()) {
    await input.focus();
    await recordNeutralBackgrounds(page, `${scope}-输入焦点`);
    await input.blur();
  }
}

/** 保存弹层的真实 DOM、坐标和动画样式，失败时不依赖已经关闭的截图。 */
async function recordPopupFailure(page, name) {
  failureUi.push({
    name,
    path: new URL(page.url()).pathname,
    ...(await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      rootClass: document.documentElement.className,
      popups: [
        ...document.querySelectorAll(
          ".ant-select-dropdown, .ant-dropdown, .ant-picker-dropdown, .ant-modal",
        ),
      ].map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          rect: rect.toJSON(),
          style: element.getAttribute("style"),
          transition: style.transition,
          animation: style.animation,
          dom: element.outerHTML.slice(0, 6500),
        };
      }),
    }))),
  });
}

/** 在系统减少动效时检查真实菜单坐标与鼠标操作，保留预定位坐标回归证据。 */
async function verifyReducedMotion(page, type) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigate(page, type === "task" ? "任务" : "文档");
  await page.emulateMedia({ reducedMotion: "reduce" });
  try {
    if (type === "task") {
      await choose(page, "任务优先级", "优先级：高");
    } else {
      const row = page.locator(".ant-table-row").first();
      await row.getByRole("button", { name: /^更多操作：/ }).click();
      const menuitem = page.getByRole("menuitem", {
        name: "重命名",
        exact: true,
      });
      await menuitem.click({ timeout: 5_000 });
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
    }
  } catch (error) {
    await recordPopupFailure(page, `reduce-motion-${type}`);
    const screenshot = path.join(
      directory,
      `reduce-motion-${type}-failure.png`,
    );
    await page.screenshot({ path: screenshot });
    screenshots.push(screenshot);
    throw error;
  } finally {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.keyboard.press("Escape");
  }
}

/** 截图并检查真实可见边界；被合法横向滚动容器或屏外抽屉裁切的内容不误报。 */
async function capture(page, name, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const screenshot = path.join(directory, `${name}-${width}.png`);
  await page.screenshot({ path: screenshot, animations: "disabled" });
  // 截图使用减少动效，但不能将其悄悄继承到后续菜单业务验收。
  await page.emulateMedia({ reducedMotion: "no-preference" });
  screenshots.push(screenshot);
  const layout = await page.evaluate(() => {
    const offenders = [];
    for (const element of document.querySelectorAll("body *")) {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        box.width < 2 ||
        box.height < 2 ||
        box.bottom < 0 ||
        box.top > innerHeight
      )
        continue;
      if (box.left >= -1 && box.right <= innerWidth + 1) continue;
      let parent = element.parentElement;
      let clipped = false;
      while (parent) {
        const parentStyle = getComputedStyle(parent);
        if (/hidden|clip|auto|scroll/.test(parentStyle.overflowX)) {
          const bounds = parent.getBoundingClientRect();
          if (bounds.left >= -1 && bounds.right <= innerWidth + 1) {
            clipped = true;
            break;
          }
        }
        parent = parent.parentElement;
      }
      if (!clipped)
        offenders.push({
          tag: element.tagName,
          className: String(element.className).slice(0, 130),
          text: element.textContent?.trim().slice(0, 70),
          left: Math.round(box.left),
          right: Math.round(box.right),
        });
    }
    return {
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: offenders.slice(0, 15),
    };
  });
  if (layout.scrollWidth > width + 1 || layout.offenders.length)
    layoutIssues.push({ name, width, ...layout });
  layoutMeasurements.push({ name, width, ...layout });
}

/** 汇总已执行页面的可见边界和未捕获错误，局部验收也不能忽略异常。 */
async function verifyBrowserEvidence() {
  await check("没有可见横向溢出", async () =>
    assert.deepEqual(layoutIssues, []),
  );
  await check("没有浏览器未捕获 JavaScript 异常或服务端 5xx", async () => {
    assert.deepEqual(browserErrors, []);
    assert.deepEqual(networkFailures, []);
  });
}

/** 覆盖正式页面与真实业务的独立自动化验收。 */
async function verify() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const modulePath = process.env.PLAYWRIGHT_MODULE || args[0];
  if (!modulePath)
    throw new Error(
      "自动模式需要现有 playwright 模块路径；预览请使用 --serve，本脚本不会安装依赖",
    );
  const { chromium } = createRequire(import.meta.url)(modulePath);
  browser = await chromium.launch({
    headless: true,
    channel: args[1] || "msedge",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  observe(page);
  page.setDefaultTimeout(20_000);
  await check("无 session 的真实 App 登录页与真实表单登录", async () => {
    await page.goto(`${url}/__workspace`);
    await page.getByRole("button", { name: "登录企业空间" }).waitFor();
    for (const width of [1440, 1024, 768, 375])
      await capture(page, "login-light", width);
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
  });
  const account = await login();
  const conversations = (
    await app
      .httpRequest()
      .get("/api/conversations")
      .set("Authorization", account.authorization)
      .expect(200)
  ).body.data;
  const group = conversations.find((item) => item.type === "group");
  assert.ok(group, "演示数据必须有可访问的真实群聊");
  if (process.argv.includes("--sections-only")) {
    const { verifyWorkspaceSections } =
      await import("./verify-workspace-sections.mjs");
    await verifyWorkspaceSections({
      app,
      browser,
      page,
      account,
      group,
      url,
      directory,
      login,
      check,
      navigate,
      choose,
      perform,
      signIn,
      observe,
      capture,
    });
    await verifyBrowserEvidence();
    return;
  }
  await check("迟到真实历史不覆盖Socket新消息，旧历史保留且新消息唯一", () =>
    verifyMessageHistoryRace(account, group),
  );
  await verifyLinks(page, context, account, group);
  if (process.argv.includes("--links-only")) {
    await verifyBrowserEvidence();
    return;
  }
  await check("实际消息气泡/画布中性色与暗色链接对比度", () =>
    verifyNeutralMessages(page, account, group),
  );
  if (process.argv.includes("--chat-only")) {
    await verifyBrowserEvidence();
    return;
  }
  await check("亮暗和跟随系统主题、刷新持久化、媒体实时变化", async () => {
    await selectTheme(page, "深色模式", "dark");
    await page.reload();
    await page.getByRole("link", { name: "消息", exact: true }).waitFor();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await selectTheme(page, "浅色模式", "light");
    await selectTheme(page, "跟随系统", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "light",
    );
    await page.reload();
    await page.getByRole("link", { name: "消息", exact: true }).waitFor();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
  });
  const task = await check("任务真实新增、编辑优先级和状态推进/完成/重开", () =>
    verifyTasks(page),
  );
  await check("文档与表格真实新建、重命名、收藏和搜索", () =>
    verifyDocuments(page),
  );
  await check("搜索真实任务结果并跳转定位", async () => {
    assert.ok(task, "任务前置检查必须通过");
    await navigate(page, "搜索");
    await page
      .getByRole("textbox", { name: "搜索关键词", exact: true })
      .fill(task.title);
    await choose(page, "搜索类型", "任务");
    const result = page
      .locator(".search-result-card")
      .filter({ hasText: task.title });
    await result.waitFor();
    await result.click();
    await page
      .locator('[data-search-highlighted="true"]')
      .filter({ hasText: task.title })
      .waitFor();
    assert.equal(
      new URL(page.url()).searchParams.get("taskId"),
      String(task.id),
    );
  });
  await check("通讯录真实筛选、详情和单聊导航", () => verifyContacts(page));
  await check("组织成员查询、清除筛选和新增部门", () =>
    verifyOrganization(page),
  );
  await check("审批真实提交版本和发起者只读详情", async () => {
    const { review, approver } = await reviewFixture(account, group);
    await navigate(page, "审批");
    await page.getByText("我发起的", { exact: true }).click();
    await page.getByRole("button").filter({ hasText: review.title }).click();
    await page
      .getByRole("heading", { name: review.title, exact: true })
      .waitFor();
    await page
      .getByText("工作台评审验收正文：确认企业协作工作台保持原业务能力。", {
        exact: true,
      })
      .waitFor();
    await page
      .getByText(`等待${approver.user.name}审批，只有指定审批人可操作。`, {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "通过并建任务", exact: true })
        .count(),
      0,
    );
  });
  await check("通知真实任务分配、标已读与全部/未读筛选", () =>
    verifyNotifications(page, account),
  );
  await check("设置四个分区、主题与减少动效以及四档尺寸", () =>
    verifySettings(page),
  );
  await check("无 session 的深色登录页四档尺寸", async () => {
    const guest = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: "dark",
    });
    const guestPage = await guest.newPage();
    observe(guestPage);
    await guestPage.goto(`${url}/__workspace`);
    await guestPage.getByRole("button", { name: "登录企业空间" }).waitFor();
    assert.equal(
      await guestPage.locator("html").getAttribute("data-theme"),
      "dark",
    );
    for (const width of [1440, 1024, 768, 375])
      await capture(guestPage, "login-dark", width);
    await guest.close();
  });
  // 后续业务检查独立展开，单页失败不会妨碍截图其他页面。
  for (const [name, heading] of [
    ["搜索", "工作区搜索"],
    ["通讯录", null],
    ["文档", "云文档"],
    ["任务", "我的任务"],
    ["审批", "文档评审"],
    ["通知", "通知中心"],
    ["组织管理", null],
    ["消息", null],
  ]) {
    await check(`${name}页面的亮暗主题与四档尺寸`, async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await navigate(page, name);
      if (heading)
        await page
          .getByRole("heading", { name: heading, exact: true })
          .waitFor();
      for (const [themeName, expected] of [
        ["浅色模式", "light"],
        ["深色模式", "dark"],
      ]) {
        await selectTheme(page, themeName, expected);
        if (expected === "dark") await verifyNeutralStates(page, name);
        for (const width of [1440, 1024, 768, 375])
          await capture(page, `${name}-${expected}`, width);
        await page.setViewportSize({ width: 1440, height: 900 });
      }
    });
  }
  await check("系统减少动效时任务下拉可见且可点击", () =>
    verifyReducedMotion(page, "task"),
  );
  await check("系统减少动效时文档操作菜单可见且可点击", () =>
    verifyReducedMotion(page, "document"),
  );
  await check("静态重命名确认框继承亮暗主题，文字/按钮对比度达标", () =>
    verifyStaticRenameTheme(page),
  );
  await check("舒适 Radio 选中态使用中性灰且文字对比度达标", async () => {
    const dark = radioColors.find((sample) => sample.theme === "dark");
    assert.ok(dark, "必须采集真实聊天设置舒适选中态");
    assert.deepEqual(rgbChannels(dark.background), [58, 64, 74]);
    assert.ok(contrastRatio(dark.foreground, dark.background) >= 4.5);
  });
  await check(
    "暗色全局背景与 Radio 按钮保持中性灰，其余确认控件仅允许指定沉稳蓝",
    async () => {
      assert.ok(paletteMeasurements.length > 0, "必须采集实际页面状态");
      const expected = {
        "--app-canvas": "#141619",
        "--app-surface": "#1c1f24",
        "--app-surface-soft": "#24282e",
        "--app-surface-muted": "#2e333b",
        "--app-primary-soft": "#2d323b",
        "--app-line": "#353b43",
      };
      assert.deepEqual(paletteMeasurements[0].tokens, expected);
      assert.equal(
        paletteViolations.length,
        0,
        `非中性背景：${JSON.stringify(paletteViolations.slice(0, 12))}`,
      );
    },
  );
  await verifyBrowserEvidence();
}

/** 将报告写入临时目录；明确区分真实业务覆盖和原生客户端未覆盖能力。 */
function writeReport() {
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        mode: serve ? "serve" : "verify",
        selection: serve
          ? "preview"
          : process.argv.includes("--sections-only")
            ? "workspace-sections"
            : process.argv.includes("--links-only")
              ? "links-only"
              : process.argv.includes("--chat-only")
                ? "chat-only"
                : "full-workspace",
        url,
        apiUrl,
        collaborationUrl,
        directory,
        databasePath,
        passed: checks.length,
        checks,
        failures,
        browserErrors,
        consoleErrors,
        networkFailures,
        historyRaceEvidence,
        layoutIssues,
        layoutMeasurements,
        messageColors,
        paletteMeasurements,
        paletteViolations,
        staticModalColors,
        radioColors,
        palettePolicy:
          "页面选中、hover、输入及Radio按钮背景通道差不大于20；Checkbox/Radio圆点/Switch确认控件仅允许#4c66bb及指定hover/active色，主按钮不作灰阶断言；舒适Radio另断言#3a404a",
        failureUi,
        screenshots,
        scope:
          "真实 React App、登录表单、Egg HTTP/Socket；独立临时数据库与 Vite cacheDir；没有 native bridge 或 UI mock",
        linkTargetScope:
          "HTTP/HTTPS popup 使用受控本地落地页；竞态用例只延迟一次真实历史 HTTP 响应，不修改响应内容，后续重取正常放行；不验证 TLS 握手或系统浏览器启动",
        notCovered: [
          "Electron 原生窗口和 preload",
          "聊天发送框依赖原生 SQLite/outbox，需真实 Electron 验证；API fixture 不代表发送框通过",
          "Electron 本地 SQLite/离线 outbox（基础存储另由 IM 测试覆盖）",
          "文档/表格独立原生编辑窗口、Hocuspocus 多人协作",
          "系统截图、附件文件选择与原生下载",
          "真实 OS 系统设置变更（使用浏览器媒体仿真）",
        ],
      },
      null,
      2,
    ),
  );
}

/** 关闭本脚本拥有的服务；不删除临时证据，也不影响其他 agent 的进程。 */
async function close() {
  await browser?.close();
  await vite?.close();
  // 手工启动的协作服务不归 unittest 的私有生命周期钩子管理，必须先落库再关数据库。
  await collaboration?.destroy();
  if (app?.io) await new Promise((resolve) => app.io.close(resolve));
  if (api?.listening) await new Promise((resolve) => api.close(resolve));
  await app?.close();
  await app?.chatDb?.sequelize.close();
}

try {
  await startServers();
  if (serve) {
    writeReport();
    console.log(
      "READY 预览持续运行，Ctrl+C 关闭；普通 /__workspace 无自动登录，SIGNED_IN_URL 使用真实演示账号登录。",
    );
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  } else {
    await verify();
  }
} catch (error) {
  failures.push({ name: "验收入口", error: error.stack || error.message });
  console.error(error.stack || error.message);
} finally {
  await close();
  writeReport();
  console.log(`REPORT ${reportPath}`);
  process.exit(failures.length ? 1 : 0);
}
