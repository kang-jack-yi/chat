// 独立预览：node apps/desktop/scripts/verify-chat-experience.mjs --serve
// 仅验证真实 fixture：追加 --fixtures-only；浏览器验收：追加 --verify。
// 滚动子集：--serve --verify --scroll-only <已有 playwright 模块路径> msedge
// 不安装依赖、不重建 native、不注入 desktop bridge；证据留在系统临时目录。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { createServer } from "vite";

const args = process.argv.slice(2);
if (args.includes("--help") || !args.includes("--serve")) {
  console.log(
    "Usage: node apps/desktop/scripts/verify-chat-experience.mjs --serve [--fixtures-only | --verify [--scroll-only]] [playwright-module] [msedge]",
  );
  process.exit(args.includes("--help") ? 0 : 1);
}
const desktopRoot = path.resolve(import.meta.dirname, "..");
const serverRoot = path.resolve(desktopRoot, "../server");
const serverRequire = createRequire(path.join(serverRoot, "package.json"));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chat-experience-"));
const databasePath = path.join(directory, "chat.sqlite");
const reportPath = path.join(directory, "chat-experience.json");
const viewportSelector = 'section[aria-label="聊天消息"]';
const report = {
  status: "preparing",
  selection: args.includes("--scroll-only")
    ? "scroll-only"
    : args.includes("--verify")
      ? "chat-experience"
      : "fixtures-only",
  directory,
  databasePath,
  checks: [],
  failures: [],
  screenshots: [],
  measurements: [],
  browserErrors: [],
  consoleErrors: [],
  networkFailures: [],
  expectedNetworkFailures: [],
  scope:
    "独立真实 Egg HTTP/Socket、临时 SQLite/Vite 和自有 Edge；所有 API 消息发送仅为 fixture，不验证发送框或任何原生桥能力。",
  auditRisks: [
    "初始滚动、ResizeObserver 与分页补偿可能争夺 scrollTop；必须比较实际消息锚点。",
    "实时消息与分页响应并发可能覆盖缓存或重复计数；必须保留旧消息并核对新消息 ID。",
    "打开未读会话会清除未读状态；筛选测试需要独立、尚未打开的真实会话。",
    "草稿按会话保存，但引用、多选、成员搜索、Drawer 与路由状态可能跨会话泄漏。",
    "普通成员须能阅读和操作个人设置，不能把群主账号成功等同于普通成员可用。",
    "亮暗窄屏需同时观察内容、输入框、抽屉和回底部浮层；截图本身不等于视觉通过。",
  ],
  notCovered: [
    "Electron 原生主窗口、子窗口及 preload/IPC。浏览器断言 window.desktop 不存在。",
    "聊天输入框发送、发送队列、失败重试和取消发送依赖原生 SQLite/outbox；API 发送全部仅为 fixture。",
    "原生本地 SQLite、离线 outbox、增量同步与断线重连恢复。",
    "原生全文消息搜索、聊天历史窗口及未加载消息的 messageId 定位依赖 localDatabase。浏览器仅测已有会话名称搜索。",
    "原生附件文件选择、附件草稿缓存、上传/重试、下载另存为及打开所在文件夹。",
    "原生图片查看窗口、系统截图及系统剪贴板复制/粘贴。",
    "系统浏览器启动、原生通知及真实 OS 主题切换。",
    "原生凭据恢复；深链接刷新使用隔离入口 phone 参数执行真实 API 重登录。",
    "持久化草稿跨应用重启；本次只验证同一页面内跨会话保留。",
    "图片迟到增高的浏览器场景未覆盖：真实上传目录固定为 server/storage/uploads，未为该用例写入共享仓库存储；不能将父侧 hook 单测当作此脚本浏览器通过。",
    "截图无历史像素基准；需人工审阅，不能据此声称像素级视觉回归通过。",
  ],
};
let app;
let api;
let vite;
let browser;
let url;
let apiUrl;
let fixture;

