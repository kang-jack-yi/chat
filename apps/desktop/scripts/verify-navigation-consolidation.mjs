// 用法：node apps/desktop/scripts/verify-navigation-consolidation.mjs <现有 playwright 模块路径> [msedge]
// 仅启动自己的 verify-workspace-ui --serve、真实临时 API 和隔离浏览器；不连接现有实例，不安装或重编译依赖。
// 截图、报告和测试数据库保留在系统临时目录，便于复查。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const desktopRoot = path.resolve(import.meta.dirname, "..");
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "chat-navigation-verification-"),
);
const reportPath = path.join(directory, "navigation-verification.json");
const report = {
  startedAt: new Date().toISOString(),
  scope:
    "真实隔离 browser/API：团队、权限、原 URL、单聊、历史记录、主题及响应式布局；不覆盖 native bridge",
  checks: [],
  failures: [],
  screenshots: [],
  layouts: [],
  requests: [],
  browserErrors: [],
  serverErrors: [],
  consoleErrors: [],
};
let server;
let browser;
let baseUrl;
let serverLog = "";
let phase = "startup";

/** 记录相关生产文件指纹，识别回归期间发生的源码变更。 */
function fingerprints() {
  return Object.fromEntries(
    [
      "src/renderer/App.tsx",
      "src/renderer/layouts/BasicLayout/Sidebar.tsx",
      "src/renderer/layouts/WorkspaceSectionLayout/index.tsx",
      "src/renderer/layouts/WorkspaceSectionLayout/style.less",
      "src/renderer/constants/workspace-sections.ts",
      "src/renderer/pages/Contacts/index.tsx",
      "src/renderer/pages/Organization/index.tsx",
      "src/renderer/pages/Organization/hooks.ts",
      "src/renderer/pages/Organization/components/AdminMenu.tsx",
      "src/renderer/pages/Organization/page.less",
    ].map((name) => [
      name,
      createHash("sha256")
        .update(fs.readFileSync(path.join(desktopRoot, name)))
        .digest("hex"),
    ]),
  );
}

/** 启动独占临时后端和预览服务，并确认数据库位于临时目录。 */
async function startServer() {
  server = spawn(
    process.execPath,
    [path.join(import.meta.dirname, "verify-workspace-ui.mjs"), "--serve"],
    {
      cwd: desktopRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("隔离服务启动超过 120 秒")),
      120_000,
    );
    /** 收集本次子进程输出，仅在隔离预览就绪后继续。 */
    const consume = (data) => {
      serverLog += data.toString();
      if (!serverLog.includes("READY 预览持续运行")) return;
      clearTimeout(timeout);
      resolve();
    };
    server.stdout.on("data", consume);
    server.stderr.on("data", consume);
    server.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`隔离服务提前退出 ${code}: ${serverLog.slice(-3000)}`));
    });
  });
  baseUrl = serverLog.match(
    /PREVIEW_URL (http:\/\/127\.0\.0\.1:\d+)\/__workspace/,
  )?.[1];
  const tempDir = serverLog.match(/TEMP_DIR (.+)/)?.[1].trim();
  assert.ok(baseUrl && tempDir, "必须使用本脚本启动的隔离服务");
  assert.equal(
    path.dirname(fs.realpathSync(tempDir)),
    fs.realpathSync(os.tmpdir()),
  );
  assert.ok(path.basename(tempDir).startsWith("chat-workspace-ui-"));
  assert.ok(fs.existsSync(path.join(tempDir, "workspace.sqlite")));
  report.server = { baseUrl, tempDir, pid: server.pid };
  console.log(`ISOLATED ${baseUrl} TEMP_DIR ${tempDir}`);
}

/** 精确定位主侧栏，避免与页面内部导航混淆。 */
const sidebar = (page) =>
  page.getByRole("complementary", { name: "工作台导航", exact: true });
/** 定位团队顶部的通讯录与组织管理切换入口。 */
const teamNav = (page) =>
  page.getByRole("navigation", { name: "团队视图", exact: true });
/** 定位全尺寸共用的成员与部门切换入口。 */
const organizationNav = (page) =>
  page.getByRole("navigation", { name: "组织管理分区", exact: true });
