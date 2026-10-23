// 独立浏览器验收：node apps/desktop/scripts/verify-content-pages.mjs <现有 playwright 模块路径> [预览地址]
// 只访问用户指定的隔离预览，截图保存在 os.tmpdir()，不创建数据库或修改生产数据。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const modulePath = process.argv[2];
if (!modulePath)
  throw new Error("请提供已安装的 playwright 模块路径，不自动安装依赖");
const baseUrl = process.argv[3] || "http://127.0.0.1:5175";
const menusOnly = process.argv.includes("--menus-only");
const { chromium } = createRequire(import.meta.url)(modulePath);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chat-page-layout-"));
const reportPath = path.join(directory, "content-pages-report.json");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
const errors = [];
const failures = [];
const changedFiles = {
  "apps/desktop/src/renderer/pages/Documents": [
    "index.tsx",
    "page.less",
    "components/ShareDocumentModal.tsx",
  ],
  "apps/desktop/src/renderer/pages/Contacts": [
    "index.tsx",
    "page.less",
    "components/ContactsList.tsx",
    "components/ContactDetail.tsx",
  ],
  "apps/desktop/src/renderer/pages/Organization": [
    "index.tsx",
    "page.less",
    "workspace-pages.test.tsx",
    "components/AdminMenu.tsx",
    "components/DepartmentGrid.tsx",
    "components/MemberTable.tsx",
    "components/MemberToolbar.tsx",
    "components/OrganizationModal.tsx",
  ],
  "apps/desktop/src/renderer/pages/Login": ["index.tsx", "style.module.less"],
  "apps/desktop/scripts": ["verify-content-pages.mjs"],
};

/** 使用正式主题菜单切换颜色，不绕过应用的主题设置逻辑。 */
async function setTheme(page, theme) {
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page
    .getByRole("menuitem", {
      name: theme === "dark" ? "深色模式" : "浅色模式",
      exact: true,
    })
    .click();
  await page.waitForFunction(
    (value) => document.documentElement.dataset.theme === value,
    theme,
  );
  await page.getByRole("menu").waitFor({ state: "hidden" });
}

/** 截图并核对页面和主体边界，允许表格在自己的滚动容器内展开。 */
async function capture(page, route, theme, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const screenshot = path.join(directory, `${route}-${theme}-${width}.png`);
  await page.screenshot({ path: screenshot, animations: "disabled" });
  const layout = await page.evaluate(() => {
    const main = document.querySelector(".workspace-main") || document.body;
    const rect = main.getBoundingClientRect();
    return {
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainLeft: rect.left,
      mainRight: rect.right,
    };
  });
  assert.ok(
    layout.scrollWidth <= width + 1,
    `${route}/${theme}/${width} 出现页面横向溢出`,
  );
  assert.ok(
    layout.mainLeft >= -1 && layout.mainRight <= width + 1,
    `${route} 主体超出视口`,
  );
  results.push({ route, theme, width, screenshot, ...layout });
}