/** 保存不含令牌的检查结果；临时数据库和截图均保留供复核。 */
function writeReport() {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

/** 记录独立检查并继续收集后续证据，失败时保留本脚本页面的截图。 */
async function check(name, action, page) {
  try {
    await action();
    report.checks.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    report.failures.push({ name, error: error.stack || error.message });
    console.error(`FAIL ${name}: ${error.message}`);
    if (page && !page.isClosed()) {
      await capture(page, `failure-${report.failures.length}`).catch(
        () => undefined,
      );
    }
  }
  writeReport();
}

/** 参考 workspace 验收脚本启动随机端口服务，仅复用其正式浏览器入口。 */
async function startServers() {
  process.env.CHAT_DATABASE_PATH = databasePath;
  process.env.CHAT_COLLABORATION_DISABLED = "1";
  process.env.EGG_TYPESCRIPT = "true";
  process.env.EGG_SERVER_ENV = "unittest";
  process.env.CHAT_CONSOLE_LOG_LEVEL = "ERROR";
  process.env.CHAT_VITE_CACHE_DIR = path.join(directory, "vite-cache");
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
  api = http.createServer(app.callback());
  app.io.attach(api);
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${api.address().port}`;
  const portProbe = http.createServer();
  await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
  const previewPort = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  vite = await createServer({
    root: desktopRoot,
    cacheDir: process.env.CHAT_VITE_CACHE_DIR,
    plugins: [
      {
        name: "isolated-chat-experience",
        /** 深链接仍挂载正式 App，不替换业务组件、接口或桌面桥。 */
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            const pathname = new URL(request.url || "/", "http://127.0.0.1")
              .pathname;
            if (!/^\/(?:__workspace|login|chat(?:\/\d+)?)?$/.test(pathname))
              return next();
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(
              '<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>独立聊天 QA</title></head><body><div id="root" style="height:100vh"></div><script type="module" src="/@vite/client"></script><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/scripts/workspace-browser-entry.tsx"></script></body></html>',
            );
          });
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      port: previewPort,
      strictPort: true,
      proxy: { "/api": apiUrl, "/socket.io": { target: apiUrl, ws: true } },
    },
  });
  await vite.listen();
  url = `http://127.0.0.1:${vite.httpServer.address().port}`;
  Object.assign(report, { url, apiUrl });
  console.log(`PREVIEW_URL ${url}/__workspace`);
  console.log(`TEMP_DIR ${directory}`);
  console.log(`REPORT ${reportPath}`);
}

/** 使用真实 HTTP API，访问令牌只保存在进程内存而不写入证据。 */
async function request(account, method, pathname, body, expected = 200) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(account ? { Authorization: account.authorization } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, expected, `${method} ${pathname}`);
  const result = await response.json();
  if (expected === 200)
    assert.equal(result.success, true, `${method} ${pathname}`);
  return result.data;
}

/** 登录隔离数据库里的演示账号，不读取或复用父进程的会话。 */
async function login(phone) {
  const session = await request(null, "POST", "/api/auth/login", {
    phone,
    password: "123456",
  });
  return { user: session.user, authorization: `Bearer ${session.accessToken}` };
}

/** 经真实消息接口发送 fixture；此方法不表示原生发送框已验证。 */
async function send(account, conversationId, text) {
  return request(
    account,
    "POST",
    `/api/conversations/${conversationId}/messages`,
    {
      schemaVersion: 1,
      clientId: crypto.randomUUID(),
      conversationId,
      parts: [{ type: "text", text }],
    },
  );
}

/** 创建普通成员、四页历史、两种未读会话及短会话，验证后端分页和权限。 */
async function prepareFixtures() {
  const owner = await login("13800000001");
  const member = await login("13800000003");
  const peer = await login("13800000004");
  assert.equal(member.user.role, "member");
  const group = await request(owner, "POST", "/api/conversations", {
    type: "group",
    name: "QA 多页消息与滚动",
    memberIds: [member.user.id, peer.user.id],
  });
  const announcementText = "QA 群公告：请在周五前完成回归检查。";
  const announcement = await request(
    owner,
    "POST",
    `/api/conversations/${group.id}/announcement`,
    {
      schemaVersion: 1,
      clientId: crypto.randomUUID(),
      conversationId: group.id,
      parts: [{ type: "text", text: announcementText }],
    },
  );
  assert.equal(announcement.kind, "announcement");
  const unread = await request(owner, "POST", "/api/conversations", {
    type: "group",
    name: "QA 未读群聊",
    memberIds: [member.user.id, peer.user.id],
  });
  const direct = await request(member, "POST", "/api/conversations", {
    type: "direct",
    userId: peer.user.id,
  });
  const tailGroup = await request(owner, "POST", "/api/conversations", {
    type: "group",
    name: "QA 38条自然分页",
    memberIds: [member.user.id, peer.user.id],
  });
  const messages = [];
  for (let index = 1; index <= 95; index += 1) {
    messages.push(
      await send(
        index % 5 === 0 ? member : owner,
        group.id,
        `QA 历史 ${String(index).padStart(3, "0")} · ${index % 7 === 0 ? "多行阅读与长文本布局验证。".repeat(10) : "确认上翻历史保持当前位置。"}`,
      ),
    );
  }
  const tailMessages = [];
  for (let index = 1; index <= 37; index += 1) {
    tailMessages.push(
      await send(
        owner,
        tailGroup.id,
        `QA 自然分页 ${index} · 验证最后不足一页时仍保留阅读锚点。`,
      ),
    );
  }
  const tailFirst = await request(
    member,
    "GET",
    `/api/conversations/${tailGroup.id}/messages?limit=30`,
  );
  const tailLast = await request(
    member,
    "GET",
    `/api/conversations/${tailGroup.id}/messages?limit=30&before=${tailFirst.nextCursor}`,
  );
  assert.deepEqual([tailFirst.items.length, tailLast.items.length], [30, 8]);
  await send(owner, unread.id, "QA 未读群聊 fixture");
  await send(peer, direct.id, "QA 未读单聊 fixture");
  const pages = [];
  let before;
  do {
    const page = await request(
      member,
      "GET",
      `/api/conversations/${group.id}/messages?limit=30${before ? `&before=${before}` : ""}`,
    );
    pages.push(page);
    before = page.nextCursor;
    assert.ok(pages.length < 10, "分页游标必须推进");
  } while (before);
  const ids = pages.flatMap((page) => page.items.map((message) => message.id));
  assert.equal(new Set(ids).size, ids.length, "真实分页不能重复消息");
  assert.ok(messages.every((message) => ids.includes(message.id)));
  assert.ok(pages.length >= 4);
  const detail = await request(member, "GET", `/api/conversations/${group.id}`);
  assert.notEqual(detail.createdBy, member.user.id);
  assert.ok(detail.members.some((user) => user.id === member.user.id));
  await request(
    member,
    "POST",
    `/api/conversations/${group.id}/owner`,
    { userId: peer.user.id },
    403,
  );
  const conversations = await request(member, "GET", "/api/conversations");
  for (const item of [unread, direct])
    assert.ok(conversations.find((row) => row.id === item.id)?.unreadCount > 0);
  report.fixture = {
    memberRole: member.user.role,
    groupId: group.id,
    unreadGroupId: unread.id,
    directId: direct.id,
    messageIds: messages.map((message) => message.id),
    pageSizes: pages.map((page) => page.items.length),
    tailGroupId: tailGroup.id,
    tailPageSizes: [30, 8],
    announcementId: announcement.id,
  };
  fixture = {
    owner,
    member,
    peer,
    group,
    unread,
    direct,
    messages,
    tailGroup,
    tailMessages,
    announcementText,
  };
}