/** 返回完整业务路径，保留查询参数和锚点供深链断言使用。 */
const location = (page) => {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}${url.hash}`;
};
/** 只选择当前可见按钮，兼容桌面和窄屏的同名操作。 */
const visibleButton = (page, name) =>
  page
    .getByRole("button", { name, exact: true })
    .locator("visible=true")
    .first();

/** 等待网络及两次绘制完成后读取界面状态。 */
async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

/** 独立记录检查结果和失败截图，失败后继续收集其他证据。 */
async function check(name, page, action) {
  const previousPhase = phase;
  phase = name;
  const requestStart = report.requests.length;
  try {
    await action();
    report.checks.push({
      name,
      requestStart,
      requestEnd: report.requests.length,
    });
    console.log(`PASS ${name}`);
  } catch (error) {
    const failure = {
      name,
      route: page && location(page),
      error: error.stack || error.message,
    };
    if (page && !page.isClosed()) {
      failure.screenshot = path.join(
        directory,
        `failure-${report.failures.length + 1}.png`,
      );
      await page
        .screenshot({ path: failure.screenshot, animations: "disabled" })
        .catch(() => undefined);
    }
    report.failures.push(failure);
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    phase = previousPhase;
  }
}

/** 记录浏览器异常及接口路径，不保存认证头或响应令牌。 */
function observe(page, role) {
  page.on("pageerror", (error) =>
    report.browserErrors.push({ role, phase, message: error.message }),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      report.consoleErrors.push({ role, phase, message: message.text() });
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/"))
      report.requests.push({
        role,
        phase,
        method: request.method(),
        path: url.pathname,
      });
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/") && response.status() >= 500)
      report.serverErrors.push({
        role,
        phase,
        path: url.pathname,
        status: response.status(),
      });
  });
}

/** 使用真实登录表单验证角色，并确认未注入桌面桥。 */
async function signIn(page, phone, role) {
  await page.goto(`${baseUrl}/__workspace`);
  await page.getByRole("textbox", { name: "手机号" }).fill(phone);
  await page.locator('input[name="password"]').fill("123456");
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/auth/login",
  );
  await page.getByRole("button", { name: "登录企业空间" }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  const { data } = await response.json();
  assert.equal(data.user.role, role);
  await sidebar(page)
    .getByRole("link", { name: "团队", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => Boolean(window.desktop)),
    false,
    "禁止假 native bridge",
  );
  await settle(page);
  return data;
}

/** 重新加载真实页面并登录隔离演示账号，验证指定深链。 */
async function coldRoute(page, phone, route) {
  await page.goto(
    `${baseUrl}/__workspace?phone=${phone}&route=${encodeURIComponent(route)}`,
  );
  await sidebar(page).waitFor();
  await settle(page);
}

/** 验证团队侧栏与顶部视图各有且仅有一个正确的活动项。 */
async function active(page, tab) {
  assert.equal(
    await sidebar(page)
      .getByRole("link", { name: "团队", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  assert.equal(
    await teamNav(page)
      .getByRole("link", { name: tab, exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  assert.equal(
    await sidebar(page).locator('a[aria-current="page"]').count(),
    1,
  );
  assert.equal(
    await teamNav(page).locator('a[aria-current="page"]').count(),
    1,
  );
}

/** 保存截图并检查可见横向溢出和主要布局区域边界。 */
async function capture(page, name) {
  await settle(page);
  const screenshot = path.join(directory, `${name}.png`);
  await page.screenshot({ path: screenshot, animations: "disabled" });
  report.screenshots.push(screenshot);
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
        box.top > innerHeight ||
        (box.left >= -1 && box.right <= innerWidth + 1)
      )
        continue;
      let clipped = false;
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const bounds = parent.getBoundingClientRect();
        if (
          /hidden|clip|auto|scroll/.test(getComputedStyle(parent).overflowX) &&
          bounds.left >= -1 &&
          bounds.right <= innerWidth + 1
        ) {
          clipped = true;
          break;
        }
      }
      if (!clipped)
        offenders.push({
          tag: element.tagName,
          className: String(element.className).slice(0, 100),
          left: box.left,
          right: box.right,
        });
    }
    const regions = [
      ...document.querySelectorAll(
        ".workspace-section-header, .workspace-section-content, .contacts-page, .organization-page, .workspace-section-nav a",
      ),
    ].map((element) => {
      const box = element.getBoundingClientRect();
      return {
        className: String(element.className),
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        bottom: box.bottom,
        right: box.right,
      };
    });
    return {
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: offenders.slice(0, 20),
      regions,
    };
  });
  report.layouts.push({ name, route: location(page), ...layout });
  assert.ok(layout.scrollWidth <= layout.width + 1, `${name}: 页面横向溢出`);
  assert.deepEqual(layout.offenders, [], `${name}: 可见内容越界`);
  for (const box of layout.regions) {
    assert.ok(
      box.width > 0 &&
        box.height > 0 &&
        box.left >= -1 &&
        box.right <= layout.width + 1 &&
        box.top >= -1 &&
        box.bottom <= layout.height + 1,
      `${name}: 区域被裁切 ${JSON.stringify(box)}`,
    );
  }
}

/** 在独立浏览器上下文中检查指定角色的权限、导航和单聊。 */
async function verifyRole(role, phone) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  observe(page, role);
  try {
    const session = await signIn(page, phone, role);
    await check(`${role}: 合并入口与设置保留`, page, async () => {
      assert.deepEqual(
        await sidebar(page).getByRole("link").allTextContents(),
        ["消息", "搜索", "团队", "文档", "工作中心"],
      );
      await sidebar(page)
        .getByRole("link", { name: "团队", exact: true })
        .click();
      await teamNav(page).waitFor();
      await settle(page);
      await active(page, "通讯录");
      assert.equal(
        await teamNav(page)
          .getByRole("link", { name: "组织管理", exact: true })
          .count(),
        role === "member" ? 0 : 1,
      );
      await sidebar(page)
        .getByRole("button", { name: "打开设置", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    });
    await check(
      `${role}: 联系人深链和活动 tab 点击不重置定位`,
      page,
      async () => {
        await coldRoute(
          page,
          phone,
          "/contacts/4?source=navigation-regression#profile",
        );
        await page
          .locator(".contacts-profile")
          .getByRole("heading", { name: "苏清", exact: true })
          .waitFor();
        const before = location(page);
        const start = report.requests.length;
        await teamNav(page)
          .getByRole("link", { name: "通讯录", exact: true })
          .click();
        await settle(page);
        assert.equal(location(page), before);
        assert.equal(
          report.requests
            .slice(start)
            .filter((request) => request.path === "/api/users").length,
          0,
          "活动 tab 不应重新查询联系人",
        );
        await active(page, "通讯录");
      },
    );
    if (role !== "member") {
      await check(
        `${role}: 管理 tab、部门往返保留和 browser back`,
        page,
        async () => {
          const original = location(page);
          await teamNav(page)
            .getByRole("link", { name: "组织管理", exact: true })
            .click();
          await visibleButton(page, "添加成员").waitFor();
          await active(page, "组织管理");
          assert.equal(location(page), "/organization");
          await page
            .getByRole("textbox", { name: "搜索成员" })
            .fill("13800000004");
          await page
            .getByRole("row")
            .filter({ hasText: "13800000004" })
            .waitFor();
          assert.equal(
            await organizationNav(page)
              .getByRole("button", { name: "成员与账号", exact: true })
              .getAttribute("aria-current"),
            "page",
          );
          await organizationNav(page)
            .getByRole("button", { name: "部门架构", exact: true })
            .click();
          await visibleButton(page, "新建部门").waitFor();
          assert.equal(location(page), "/organization?view=departments");
          await teamNav(page)
            .getByRole("link", { name: "通讯录", exact: true })
            .click();
          await settle(page);
          assert.equal(location(page), original);
          await teamNav(page)
            .getByRole("link", { name: "组织管理", exact: true })
            .click();
          await visibleButton(page, "新建部门").waitFor();
          assert.equal(location(page), "/organization?view=departments");
          assert.equal(
            await organizationNav(page)
              .getByRole("button", { name: "部门架构", exact: true })
              .getAttribute("aria-current"),
            "page",
          );
          await page.goBack();
          await settle(page);
          assert.equal(location(page), original);
          await page.goBack();
          await visibleButton(page, "新建部门").waitFor();
          assert.equal(location(page), "/organization?view=departments");
          await page.goBack();
          await visibleButton(page, "添加成员").waitFor();
          assert.equal(location(page), "/organization");
          await page.goBack();
          await settle(page);
          assert.equal(location(page), original);
          await page.goForward();
          await visibleButton(page, "添加成员").waitFor();
          await active(page, "组织管理");
        },
      );
    } else {
      await check(
        "member: 组织 URL 拒绝且后台管理写操作仍返回 403",
        page,
        async () => {
          await coldRoute(page, phone, "/organization");
          assert.match(location(page), /^\/chat(?:\/\d+)?$/);
          assert.equal(await teamNav(page).count(), 0);
          assert.equal(
            await page
              .getByRole("button", { name: "添加成员", exact: true })
              .count(),
            0,
          );
          const response = await context.request.post(
            `${baseUrl}/api/departments`,
            {
              headers: { Authorization: `Bearer ${session.accessToken}` },
              data: { name: "禁止创建的部门", parentId: null },
            },
          );
          assert.equal(response.status(), 403);
        },
      );
    }
    await check(
      `${role}: 联系人单聊只提交一次且重复发起复用原会话`,
      page,
      async () => {
        let conversationId;
        for (let index = 0; index < 2; index++) {
          await coldRoute(page, phone, "/contacts/4");
          const start = report.requests.length;
          const result = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === "/api/conversations" &&
              response.request().method() === "POST",
          );
          await visibleButton(page, /发\s*消\s*息/).click();
          const response = await result;
          assert.equal(response.status(), 200);
          const { data } = await response.json();
          if (index) assert.equal(data.id, conversationId);
          conversationId = data.id;
          await page.getByRole("textbox", { name: "消息输入框" }).waitFor();
          await settle(page);
          assert.equal(location(page), `/chat/${conversationId}`);
          assert.equal(
            report.requests
              .slice(start)
              .filter(
                (request) =>
                  request.method === "POST" &&
                  request.path === "/api/conversations",
              ).length,
            1,
          );
          await page.goBack();
          await teamNav(page).waitFor();
          assert.equal(location(page), "/contacts/4");
        }
      },
    );
    await check(`${role}: 折叠导航活动状态和工作中心原 URL`, page, async () => {
      await coldRoute(page, phone, "/contacts/4");
      await sidebar(page)
        .getByRole("button", { name: "折叠导航", exact: true })
        .click();
      await active(page, "通讯录");
      if (role !== "member") {
        await teamNav(page)
          .getByRole("link", { name: "组织管理", exact: true })
          .click();
        await visibleButton(page, "添加成员").waitFor();
        await active(page, "组织管理");
      }
      await capture(page, `${role}-collapsed-team`);
      await sidebar(page)
        .getByRole("link", { name: "工作中心", exact: true })
        .click();
      const nav = page.getByRole("navigation", {
        name: "工作中心视图",
        exact: true,
      });
      for (const [label, route] of [
        ["审批", "/reviews"],
        ["通知", "/notifications"],
        ["任务", "/tasks"],
      ]) {
        await nav.getByRole("link", { name: label, exact: true }).click();
        await settle(page);
        assert.equal(new URL(page.url()).pathname, route);
        assert.equal(
          await sidebar(page)
            .getByRole("link", { name: "工作中心", exact: true })
            .getAttribute("aria-current"),
          "page",
        );
        assert.equal(
          await sidebar(page)
            .getByRole("link", { name: "团队", exact: true })
            .getAttribute("aria-current"),
          null,
        );
      }
      await sidebar(page)
        .getByRole("button", { name: "展开导航", exact: true })
        .click();
    });
    if (role === "owner") await verifyLayouts(page, phone);
  } finally {
    await context.close();
  }
}

/** 确认窄屏列表或指定资料的可见状态与当前 URL 一致。 */
async function assertMobileContacts(page, selected) {
  await settle(page);
  assert.equal(location(page), selected ? "/contacts/4" : "/contacts");
  const detail = page.locator(".contacts-detail");
  await detail.waitFor({ state: selected ? "visible" : "hidden" });
  if (selected) {
    await detail.getByRole("heading", { name: "苏清", exact: true }).waitFor();
    await page
      .getByRole("button", { name: "返回通讯录", exact: true })
      .waitFor();
    assert.equal(
      await page.locator('.contacts-member[aria-pressed="true"]').count(),
      1,
    );
  } else {
    await page.getByPlaceholder("搜索姓名、职位或手机号").waitFor();
    assert.equal(
      await page.locator('.contacts-member[aria-pressed="true"]').count(),
      0,
    );
    assert.ok(
      await page
        .getByRole("region", { name: "企业通讯录", exact: true })
        .isVisible(),
    );
  }
  await active(page, "通讯录");
}

/** 验证窄屏根入口、点击和返回，以及历史前进后退的路由同步。 */
async function verifyMobileNavigation(page, phone, theme) {
  await check(`${theme}/375: 根入口只显示联系人列表`, page, async () => {
    await coldRoute(page, phone, "/contacts");
    await assertMobileContacts(page, false);
    await capture(page, `${theme}-375-contacts-root`);
  });
  await check(`${theme}/375: 点击资料再返回列表`, page, async () => {
    await coldRoute(page, phone, "/contacts");
    await page
      .getByRole("region", { name: "企业通讯录", exact: true })
      .getByRole("button")
      .filter({ hasText: "苏清" })
      .click();
    await assertMobileContacts(page, true);
    await capture(page, `${theme}-375-contacts-opened`);
    await page.getByRole("button", { name: "返回通讯录", exact: true }).click();
    await assertMobileContacts(page, false);
    await capture(page, `${theme}-375-contacts-returned`);
  });
  await check(
    `${theme}/375: browser back/forward 同步列表与资料`,
    page,
    async () => {
      await coldRoute(page, phone, "/contacts");
      await page
        .getByRole("region", { name: "企业通讯录", exact: true })
        .getByRole("button")
        .filter({ hasText: "苏清" })
        .click();
      await assertMobileContacts(page, true);
      await page.goBack();
      await assertMobileContacts(page, false);
      await page.goForward();
      await assertMobileContacts(page, true);
      await page
        .getByRole("button", { name: "返回通讯录", exact: true })
        .click();
      await assertMobileContacts(page, false);
      await page.goBack();
      await assertMobileContacts(page, true);
      await capture(page, `${theme}-375-contacts-history-detail`);
      await page.goForward();
      await assertMobileContacts(page, false);
      await capture(page, `${theme}-375-contacts-history-list`);
    },
  );
}

/** 在亮暗主题和四种宽度下检查团队页面布局及窄屏交互。 */
async function verifyLayouts(page, phone) {
  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await sidebar(page)
      .getByRole("button", { name: "切换主题", exact: true })
      .click();
    await page
      .getByRole("menuitem", {
        name: theme === "light" ? "浅色模式" : "深色模式",
        exact: true,
      })
      .click();
    await page.waitForFunction(
      (expected) => document.documentElement.dataset.theme === expected,
      theme,
    );
    for (const width of [1024, 1280, 1440, 375]) {
      await check(
        `${theme}/${width}: 通讯录布局、详情、组织成员和部门布局`,
        page,
        async () => {
          await page.setViewportSize({ width, height: 900 });
          await coldRoute(page, phone, "/contacts/4");
          assert.equal(
            await page.locator("html").getAttribute("data-theme"),
            theme,
          );
          await capture(page, `${theme}-${width}-contacts-deeplink`);
          if (width === 375) {
            await check(
              `${theme}/375: 冷开联系人深链显示目标资料`,
              page,
              async () => {
                assert.ok(
                  await page
                    .locator(".contacts-profile")
                    .getByRole("heading", { name: "苏清", exact: true })
                    .isVisible(),
                  "URL 定位到联系人时资料不能隐藏在窄屏抽屉外",
                );
              },
            );
            await verifyMobileNavigation(page, phone, theme);
            if (
              await page
                .getByRole("button", { name: "返回通讯录", exact: true })
                .isVisible()
            )
              await page
                .getByRole("button", { name: "返回通讯录", exact: true })
                .click();
          }
          await page
            .getByPlaceholder("搜索姓名、职位或手机号")
            .fill("13800000004");
          await page
            .getByRole("region", { name: "企业通讯录", exact: true })
            .getByRole("button")
            .filter({ hasText: "苏清" })
            .click();
          await page
            .locator(".contacts-profile")
            .getByRole("heading", { name: "苏清", exact: true })
            .waitFor();
          await capture(page, `${theme}-${width}-contacts-selected`);
          if (width === 375) {
            await visibleButton(page, /发\s*消\s*息/).click();
            await page.getByRole("textbox", { name: "消息输入框" }).waitFor();
            await page.goBack();
            await teamNav(page).waitFor();
          }
          await teamNav(page)
            .getByRole("link", { name: "组织管理", exact: true })
            .click();
          await visibleButton(page, "添加成员").waitFor();
          await capture(page, `${theme}-${width}-organization-members`);
          await organizationNav(page)
            .getByRole("button", { name: "部门架构", exact: true })
            .click();
          await visibleButton(page, "新建部门").waitFor();
          await capture(page, `${theme}-${width}-organization-departments`);
          await active(page, "组织管理");
        },
      );
    }
  }
}

try {
  report.sourceBefore = fingerprints();
  console.log(`REPORT ${reportPath}`);
  await startServer();
  const modulePath = process.env.PLAYWRIGHT_MODULE || process.argv[2];
  assert.ok(modulePath, "请传入现有 playwright 模块路径；不会安装依赖");
  const { chromium } = createRequire(import.meta.url)(modulePath);
  browser = await chromium.launch({
    channel: process.argv[3] || "msedge",
    headless: true,
  });
  for (const [role, phone] of [
    ["owner", "13800000001"],
    ["admin", "13800000002"],
    ["member", "13800000003"],
  ])
    await check(`${role}: 登录与团队回归入口`, null, () =>
      verifyRole(role, phone),
    );
  await check("浏览器无未捕获异常和后端 5xx", null, async () => {
    assert.deepEqual(report.browserErrors, []);
    assert.deepEqual(report.serverErrors, []);
  });
} catch (error) {
  report.failures.push({
    name: "验收入口",
    error: error.stack || error.message,
  });
  console.error(error.stack || error.message);
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const closed = new Promise((resolve) => server.once("exit", resolve));
    server.kill(); // 仅停止本次脚本持有的子进程，不枚举或结束其他验收实例。
    await closed;
  }
  report.finishedAt = new Date().toISOString();
  report.sourceAfter = fingerprints();
  report.sourceChangedDuringRun =
    JSON.stringify(report.sourceBefore) !== JSON.stringify(report.sourceAfter);
  report.queryCounts = Object.fromEntries(
    [...new Set(report.requests.map((request) => request.phase))].map(
      (name) => [
        name,
        report.requests
          .filter(
            (request) =>
              request.phase === name &&
              ["/api/users", "/api/departments"].includes(request.path),
          )
          .reduce(
            (counts, request) => ({
              ...counts,
              [request.path]: (counts[request.path] || 0) + 1,
            }),
            {},
          ),
      ],
    ),
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(directory, "report.md"),
    [
      "# 导航归并独立回归",
      "",
      report.scope,
      "",
      `通过检查：${report.checks.length}；失败检查：${report.failures.length}；截图：${report.screenshots.length}。`,
      `运行中生产源码是否变化：${report.sourceChangedDuringRun}。`,
      "",
      ...report.failures.map(
        (failure) =>
          `- ${failure.name}: ${failure.error.split("\n")[0]}${failure.screenshot ? ` ([截图](${path.basename(failure.screenshot)}))` : ""}`,
      ),
      "",
      "## 截图",
      "",
      ...report.screenshots.map(
        (screenshot) =>
          `- [${path.basename(screenshot)}](${path.basename(screenshot)})`,
      ),
      "",
    ].join("\n"),
  );
  console.log(
    `RESULT passed=${report.checks.length} failed=${report.failures.length} screenshots=${report.screenshots.length} sourceChanged=${report.sourceChangedDuringRun}`,
  );
  console.log(`REPORT ${reportPath}`);
  process.exitCode =
    report.failures.length || report.sourceChangedDuringRun ? 1 : 0;
}