/** 读取暗色交互区域的实际底色，排除旧主题遗留的大面积蓝色染色。 */
async function checkNeutralBackground(page, selector, label) {
  const target = page.locator(selector).first();
  await target.waitFor({ timeout: 5000 });
  await target.hover();
  const background = await target.evaluate((element) => {
    let current = element;
    while (current) {
      const value = getComputedStyle(current).backgroundColor;
      if (value !== "transparent" && value !== "rgba(0, 0, 0, 0)") return value;
      current = current.parentElement;
    }
    return "";
  });
  const channels = (background.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  assert.equal(channels.length, 3, `${label} 无法读取背景色`);
  assert.ok(
    Math.max(...channels) - Math.min(...channels) <= 30,
    `${label} 仍有明显彩色底：${background}`,
  );
  results.push({ theme: "dark", state: label, background, status: "neutral" });
}

/** 从真实文档菜单打开协作弹窗并检查实际内容，不提交或更改文档。 */
async function checkDocumentEntries(page, theme) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const menu = page.getByRole("button", { name: /^更多操作：/ }).last();
  for (const [entry, title, content] of [
    ["共享设置", "共享文档", "保存共享设置"],
    ["评论", /评论/, "发布评论"],
    ["版本历史", /版本/, "版本"],
    ["提交评审", /评审/, "通过后创建的任务"],
  ]) {
    await menu.click();
    const item = page.getByRole("menuitem", { name: entry, exact: true });
    await item.waitFor();
    await page.screenshot({
      path: path.join(directory, `menu-${entry}-${theme}.png`),
      animations: "disabled",
    });
    const bounds = await item.boundingBox();
    assert.ok(
      bounds &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= 1441 &&
        bounds.y + bounds.height <= 901,
      "文档业务菜单超出视口",
    );
    await page.getByRole("menuitem", { name: entry, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await dialog.getByText(content, { exact: false }).first().waitFor();
    assert.ok(
      (await dialog.innerText()).includes(content),
      `${entry} 未加载预期表单`,
    );
    assert.ok(
      (await dialog
        .getByText(title, { exact: typeof title === "string" })
        .count()) > 0,
      `${entry} 标题丢失`,
    );
    await page.screenshot({
      path: path.join(directory, `document-${entry}-${theme}.png`),
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    results.push({ entry, theme, status: "opened" });
  }
  const avatars = await page
    .locator(".ant-avatar-group .ant-avatar")
    .evaluateAll((items) =>
      items.map((item) => ({
        background: getComputedStyle(item).backgroundColor,
        color: getComputedStyle(item).color,
      })),
    );
  assert.ok(avatars.length > 0);
  assert.ok(avatars.every((avatar) => avatar.background !== avatar.color));
  results.push({ theme, avatars });
}

try {
  for (const theme of menusOnly ? ["light"] : ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: theme,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    for (const route of menusOnly
      ? ["documents"]
      : ["documents", "contacts", "organization"]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(
        `${baseUrl}/__workspace?phone=13800000001&route=/${route}`,
      );
      await page
        .getByRole("button", { name: "切换主题", exact: true })
        .waitFor();
      await setTheme(page, theme);
      if (theme === "dark") {
        const targets =
          route === "documents"
            ? [
                [".documents-view[aria-current]", "文档目录选中"],
                [".documents-create-card", "文档创建卡片 hover"],
                [".documents-search", "文档搜索输入背景"],
                [
                  ".documents-table .ant-table-tbody tr[data-row-key] td",
                  "文档表格 hover",
                ],
              ]
            : route === "contacts"
              ? [
                  [".contacts-member[aria-pressed=true]", "通讯录成员选中"],
                  [".contacts-member[aria-pressed=false]", "通讯录成员 hover"],
                  [
                    ".contacts-directory .ant-input-affix-wrapper",
                    "通讯录搜索输入背景",
                  ],
                ]
              : [
                  [".organization-menu-item[aria-current]", "组织目录选中"],
                  [".organization-member-search", "组织搜索输入背景"],
                  [
                    ".organization-member-filters .ant-select",
                    "组织筛选输入背景",
                  ],
                  [
                    ".organization-panel .ant-table-tbody tr[data-row-key] td",
                    "组织成员表格 hover",
                  ],
                ];
        for (const [selector, label] of targets)
          await checkNeutralBackground(page, selector, label);
      }
      for (const width of menusOnly ? [375] : [1440, 768, 375])
        await capture(page, route, theme, width);
      if (route === "documents") await checkDocumentEntries(page, theme);
      if (route === "contacts") {
        await page.locator(".contacts-member").first().click();
        await page
          .getByRole("heading", { name: "成员资料", exact: true })
          .waitFor();
        await capture(page, "contact-detail", theme, 375);
        await page
          .getByRole("button", { name: "返回通讯录", exact: true })
          .click();
        await page.locator(".contacts-detail").waitFor({ state: "hidden" });
      }
      if (route === "organization") {
        await page.setViewportSize({ width: 375, height: 900 });
        await page
          .getByRole("button", { name: "添加成员", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("姓名", { exact: true }).waitFor();
        await dialog
          .getByRole("button", { name: /取\s*消/ })
          .click({ trial: true });
        await page.screenshot({
          path: path.join(directory, `organization-member-${theme}-375.png`),
          animations: "disabled",
        });
        await dialog.getByRole("button", { name: /取\s*消/ }).click();
        await dialog.waitFor({ state: "hidden" });
        await page
          .locator(".organization-mobile-nav")
          .getByRole("button", { name: "部门架构", exact: true })
          .click();
        await page
          .getByRole("button", { name: "新建部门", exact: true })
          .click();
        await dialog.getByLabel("部门名称", { exact: true }).waitFor();
        await dialog
          .getByRole("button", { name: /取\s*消/ })
          .click({ trial: true });
        await page.screenshot({
          path: path.join(
            directory,
            `organization-department-${theme}-375.png`,
          ),
          animations: "disabled",
        });
        await dialog.getByRole("button", { name: /取\s*消/ }).click();
        await dialog.waitFor({ state: "hidden" });
        for (const width of [1440, 768, 375])
          await capture(page, "organization-departments", theme, width);
        results.push({
          route,
          theme,
          status: "member-and-department-dialogs-opened",
        });
      }
    }
    await context.close();
    if (menusOnly) continue;
    const loginContext = await browser.newContext({ colorScheme: theme });
    const loginPage = await loginContext.newPage();
    await loginPage.goto(`${baseUrl}/__workspace`);
    await loginPage
      .getByRole("button", { name: "登录企业空间", exact: true })
      .waitFor();
    if (theme === "dark") {
      for (const [selector, label] of [
        [".ant-tabs-tab-active", "登录方式选中"],
        ['input[name="phone"]', "登录手机号输入背景"],
        [".ant-input-affix-wrapper", "登录密码输入背景"],
      ])
        await checkNeutralBackground(loginPage, selector, label);
    }
    for (const width of [1440, 768, 375])
      await capture(loginPage, "login", theme, width);
    await loginContext.close();
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${results.length} 项内容页检查`);
} catch (error) {
  failures.push({ message: error.message, stack: error.stack });
  process.exitCode = 1;
  console.error(error.stack);
} finally {
  await browser.close();
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        baseUrl,
        changedFiles,
        directory,
        checks: results.length,
        command: `node apps/desktop/scripts/verify-content-pages.mjs ${modulePath} ${baseUrl}`,
        results,
        errors,
        failures,
        screenshots: fs
          .readdirSync(directory)
          .filter((name) => name.endsWith(".png"))
          .map((name) => path.join(directory, name)),
        reproducedFixes: [
          "组织页 375px 下隐藏桌面目录后仍可切换成员与部门模式",
          "文档协作者头像在亮暗主题使用 primary-soft 背景与 primary 文字",
          "减弱动画模式下文档业务菜单不再因坐标过渡定位到视口外",
        ],
        notCovered: [
          "Electron 文档原生窗口与 preload",
          "Hocuspocus 多人协作（当前预览禁用）",
          "原生文件选择、导入与下载",
          "实际服务器写入的共享、评论、审批与版本恢复；审批和版本提交有前端交互回归，但非完整服务端验收",
        ],
      },
      null,
      2,
    ),
  );
  console.log(`REPORT ${reportPath}`);
  console.log(`SCREENSHOTS ${directory}`);
}