/** 只观察当前测试页面的异常及状态码，不保存请求头或登录响应。 */
function observe(page) {
  let authenticated = false;
  page.on("pageerror", (error) => report.browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname === "/api/auth/login" && response.status() === 200)
      authenticated = true;
    if (
      !authenticated &&
      response.status() === 401 &&
      ["/api/auth/me", "/api/auth/refresh"].includes(pathname)
    ) {
      report.expectedNetworkFailures.push({
        path: pathname,
        status: 401,
        reason: "初次未登录的凭据恢复探测",
      });
      return;
    }
    if (response.url().includes("/api/") && response.status() >= 400) {
      report.networkFailures.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
    }
  });
}

/** 等待可观测条件而非固定睡眠；超时输出最后一次测量值。 */
async function eventually(read, accepts, label, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (accepts(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`${label}: ${JSON.stringify(value)}`);
}

/** 使用真实登录表单进入普通成员会话，不自动灌入认证或组件状态。 */
async function signIn(page) {
  await page.goto(`${url}/__workspace`);
  assert.equal(await page.evaluate(() => Boolean(window.desktop)), false);
  await page
    .getByRole("textbox", { name: "手机号" })
    .fill(fixture.member.user.phone);
  await page.locator('input[name="password"]').fill("123456");
  await page.getByRole("button", { name: "登录企业空间" }).click();
  await page.getByRole("link", { name: "消息", exact: true }).waitFor();
}

/** 点击可见会话行，覆盖正式选择与深链接更新流程。 */
async function openChat(page, conversation = fixture.group) {
  const back = page.getByRole("button", { name: "返回会话列表", exact: true });
  if (await back.isVisible()) await back.click();
  await page
    .getByRole("button", {
      name: `打开会话：${conversation.name}`,
      exact: true,
    })
    .click();
  await page.getByRole("textbox", { name: "消息输入框" }).waitFor();
  await page.waitForURL(`**/chat/${conversation.id}`);
  await page
    .locator(".chat-detail-heading")
    .getByText(conversation.name, { exact: true })
    .waitFor();
}

/** 读取视口和首个完整可见消息的相对位置，供分页及实时滚动断言。 */
async function measure(page) {
  return page.locator(viewportSelector).evaluate((viewport) => {
    const bounds = viewport.getBoundingClientRect();
    const row = [...viewport.querySelectorAll('[id^="message-"]')].find(
      (element) => {
        const rect = element.getBoundingClientRect();
        return rect.top >= bounds.top && rect.top < bounds.bottom;
      },
    );
    return {
      top: viewport.scrollTop,
      height: viewport.scrollHeight,
      client: viewport.clientHeight,
      bottom:
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
      anchor: row?.id,
      offset: row ? row.getBoundingClientRect().top - bounds.top : null,
      count: viewport.querySelectorAll('[id^="message-"]').length,
    };
  });
}

/** 通过真实鼠标滚轮阅读历史，不调用生产 hook 或直接改写 scrollTop。 */
async function wheel(page, delta) {
  await page.locator(viewportSelector).hover();
  await page.mouse.wheel(0, delta);
}

/** 等待布局及其后续 RAF 补偿结束，避免在 React 提交与滚动恢复之间测量。 */
async function afterFrames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

/** 保存当前可见页面及布局测量；不把未审阅截图标记为视觉通过。 */
async function capture(page, name) {
  const file = path.join(directory, `${name}.png`);
  await page.screenshot({ path: file, animations: "disabled" });
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    theme: document.documentElement.dataset.theme,
  }));
  report.screenshots.push({ name, path: file, review: "pending", ...layout });
  assert.ok(layout.documentWidth <= layout.width + 1, `${name} 页面横向溢出`);
}

/** 验证真实 Socket 新消息、历史保位、计数及底部跟随。 */
async function verifyScroll(page) {
  await openChat(page);
  await page.locator(`#message-${fixture.messages.at(-1).id}`).waitFor();
  await check(
    "初始多页消息定位底部",
    async () => {
      const initial = await eventually(
        () => measure(page),
        (state) => state.bottom < 4,
        "初始底部",
      );
      assert.ok(initial.height > initial.client * 2);
      report.measurements.push({ name: "initial", ...initial });
    },
    page,
  );
  await check(
    "底部接收真实 Socket 消息自动跟随",
    async () => {
      const message = await send(
        fixture.owner,
        fixture.group.id,
        "QA 底部跟随实时消息",
      );
      await page.locator(`#message-${message.id}`).waitFor();
      await eventually(
        () => measure(page),
        (state) => state.bottom < 4,
        "新消息后底部",
      );
    },
    page,
  );
  await check(
    "底部真实点击气泡后新消息仍跟随且无新消息提示",
    () => verifyBottomClick(page),
    page,
  );
  await check(
    "阅读历史保位、3 条新消息与回到底部清零",
    async () => {
      await wheel(page, -650);
      await eventually(
        () => measure(page),
        (state) => state.bottom > 300,
        "已离开底部",
      );
      const before = await measure(page);
      assert.ok(before.anchor);
      for (let index = 1; index <= 3; index += 1) {
        const message = await send(
          fixture.owner,
          fixture.group.id,
          `QA 上翻时新消息 ${index}`,
        );
        await page.locator(`#message-${message.id}`).waitFor();
      }
      const jump = page.getByRole("button", {
        name: "回到最新消息",
        exact: true,
      });
      await eventually(
        () => jump.innerText(),
        (text) => /3\s*条新消息/.test(text),
        "新消息计数必须为3",
      );
      const after = await measure(page);
      report.measurements.push({ name: "incoming-anchor", before, after });
      assert.equal(after.anchor, before.anchor);
      assert.ok(
        Math.abs(after.offset - before.offset) <= 4,
        "实时消息不能抢阅读位置",
      );
      await capture(page, "scroll-new-message-indicator");
      await jump.click();
      await eventually(
        () => measure(page),
        (state) => state.bottom < 4,
        "回到底部",
      );
      await jump.waitFor({ state: "hidden" });
    },
    page,
  );
  await check(
    "当前会话实时消息已读后列表未读提示归零",
    async () => {
      const row = page.locator(".chat-conversation-row").filter({
        has: page.getByRole("button", {
          name: `打开会话：${fixture.group.name}`,
          exact: true,
        }),
      });
      await eventually(
        async () => {
          const detail = await request(
            fixture.member,
            "GET",
            `/api/conversations/${fixture.group.id}`,
          );
          const badge = await row
            .locator('[aria-label$="条未读消息"]')
            .evaluateAll(
              (elements) => elements[0]?.getAttribute("aria-label") ?? null,
            );
          const sample = { serverUnread: detail.unreadCount, badge };
          report.activeUnread = sample;
          return sample;
        },
        (state) => state.serverUnread === 0 && state.badge === null,
        "当前会话未读提示与服务端一致",
      );
    },
    page,
  );
  await check(
    "真实顶部分页 loading 与锚点补偿",
    async () => {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      let held;
      let signal;
      const intercepted = new Promise((resolve) => {
        signal = resolve;
      });
      const pattern = `**/api/conversations/${fixture.group.id}/messages?*before=*`;
      /** 延迟一次真实分页响应，保留真实响应正文及状态码。 */
      const hold = async (route) => {
        const response = await route.fetch();
        held = await response.json();
        signal();
        await gate;
        await route.fulfill({ response });
      };
      await page.route(pattern, hold, { times: 1 });
      try {
        await wheel(page, -100000);
        await Promise.race([
          intercepted,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("未请求顶部分页")), 12000),
          ),
        ]);
        const before = await measure(page);
        const loading = page.getByRole("button", { name: /加载更早消息/ });
        assert.ok(
          (await loading.getAttribute("class"))?.includes("loading"),
          "分页须展示 loading",
        );
        await capture(page, "history-loading");
        release();
        await page.locator(`#message-${held.data.items[0].id}`).waitFor();
        await eventually(
          () => measure(page),
          (state) => state.height > before.height && state.top > 100,
          "分页后锚点补偿",
        );
        await afterFrames(page);
        const offset = await page
          .locator(`#${before.anchor}`)
          .evaluate(
            (element) =>
              element.getBoundingClientRect().top -
              element.closest("section").getBoundingClientRect().top,
          );
        assert.ok(
          Math.abs(offset - before.offset) <= 2,
          `分页锚点偏移 ${offset - before.offset}px`,
        );
        report.measurements.push({
          name: "pagination-anchor",
          before,
          after: await measure(page),
          offset,
        });
      } finally {
        release();
        await page.unroute(pattern, hold);
      }
    },
    page,
  );
  await check(
    "分页网络失败有明确错误且可重试",
    async () => {
      const pattern = `**/api/conversations/${fixture.group.id}/messages?*before=*`;
      /** 仅对本测试页下一次历史请求注入传输失败，不伪造成功业务响应。 */
      const fail = (route) => route.abort("failed");
      report.expectedNetworkFailures.push(
        "一次分页 net::ERR_FAILED（故障注入）",
      );
      await page.route(pattern, fail, { times: 1 });
      try {
        await wheel(page, -100000);
        await page
          .getByRole("alert")
          .filter({ hasText: "消息加载失败" })
          .waitFor();
        await capture(page, "history-error");
        await page
          .getByRole("button", { name: "重新加载", exact: true })
          .click();
        await page
          .getByRole("alert")
          .filter({ hasText: "消息加载失败" })
          .waitFor({ state: "hidden" });
        await page.locator(`#message-${fixture.messages.at(-1).id}`).waitFor();
      } finally {
        await page.unroute(pattern, fail);
      }
    },
    page,
  );
}

/** 以真实普通鼠标点击触发 pointerdown；API 新消息仅作 fixture，不调用发送框或 hook。 */
async function verifyBottomClick(page) {
  await eventually(
    () => measure(page),
    (state) => state.bottom <= 2,
    "点击前必须已贴底",
  );
  const bubble = page
    .locator(viewportSelector)
    .locator(".ant-dropdown-trigger[data-message-content]")
    .last();
  await bubble.click();
  await afterFrames(page);
  const clicked = await measure(page);
  assert.ok(clicked.bottom <= 2, "普通点击本身不应造成滚动");
  const message = await send(
    fixture.owner,
    fixture.group.id,
    "QA 真实点击底部气泡后，新消息仍应自动跟随。\n".repeat(8),
  );
  await page.locator(`#message-${message.id}`).waitFor();
  const jump = page.getByRole("button", { name: "回到最新消息", exact: true });
  try {
    await eventually(
      () => measure(page),
      (state) => state.bottom <= 2,
      "点击后到达的新消息应保持贴底",
    );
    await afterFrames(page);
    assert.equal(
      await jump.isVisible(),
      false,
      "未离开底部，不应出现新消息提示",
    );
  } finally {
    report.measurements.push({
      name: "bottom-click-follow",
      clicked,
      received: await measure(page),
      jumpVisible: await jump.isVisible(),
      messageId: message.id,
    });
    await capture(page, "bottom-click-follow");
    // 保存失败现场后恢复阅读位置，避免污染后续新消息计数用例。
    if (await jump.isVisible()) await jump.click();
  }
}

/** 无网络拦截地加载最后八条历史，滚动事件只读采样锚点并等待两帧后严格比较。 */
async function verifyNaturalPagination(page) {
  await openChat(page, fixture.tailGroup);
  await page.locator(`#message-${fixture.tailMessages.at(-1).id}`).waitFor();
  await eventually(
    () => measure(page),
    (state) => state.bottom < 4 && state.count === 30,
    "自然分页初始30条",
  );
  const topObserved = page.locator(viewportSelector).evaluate(
    (viewport) =>
      new Promise((resolve, reject) => {
        /** 只读取真实 scroll 事件发生时的首个可见消息，不改写滚动或应用状态。 */
        const observeTop = () => {
          if (viewport.scrollTop > 1) return;
          const bounds = viewport.getBoundingClientRect();
          const row = [...viewport.querySelectorAll('[id^="message-"]')].find(
            (element) =>
              element.getBoundingClientRect().top >= bounds.top &&
              element.getBoundingClientRect().top < bounds.bottom,
          );
          if (!row) return;
          clearTimeout(timeout);
          viewport.removeEventListener("scroll", observeTop);
          resolve({
            anchor: row.id,
            offset: row.getBoundingClientRect().top - bounds.top,
            count: viewport.querySelectorAll('[id^="message-"]').length,
          });
        };
        const timeout = setTimeout(() => {
          viewport.removeEventListener("scroll", observeTop);
          reject(new Error("未采集到顶端滚动事件"));
        }, 12000);
        viewport.addEventListener("scroll", observeTop);
      }),
  );
  await wheel(page, -100000);
  const before = await topObserved;
  assert.equal(before.count, 30, "必须在自然响应提交之前取得真实顶部锚点");
  await eventually(
    () => measure(page),
    (state) => state.count === 38,
    "自然分页最后8条提交",
  );
  await afterFrames(page);
  const offset = await page
    .locator(`#${before.anchor}`)
    .evaluate(
      (element) =>
        element.getBoundingClientRect().top -
        element.closest("section").getBoundingClientRect().top,
    );
  const delta = offset - before.offset;
  report.measurements.push({
    name: "natural-tail-pagination-anchor",
    before,
    after: await measure(page),
    offset,
    delta,
  });
  await capture(page, "natural-tail-pagination");
  assert.ok(Math.abs(delta) <= 2, `自然分页锚点偏移 ${delta}px，要求≤2px`);
}

/** 验证编辑状态按会话隔离，引用取消和多选退出只通过真实点击完成。 */
async function verifyDrafts(page) {
  await openChat(page);
  const editor = page.getByRole("textbox", { name: "消息输入框" });
  await editor.fill("QA 会话 A 草稿");
  await openChat(page, fixture.unread);
  await eventually(
    () => editor.innerText(),
    (text) => text === "",
    "新会话草稿为空",
  );
  await editor.fill("QA 会话 B 草稿");
  await openChat(page);
  await eventually(
    () => editor.innerText(),
    (text) => text === "QA 会话 A 草稿",
    "恢复会话 A 草稿",
  );
  const bubble = page.locator(
    `#message-${fixture.messages.at(-1).id} .ant-dropdown-trigger[data-message-content]`,
  );
  await bubble.click({ button: "right" });
  await page.getByRole("menuitem", { name: "回复", exact: true }).click();
  await openChat(page, fixture.unread);
  assert.equal(await editor.innerText(), "QA 会话 B 草稿");
  assert.equal(await page.getByRole("button", { name: "取消回复" }).count(), 0);
  await openChat(page);
  await page.getByRole("button", { name: "取消回复" }).waitFor();
  await page.getByRole("button", { name: "取消回复" }).click();
  await page
    .getByRole("button", { name: "取消回复" })
    .waitFor({ state: "hidden" });
  for (const exit of ["button", "escape", "conversation"]) {
    await bubble.click({ button: "right" });
    await page.getByRole("menuitem", { name: "多选", exact: true }).click();
    const cancel = page.getByRole("button", { name: "退出多选", exact: true });
    await cancel.waitFor();
    if (exit === "button") await cancel.click();
    if (exit === "escape") await page.keyboard.press("Escape");
    if (exit === "conversation") {
      await openChat(page, fixture.unread);
      await openChat(page);
    }
    await cancel.waitFor({ state: "hidden" });
  }
  assert.equal(await editor.innerText(), "QA 会话 A 草稿");
  await editor.fill("");
}

/** 在尚未打开的 fixture 上验证筛选、未读数和清空搜索，避免读取改变前置条件。 */
async function verifyFilters(page) {
  const filters = page.getByRole("group", { name: "会话筛选" });
  const all = filters.getByRole("button", { name: "全部", exact: true });
  const conversations = await request(
    fixture.member,
    "GET",
    "/api/conversations",
  );
  /** 将真实列表中的会话按钮映射成名称，和服务端快照逐项比较。 */
  const names = () =>
    page
      .getByRole("button", { name: /^打开会话：/ })
      .evaluateAll((buttons) =>
        buttons
          .map((button) =>
            button.getAttribute("aria-label").replace("打开会话：", ""),
          )
          .sort(),
      );
  const expected = (items) => items.map((item) => item.name).sort();
  await all.click();
  assert.deepEqual(await names(), expected(conversations));
  const unreadButton = filters.getByRole("button", { name: /^未读会话，/ });
  await unreadButton.click();
  await eventually(
    async () => {
      const current = await request(
        fixture.member,
        "GET",
        "/api/conversations",
      );
      const unread = current.filter((item) => item.unreadCount > 0);
      return {
        names: await names(),
        expected: expected(unread),
        label: await unreadButton.getAttribute("aria-label"),
        expectedLabel: `未读会话，${unread.length} 个`,
      };
    },
    (state) =>
      JSON.stringify(state.names) === JSON.stringify(state.expected) &&
      state.label === state.expectedLabel,
    "未读 UI 与已读回执后的真实 API 一致",
  );
  await filters.getByRole("button", { name: "群聊", exact: true }).click();
  assert.deepEqual(
    await names(),
    expected(conversations.filter((item) => item.type === "group")),
  );
  await all.click();
  const search = page.getByRole("textbox", {
    name: "搜索会话与消息",
    exact: true,
  });
  await search.fill("QA 不存在的会话");
  await page.getByText("没有找到相关内容", { exact: true }).waitFor();
  await page.locator(".chat-list-search .ant-input-clear-icon").click();
  assert.equal(await search.inputValue(), "");
  await all.waitFor();
  assert.deepEqual(await names(), expected(conversations));
}

/** 普通成员点击更多菜单更新个人设置，校验真实 API 并确认不会影响群主。 */
async function verifyMenus(page) {
  await openChat(page);
  const trigger = page.getByRole("button", {
    name: `${fixture.group.name}的更多操作`,
    exact: true,
  });
  const ownerBefore = await request(
    fixture.owner,
    "GET",
    `/api/conversations/${fixture.group.id}`,
  );
  for (const [label, key, value] of [
    ["置顶", "pinned", true],
    ["取消置顶", "pinned", false],
    ["开启免打扰", "muted", true],
    ["关闭免打扰", "muted", false],
  ]) {
    await trigger.click();
    assert.equal(await trigger.getAttribute("aria-expanded"), "true");
    const responsePending = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname ===
          `/api/conversations/${fixture.group.id}/settings`,
    );
    await page.getByRole("menuitem", { name: label, exact: true }).click();
    assert.equal((await responsePending).status(), 200);
    await eventually(
      () =>
        request(
          fixture.member,
          "GET",
          `/api/conversations/${fixture.group.id}`,
        ),
      (detail) => Boolean(detail[key]) === value,
      `${label}服务端落库`,
    );
    assert.equal(new URL(page.url()).pathname, `/chat/${fixture.group.id}`);
  }
  const ownerAfter = await request(
    fixture.owner,
    "GET",
    `/api/conversations/${fixture.group.id}`,
  );
  assert.equal(ownerAfter.pinned, ownerBefore.pinned);
  assert.equal(ownerAfter.muted, ownerBefore.muted);
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await page
    .getByRole("menuitem", { name: "删除聊天记录", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await trigger.click();
  await page
    .getByRole("menuitem", { name: "删除聊天记录", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^取\s*消$/ })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const messages = await request(
    fixture.member,
    "GET",
    `/api/conversations/${fixture.group.id}/messages?limit=30`,
  );
  assert.ok(messages.items.length > 0, "取消删除不应清空历史");
}

/** 验证普通成员搜索、宽屏折叠、窄屏关闭及切换会话后抽屉不会泄漏。 */
async function verifyMembers(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChat(page);
  const toggle = page.getByRole("button", { name: "群成员", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  const panel = page.getByRole("complementary", { name: "群成员列表" });
  await panel.waitFor();
  const search = panel.getByRole("textbox", {
    name: "搜索群成员",
    exact: true,
  });
  await search.fill(fixture.peer.user.name);
  await panel
    .getByRole("button", {
      name: `查看${fixture.peer.user.name}的成员资料`,
      exact: true,
    })
    .waitFor();
  assert.equal(
    await panel.getByRole("button", { name: /的成员资料$/ }).count(),
    1,
  );
  await search.fill("QA 无匹配成员");
  await panel.getByText("没有匹配的成员", { exact: true }).waitFor();
  await panel
    .getByRole("button", { name: "清除成员搜索", exact: true })
    .click();
  assert.equal(
    await panel.getByRole("button", { name: /的成员资料$/ }).count(),
    3,
  );
  await toggle.click();
  await panel.waitFor({ state: "hidden" });
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  for (const width of [1024, 768, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await openChat(page);
    await toggle.click();
    const drawer = page.getByRole("dialog", { name: "群成员", exact: true });
    await drawer.waitFor();
    await panel
      .getByRole("button", { name: "关闭群成员", exact: true })
      .click();
    await drawer.waitFor({ state: "hidden" });
    await toggle.click();
    await drawer.waitFor();
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await toggle.click();
  await page.getByRole("dialog", { name: "群成员", exact: true }).waitFor();
  await page.goBack();
  await page
    .getByRole("dialog", { name: "群成员", exact: true })
    .waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChat(page, fixture.direct);
  assert.equal(await toggle.count(), 0, "单聊不应展示群成员开关");
  await openChat(page);
}

/** 普通成员在侧栏和 Drawer 阅读真实公告并打开设置，空公告群不显示摘要卡。 */
async function verifyAnnouncements(page) {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await openChat(page);
    const toggle = page.getByRole("button", { name: "群成员", exact: true });
    if ((await toggle.getAttribute("aria-expanded")) !== "true")
      await toggle.click();
    const panel = page.getByRole("complementary", { name: "群成员列表" });
    const announcement = panel.getByRole("button", {
      name: "查看群公告",
      exact: true,
    });
    await announcement.waitFor();
    assert.ok(
      (await announcement.innerText()).includes(fixture.announcementText),
    );
    await capture(page, `announcement-panel-${width}`);
    await announcement.click();
    const settings = page.getByRole("dialog", {
      name: "群聊设置",
      exact: true,
    });
    await settings.waitFor();
    if (width === 375)
      await page
        .getByRole("dialog", { name: "群成员", exact: true })
        .waitFor({ state: "hidden" });
    await settings.getByText("群公告", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await settings.waitFor({ state: "hidden" });
    await openChat(page, fixture.unread);
    if ((await toggle.getAttribute("aria-expanded")) !== "true")
      await toggle.click();
    await panel.waitFor();
    assert.equal(
      await panel
        .getByRole("button", { name: "查看群公告", exact: true })
        .count(),
      0,
      "空公告群不能显示公告摘要入口",
    );
    await panel
      .getByRole("button", { name: "关闭群成员", exact: true })
      .click();
    await panel.waitFor({ state: "hidden" });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChat(page);
}

/** 验证路由回退、手机列表返回和真实 API 重登录后的深链接；不声称 native 会话恢复。 */
async function verifyRoutes(page) {
  await page.setViewportSize({ width: 375, height: 812 });
  await openChat(page);
  await page.getByRole("button", { name: "返回会话列表", exact: true }).click();
  await page.waitForURL("**/chat");
  await page
    .getByRole("button", {
      name: `打开会话：${fixture.group.name}`,
      exact: true,
    })
    .waitFor();
  await page.goBack();
  await page.waitForURL(`**/chat/${fixture.group.id}`);
  await page.getByRole("textbox", { name: "消息输入框" }).waitFor();
  await page.goForward();
  await page.waitForURL("**/chat");
  await page.goto(
    `${url}/chat/${fixture.group.id}?phone=${fixture.member.user.phone}`,
  );
  await page.getByRole("textbox", { name: "消息输入框" }).waitFor();
  await page.locator(`#message-${fixture.messages.at(-1).id}`).waitFor();
  await page.reload();
  await page.getByRole("textbox", { name: "消息输入框" }).waitFor();
  assert.equal(new URL(page.url()).pathname, `/chat/${fixture.group.id}`);
  await page.setViewportSize({ width: 1440, height: 900 });
}

/** 经真实主题菜单截图五档视口；完整验收另采集对应成员侧栏或 Drawer。 */
async function verifyVisuals(page) {
  for (const [theme, name] of [
    ["light", "浅色模式"],
    ["dark", "深色模式"],
  ]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
    await eventually(
      () => page.locator("html").getAttribute("data-theme"),
      (value) => value === theme,
      "主题切换",
    );
    for (const [width, height] of [
      [1440, 900],
      [1024, 768],
      [768, 1024],
      [375, 812],
      [812, 375],
    ]) {
      await page.setViewportSize({ width, height });
      await openChat(page);
      const membersToggle = page.getByRole("button", {
        name: "群成员",
        exact: true,
      });
      if ((await membersToggle.getAttribute("aria-expanded")) === "true") {
        await page
          .getByRole("button", { name: "关闭群成员", exact: true })
          .click();
        await page
          .getByRole("complementary", { name: "群成员列表" })
          .waitFor({ state: "hidden" });
      }
      await afterFrames(page);
      const jump = page.getByRole("button", {
        name: "回到最新消息",
        exact: true,
      });
      if (await jump.isVisible()) await jump.click();
      await capture(page, `chat-${theme}-${width}x${height}`);
      const box = await page
        .getByRole("textbox", { name: "消息输入框" })
        .boundingBox();
      assert.ok(
        box &&
          box.width > 40 &&
          box.height > 0 &&
          box.y >= 0 &&
          box.y + box.height <= height + 1,
        "输入框必须位于可见视口内",
      );
      if (!args.includes("--scroll-only")) {
        const toggle = page.getByRole("button", {
          name: "群成员",
          exact: true,
        });
        if ((await toggle.getAttribute("aria-expanded")) !== "true")
          await toggle.click();
        await page.getByRole("complementary", { name: "群成员列表" }).waitFor();
        await capture(page, `members-${theme}-${width}x${height}`);
        await page
          .getByRole("button", { name: "关闭群成员", exact: true })
          .click();
        await page
          .getByRole("complementary", { name: "群成员列表" })
          .waitFor({ state: "hidden" });
      }
    }
  }
}

/** 启动本脚本拥有的独立 Edge，按子集明确报告尚未执行的覆盖。 */
async function verifyBrowser() {
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const modulePath = process.env.PLAYWRIGHT_MODULE || positional[0];
  assert.ok(modulePath, "请提供已有 Playwright 路径；不安装依赖");
  const { chromium } = createRequire(import.meta.url)(modulePath);
  browser = await chromium.launch({
    headless: true,
    channel: positional[1] || "msedge",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  observe(page);
  await signIn(page);
  if (!args.includes("--scroll-only")) {
    await check(
      "全部/未读/群聊与清空搜索筛选",
      () => verifyFilters(page),
      page,
    );
  }
  await verifyScroll(page);
  await check(
    "自然分页最后8条，2帧后首个可见锚点偏差不超过2px",
    () => verifyNaturalPagination(page),
    page,
  );
  if (!args.includes("--scroll-only")) {
    await check(
      "跨会话草稿、取消引用及三种多选退出",
      () => verifyDrafts(page),
      page,
    );
    await check(
      "普通成员更多菜单和个人设置权限",
      () => verifyMenus(page),
      page,
    );
    await check("成员搜索、折叠与窄屏 Drawer", () => verifyMembers(page), page);
    await check(
      "普通成员侧栏/Drawer公告摘要、打开设置与空公告隐藏",
      () => verifyAnnouncements(page),
      page,
    );
    await check(
      "手机返回、浏览器前后退及会话深链接",
      () => verifyRoutes(page),
      page,
    );
  }
  await check("亮暗五档尺寸截图与输入区布局", () => verifyVisuals(page), page);
  await check(
    "浏览器无未捕获异常且未伪造 desktop bridge",
    async () => {
      assert.deepEqual(report.browserErrors, []);
      assert.equal(await page.evaluate(() => Boolean(window.desktop)), false);
      assert.deepEqual(report.networkFailures, []);
    },
    page,
  );
  report.pending = [
    ...(args.includes("--scroll-only")
      ? ["列表、成员、草稿与路由完整验收"]
      : []),
    "截图逐张人工审阅",
  ];
}

/** 只关闭自己创建的浏览器及服务，不终止任何父浏览器或其他进程。 */
async function close() {
  await browser?.close();
  await vite?.close();
  if (app?.io) await new Promise((resolve) => app.io.close(resolve));
  if (api?.listening) await new Promise((resolve) => api.close(resolve));
  await app?.close();
  await app?.chatDb?.sequelize.close();
}

try {
  await startServers();
  await prepareFixtures();
  report.checks.push("真实 API 四页消息、未读会话、普通成员读取与群主权限边界");
  writeReport();
  if (args.includes("--verify")) await verifyBrowser();
  else if (!args.includes("--fixtures-only")) {
    report.status = "ready";
    writeReport();
    console.log(
      `READY ${url}/__workspace?phone=13800000003&route=/chat/${fixture.group.id}`,
    );
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  }
  report.status = report.failures.length ? "failed" : "partial";
} catch (error) {
  report.status = "failed";
  report.failures.push({
    name: "验收入口",
    error: error.stack || error.message,
  });
  console.error(error.stack || error.message);
} finally {
  await close();
  writeReport();
  console.log(`REPORT ${reportPath}`);
  process.exit(report.failures.length ? 1 : 0);
}
