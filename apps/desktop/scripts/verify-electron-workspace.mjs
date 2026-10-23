// node apps/desktop/scripts/verify-electron-workspace.mjs --apiurl=http://127.0.0.1:<隔离API端口> [--playwrightmodule=<目录>] [--rendererurl=<地址>] [--build-main] [--require-collaboration]
// --os-clipboard-restricted 仅用于已被独立 OS 探针证实剪贴板不可用的环境，端到端复制会明确记为未覆盖。
// 只连接现有服务；不重建原生 ABI，不读取原 userData，不删除证据或关闭其他 Electron。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const desktopRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const require = createRequire(import.meta.url);

/** 读取命名参数，同时接受等号形式和独立参数值。 */
function option(names, fallback) {
  for (const [index, arg] of process.argv.entries()) {
    for (const name of names) {
      if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
      if (arg === `--${name}`) {
        assert.ok(
          process.argv[index + 1] && !process.argv[index + 1].startsWith("--"),
          `${arg} 缺少值`,
        );
        return process.argv[index + 1];
      }
    }
  }
  return fallback;
}

const playwrightModule = option(
  ["playwrightmodule", "playwright-module"],
  process.env.CHAT_PLAYWRIGHT_MODULE || "playwright",
);
const apiArgument = option(["apiurl", "api-url"]);
assert.ok(
  apiArgument,
  "必须显式提供 --apiurl=http://127.0.0.1:<隔离API端口>，避免误写开发数据库",
);
const apiUrl = apiArgument.replace(/\/+$/, "");
const clipboardRestricted = process.argv.includes("--os-clipboard-restricted");
const rendererUrl = option(
  ["rendererurl", "renderer-url"],
  "http://127.0.0.1:15173",
).replace(/\/+$/, "");
for (const address of [apiUrl, rendererUrl]) {
  const parsed = new URL(address);
  assert.equal(
    parsed.hostname,
    "127.0.0.1",
    "本脚本只向显式隔离的 loopback 服务写入测试数据",
  );
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chat-native-ui-"));
const reportPath = path.join(directory, "electron-verification.json");
const marker = `原生独立回归-${path.basename(directory)}`;
const report = {
  startedAt: new Date().toISOString(),
  directory,
  apiUrl,
  rendererUrl,
  scope:
    "真实 Electron + 正式 main/preload/renderer + 现有隔离 Egg/SQLite；没有假 window.desktop",
  checks: [],
  failures: [],
  notCovered: [],
  screenshots: [],
  layouts: [],
  colors: [],
  pageErrors: [],
  consoleErrors: [],
  networkFailures: [],
  shutdowns: [],
  externalBoundary:
    "仅替换 shell.openExternal 的 OS 调用边界；调用方和 IPC handler 均为生产路径；不验证 OS 浏览器实际启动",
  limitations: [
    "双用户/多人同时编辑未覆盖；仅验证单人真实 Hocuspocus 编辑、数据库版本存储和窗口重开",
  ],
};
const observed = new WeakSet();
let electronApp;
let page;
let conversation;
let accessToken;
let plainMessage;
let linkMessage;
let historyPage;
let documentPage;
let documentFixture;
let playwright;
let closing = false;
let concurrentExpected;

/** 延迟轮询，避免忙等；不做固定长时间睡眠。 */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** 为可能挂起的 Electron 操作设置上限并清除定时器。 */
async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} 超时 (${milliseconds}ms)`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** 轮询真实状态直到断言成立，保留最后一次失败信息。 */
async function eventually(action, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    try {
      return await action();
    } catch (error) {
      last = error;
    }
    await delay(150);
  } while (Date.now() < deadline);
  throw last;
}

/** 只保留本次临时目录中的报告，不输出令牌或认证请求头。 */
function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.length;
  report.status = report.failures.length
    ? "failed"
    : report.notCovered.length
      ? "partial"
      : "passed";
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

/** 截图直接来自真实渲染窗口，不注入样式或替换 UI。 */
async function screenshot(target, name) {
  const filename = path.join(directory, `${name}.png`);
  await target.screenshot({
    path: filename,
    animations: "disabled",
    timeout: 5000,
  });
  report.screenshots.push(filename);
  return filename;
}

/** 逐项记录结果；失败立即输出具体步骤，继续收集独立场景而不修生产代码。 */
async function check(name, action) {
  console.log(`START ${name}`);
  const started = Date.now();
  try {
    const evidence = await action();
    report.checks.push({ name, milliseconds: Date.now() - started, evidence });
    console.log(`PASS ${name}`);
    return evidence;
  } catch (error) {
    report.failures.push({ name, error: error.stack || String(error) });
    console.error(`FAIL ${name}: ${error.message}`);
    for (const [index, target] of (electronApp?.windows() || []).entries()) {
      if (target.isClosed()) continue;
      await screenshot(
        target,
        `failure-${report.failures.length}-${index}`,
      ).catch(() => undefined);
    }
  } finally {
    writeReport();
  }
}

/** 记录未捕获异常和服务端错误；协作连接错误也保留，不假装多人协作成功。 */
function observe(target) {
  if (observed.has(target)) return;
  observed.add(target);
  target.setDefaultTimeout(12_000);
  target.on("pageerror", (error) =>
    report.pageErrors.push({ url: target.url(), message: error.message }),
  );
  target.on("console", (message) => {
    if (message.type() === "error")
      report.consoleErrors.push({ url: target.url(), message: message.text() });
  });
  target.on("response", (response) => {
    if (response.url().includes("/api/") && response.status() >= 500)
      report.networkFailures.push({
        url: response.url(),
        status: response.status(),
      });
  });
}

/** 仅在缺少构建产物或显式要求时构建正式 main，不重建 better-sqlite3。 */
async function prepare() {
  for (const [label, url] of [
    ["API", `${apiUrl}/api/health`],
    ["Vite", rendererUrl],
  ]) {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    assert.ok(response.ok, `${label} 不可用：${response.status}`);
  }
  if (
    process.argv.includes("--build-main") ||
    !fs.existsSync(path.join(desktopRoot, ".electron/main.cjs"))
  ) {
    const build = spawn(process.execPath, ["scripts/build-main.mjs"], {
      cwd: desktopRoot,
      env: { ...process.env, DESKTOP_DEFAULT_SERVER_URL: apiUrl },
      stdio: "inherit",
    });
    const code = await bounded(
      new Promise((resolve, reject) => {
        build.once("error", reject);
        build.once("exit", resolve);
      }),
      60_000,
      "构建正式 main",
    );
    assert.equal(code, 0);
  }
  playwright = require(playwrightModule);
}

/** 启动本脚本专属实例；入口在加载正式 main 前设置隔离 userData。 */
async function launch() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  electronApp = await playwright._electron.launch({
    executablePath: path.join(
      repoRoot,
      "node_modules/electron/dist/electron.exe",
    ),
    args: [
      path.join(desktopRoot, "scripts/electron-verification-entry.cjs"),
      `--test-data=${directory}`,
      `--test-renderer=${rendererUrl}`,
    ],
    env,
    colorScheme: null,
    timeout: 30_000,
  });
  electronApp.on("window", observe);
  page = await electronApp.firstWindow();
  observe(page);
  await page.waitForFunction(() => Boolean(window.desktop?.preferences));
  assert.equal(
    await electronApp.evaluate(({ app }) => app.getPath("userData")),
    directory,
  );
  return { pid: electronApp.process().pid, userData: directory };
}

/** 只退出自己启动的主进程，超时后只 kill 保存的 ChildProcess，不调用 taskkill。 */
async function shutdown() {
  if (!electronApp || closing) return;
  closing = true;
  const ownedApp = electronApp;
  const child = ownedApp.process();
  const result = {
    pid: child.pid,
    method: "app.exit(0)",
    gracefulExitVerified: false,
    forced: false,
  };
  const exited = new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", resolve);
  });
  try {
    await bounded(
      ownedApp.evaluate(({ app }) => {
        setTimeout(() => app.exit(0), 0);
        return true;
      }),
      2000,
      "app.exit 请求",
    ).catch(() => undefined);
    try {
      await bounded(exited, 6000, "自有 Electron 退出");
    } catch {
      if (child.exitCode === null && child.signalCode === null) {
        result.forced = true;
        result.method = "owned ChildProcess.kill(SIGKILL)";
        child.kill("SIGKILL");
        await bounded(exited, 4000, "自有 Electron 强制退出");
      }
    }
    result.exitCode = child.exitCode;
    result.signal = child.signalCode;
    await bounded(ownedApp.close(), 2000, "Playwright 连接释放").catch(
      () => undefined,
    );
  } finally {
    report.shutdowns.push(result);
    electronApp = undefined;
    closing = false;
  }
}

/** 等待真实 UI 发出的请求成功，不用 API fixture 代替界面操作。 */
async function perform(method, pathname, action) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === method &&
        new URL(response.url()).pathname === pathname,
    ),
    Promise.resolve().then(action),
  ]);
  assert.equal(response.status(), 200, `${method} ${pathname}`);
  const body = await response.json();
  assert.equal(body.success, true);
  return body.data;
}

/** 通过手机号和密码表单完成登录，访问令牌仅保留在内存。 */
async function signIn() {
  await eventually(async () => {
    assert.ok(
      (await page
        .getByRole("link", { name: "消息", exact: true })
        .isVisible()) ||
        (await page.getByRole("button", { name: "登录企业空间" }).isVisible()),
    );
  });
  if (
    !(await page.getByRole("link", { name: "消息", exact: true }).isVisible())
  ) {
    await page
      .getByRole("textbox", { name: "手机号", exact: true })
      .fill("13800000001");
    await page.locator('input[name="password"]').fill("123456");
    const auth = await perform("POST", "/api/auth/login", () =>
      page.getByRole("button", { name: "登录企业空间" }).click(),
    );
    accessToken = auth.accessToken;
  }
  await page.getByRole("link", { name: "消息", exact: true }).waitFor();
}

/** 通过正式导航链接进入页面。 */
async function navigate(name) {
  await page.getByRole("link", { name, exact: true }).click();
  await page.locator(".workspace-main").waitFor();
}

/** 从真实 Ant Design portal 选择选项，不使用内部状态或 portal workaround。 */
async function choose(label, text) {
  const input = page.getByRole("combobox", { name: label, exact: true });
  await input.click();
  const controls = await input.getAttribute("aria-controls");
  assert.ok(controls);
  await page
    .locator(".ant-select-dropdown")
    .filter({ has: page.locator(`[id="${controls}"]`) })
    .getByText(text, { exact: true })
    .click();
}

/** 读取真实数据库 IPC，同步和 outbox 都由正式 utilityProcess 处理。 */
async function database(method, args) {
  return page.evaluate(
    ({ method, args }) => window.desktop.im.call(method, args),
    { method, args },
  );
}

/** 回到选定真实会话，确保输入框可见。 */
async function openConversation() {
  await navigate("消息");
  await page
    .getByRole("button")
    .filter({ has: page.getByText(conversation.name, { exact: true }) })
    .first()
    .click();
  await page.getByRole("textbox", { name: "消息输入框" }).waitFor();
}

/** 从发送框发消息，等待本地正 ID、sent、outbox 清空以及真实服务端回执。 */
async function send(text) {
  await page.getByRole("textbox", { name: "消息输入框" }).fill(text);
  await page.getByRole("button", { name: /^发\s*送$/ }).click();
  const message = await eventually(async () => {
    const messages = await database("getMessages", {
      conversationId: conversation.id,
      limit: 100,
    });
    const found = messages.items.find((item) =>
      item.parts.some((part) => part.type === "text" && part.text === text),
    );
    assert.ok(found?.id > 0, "消息尚未获得服务端正 ID");
    assert.equal(found.status, "sent");
    assert.equal(
      messages.items.filter((item) => item.status === "failed").length,
      0,
    );
    assert.deepEqual(await database("getOutbox"), []);
    return found;
  });
  const server = await api(`/api/conversations/${conversation.id}/messages`);
  assert.ok(
    server.items.some(
      (item) => item.id === message.id && item.clientId === message.clientId,
    ),
    "API 必须存在同一个服务端消息",
  );
  await page.locator(`#message-${message.id}`).waitFor();
  return message;
}

/** 在隔离 API 上准备辅助测试数据，不把 API 写入冒充 UI 覆盖。 */
async function api(pathname, method = "GET", body) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method,
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(response.status, 200, `${method} ${pathname}`);
  const result = await response.json();
  assert.equal(result.success, true);
  return result.data;
}

/** 用真实 quick menu 切主题，同时断言真实 IPC 与根节点状态。 */
async function theme(mode, targets = []) {
  const labels = { light: "浅色模式", dark: "深色模式", system: "跟随系统" };
  await page.evaluate((mode) => {
    const observation = { done: false, remove: () => {} };
    observation.remove = window.desktop.preferences.onChanged((preferences) => {
      if (preferences.appearance.theme === mode) observation.done = true;
    });
    window.__nativeVerificationThemeChanged = observation;
  }, mode);
  try {
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    await page
      .getByRole("menuitem", { name: labels[mode], exact: true })
      .click();
    await page.waitForFunction(
      () => window.__nativeVerificationThemeChanged.done,
    );
  } finally {
    await page.evaluate(() => {
      window.__nativeVerificationThemeChanged?.remove();
      delete window.__nativeVerificationThemeChanged;
    });
  }
  await eventually(async () =>
    assert.equal(
      (await page.evaluate(() => window.desktop.preferences.get())).appearance
        .theme,
      mode,
    ),
  );
  const native = await electronApp.evaluate(({ nativeTheme }) => ({
    source: nativeTheme.themeSource,
    dark: nativeTheme.shouldUseDarkColors,
  }));
  const resolved = mode === "system" ? (native.dark ? "dark" : "light") : mode;
  for (const target of [page, ...targets]) {
    await target.waitForFunction(
      (value) => document.documentElement.dataset.theme === value,
      resolved,
    );
  }
  if (mode === "system") {
    assert.equal(native.source, "system");
    assert.equal(
      await page.evaluate(
        () => matchMedia("(prefers-color-scheme: dark)").matches,
      ),
      native.dark,
    );
    report.systemTheme = { native, renderer: resolved, mediaEmulation: false };
  }
  return resolved;
}

/** 将计算颜色转为通道，并拒绝中性背景出现明显蓝色偏色。 */
function neutral(color, label) {
  const channels = color.match(/[\d.]+/g)?.map(Number) || [];
  if (channels.length < 3 || channels[3] === 0) return;
  const [red, green, blue] = channels;
  assert.ok(blue - Math.min(red, green) <= 18, `${label} 背景偏蓝：${color}`);
}

/** 合成元素与祖先的半透明背景，按实际显示色检查，不误判未合成的 RGB 通道。 */
async function renderedBackground(target) {
  return target.evaluate((element) => {
    const result = [0, 0, 0];
    let alpha = 0;
    for (
      let current = element;
      current && alpha < 0.999;
      current = current.parentElement
    ) {
      const color = getComputedStyle(current)
        .backgroundColor.match(/[\d.]+/g)
        ?.map(Number);
      if (!color || color.length < 3) continue;
      const opacity = color[3] ?? 1;
      for (let channel = 0; channel < 3; channel += 1)
        result[channel] += color[channel] * opacity * (1 - alpha);
      alpha += opacity * (1 - alpha);
    }
    return `rgb(${result.map((value) => Math.round(value + 255 * (1 - alpha))).join(", ")})`;
  });
}

/** 计算正文与按钮文字的实际亮度对比，防止暗色静态模态出现黑字。 */
function contrast(foreground, background) {
  const front = foreground.match(/[\d.]+/g).map(Number);
  const back = background.match(/[\d.]+/g).map(Number);
  const alpha = front[3] ?? 1;
  const colors = [
    front
      .slice(0, 3)
      .map((value, index) => value * alpha + back[index] * (1 - alpha)),
    back.slice(0, 3),
  ];
  const luminances = colors.map((color) =>
    color
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      })
      .reduce(
        (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
        0,
      ),
  );
  return (Math.max(...luminances) + 0.05) / (Math.min(...luminances) + 0.05);
}

/** 收集全部可见输入框和常见选中态背景，排除允许保留蓝色的主按钮。 */
async function neutralStates(target, label) {
  const states = await target
    .locator(
      'input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"], .ant-input-affix-wrapper, .ant-select, .ant-select-selector, .ant-select-item-option-selected, .ant-segmented-item-selected, .ant-radio-button-wrapper-checked, .ant-table-row-selected > td, .workspace-nav-item.is-active, [aria-current="page"], .ant-dropdown-menu-item-selected',
    )
    .evaluateAll((elements) =>
      elements
        .filter(
          (element) =>
            element.getBoundingClientRect().width > 2 &&
            getComputedStyle(element).visibility !== "hidden",
        )
        .map((element) => ({
          element: `${element.tagName}.${element.className}`,
          background: getComputedStyle(element).backgroundColor,
        })),
    );
  for (const state of states)
    neutral(state.background, `${label}/${state.element}`);
  report.colors.push({ label, states });
}

/** 悬停真实输入、选中导航、表格和分段控件，检查实际背景而不是只检查 CSS 变量。 */
async function hoverStates(label) {
  for (const selector of [
    ".ant-input-affix-wrapper",
    ".ant-select",
    ".ant-segmented-item-selected",
    ".workspace-nav-item.is-active",
    '[aria-current="page"]',
    ".ant-table-tbody > tr:first-child > td",
  ]) {
    const target = page.locator(selector).first();
    if (!(await target.isVisible())) continue;
    await target.hover();
    const color = await target.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    neutral(color, `${label}/${selector}/hover`);
    report.colors.push({ label, hover: selector, background: color });
  }
  await page.mouse.move(0, 0);
}

/** 使用实际 BrowserWindow 尺寸并检查关键按钮完整可见且中心未被遮挡。 */
async function layout(name, controls, width) {
  const handle = await electronApp.browserWindow(page);
  await handle.evaluate((window, width) => {
    window.setSize(width, 900);
  }, width);
  const actual = await handle.evaluate((window) => window.getSize());
  await handle.dispose();
  assert.equal(actual[0], width, "必须改变真实窗口，不能只模拟 viewport");
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const measurements = [];
  for (const locator of controls) {
    await locator.waitFor();
    const measured = await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      let left = 0,
        top = 0,
        right = innerWidth,
        bottom = innerHeight;
      for (
        let ancestor = element.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        const style = getComputedStyle(ancestor),
          box = ancestor.getBoundingClientRect();
        if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
          left = Math.max(left, box.left);
          right = Math.min(right, box.right);
        }
        if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
          top = Math.max(top, box.top);
          bottom = Math.min(bottom, box.bottom);
        }
      }
      const hit = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
      return {
        name: element.getAttribute("aria-label") || element.textContent?.trim(),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= left - 1 &&
          rect.right <= right + 1 &&
          rect.top >= top - 1 &&
          rect.bottom <= bottom + 1,
        hit: hit === element || element.contains(hit),
      };
    });
    measurements.push(measured);
  }
  report.layouts.push({ name, width, actualWindow: actual, measurements });
  await screenshot(page, `${name}-${width}`);
  for (const measured of measurements)
    assert.ok(
      measured.visible && measured.hit,
      `${name}/${width} 关键操作裁切或遮挡：${JSON.stringify(measured)}`,
    );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
    "根页面横向溢出",
  );
}

/** 验证任务完整 CRUD 和状态推进；只删除本轮通过 UI 创建的任务。 */
async function tasks() {
  await navigate("任务");
  const title = `${marker}-任务`;
  await page
    .getByRole("textbox", { name: "任务标题", exact: true })
    .fill(title);
  await choose("任务优先级", "优先级：高");
  const created = await perform("POST", "/api/tasks", () =>
    page.getByRole("button", { name: "新增任务", exact: true }).click(),
  );
  assert.equal(created.title, title);
  assert.equal(created.priority, "high");
  let card = page
    .getByRole("article")
    .filter({ has: page.getByText(title, { exact: true }) });
  await card.getByRole("button", { name: "编辑任务", exact: true }).click();
  await page.getByRole("dialog").locator("textarea").fill(`${title}-已编辑`);
  await choose("编辑任务优先级", "优先级：紧急");
  const edited = await perform("PATCH", `/api/tasks/${created.id}`, () =>
    page
      .getByRole("dialog")
      .getByRole("button", { name: /^保\s*存$/ })
      .click(),
  );
  assert.equal(edited.title, `${title}-已编辑`);
  assert.equal(edited.priority, "urgent");
  card = page
    .getByRole("article")
    .filter({ has: page.getByText(edited.title, { exact: true }) });
  for (const [button, status] of [
    ["推进任务", "in_progress"],
    ["推进任务", "done"],
    ["重新打开任务", "todo"],
  ]) {
    const updated = await perform("PATCH", `/api/tasks/${created.id}`, () =>
      card.getByRole("button", { name: button, exact: true }).click(),
    );
    assert.equal(updated.status, status);
  }
  await card.getByRole("button", { name: "删除任务", exact: true }).click();
  await perform("DELETE", `/api/tasks/${created.id}`, () =>
    page
      .locator(".ant-popover")
      .getByRole("button", { name: /^删\s*除$/ })
      .click(),
  );
  await card.waitFor({ state: "hidden" });
  return { id: created.id, removedOnlyOwnFixture: true };
}

/** 以保留真实实现的旁路追踪确认复制实际走 native 还是 navigator，并始终恢复原方法。 */
async function traceClipboard(action, expectedText) {
  await electronApp.evaluate(({ clipboard, BrowserWindow }, expectedText) => {
    const trace = { original: clipboard.writeText, calls: [], expectedText };
    globalThis.__nativeVerificationClipboard = trace;
    clipboard.writeText = function (text, ...args) {
      const result = trace.original.call(clipboard, text, ...args);
      const readBack = clipboard.readText();
      trace.calls.push({
        length: String(text).length,
        argumentMatchesFixture: text === trace.expectedText,
        readBackMatches: readBack === text,
        readBackLength: readBack.length,
        readBackEmpty: readBack === "",
        formats: clipboard.availableFormats(),
        focusedWindowId: BrowserWindow.getFocusedWindow()?.id || null,
      });
      return result;
    };
  }, expectedText);
  await page.evaluate(() => {
    const trace = { original: navigator.clipboard.writeText, calls: 0 };
    window.__nativeVerificationNavigator = trace;
    navigator.clipboard.writeText = function (...args) {
      trace.calls += 1;
      return trace.original.apply(this, args);
    };
  });
  try {
    return await action();
  } finally {
    report.clipboardPath = await electronApp.evaluate(({ clipboard }) => {
      const trace = globalThis.__nativeVerificationClipboard;
      clipboard.writeText = trace.original;
      delete globalThis.__nativeVerificationClipboard;
      return {
        nativeCalls: trace.calls,
        nativeOriginalRestored: clipboard.writeText === trace.original,
      };
    });
    report.clipboardPath.renderer = await page.evaluate(() => {
      const trace = window.__nativeVerificationNavigator;
      navigator.clipboard.writeText = trace.original;
      delete window.__nativeVerificationNavigator;
      return {
        navigatorCalls: trace.calls,
        focused: document.hasFocus(),
        secureContext: isSecureContext,
        navigatorOriginalRestored:
          navigator.clipboard.writeText === trace.original,
      };
    });
  }
}

/** 同时提交二十个真实 IPC 更新，检查跨设置类别字段不丢失，留待重启后再核对。 */
async function concurrentSettings() {
  const before = await page.evaluate(() => window.desktop.preferences.get());
  const screenshotBefore = await page.evaluate(() =>
    window.desktop.screenshot.getPreferences(),
  );
  await page.evaluate(async () => {
    const calls = Array.from({ length: 20 }, (_, index) => {
      const round = Math.floor(index / 4);
      if (index % 4 === 0)
        return window.desktop.preferences.update({
          appearance: { theme: round % 2 ? "light" : "dark" },
        });
      if (index % 4 === 1)
        return window.desktop.preferences.update({
          appearance: { reducedMotion: round % 2 === 0 },
        });
      if (index % 4 === 2)
        return window.desktop.preferences.update({
          chat: { fontSize: round % 2 ? 13 : 16 },
        });
      return window.desktop.screenshot.setPreferences({
        hideMainWindow: round % 2 === 0,
      });
    });
    await Promise.all(calls);
  });
  const preferences = await page.evaluate(() =>
    window.desktop.preferences.get(),
  );
  const screenshotPreferences = await page.evaluate(() =>
    window.desktop.screenshot.getPreferences(),
  );
  assert.equal(preferences.appearance.theme, "dark");
  assert.equal(preferences.appearance.reducedMotion, true);
  assert.equal(preferences.chat.fontSize, 16);
  assert.equal(screenshotPreferences.hideMainWindow, true);
  assert.equal(preferences.appearance.zoom, before.appearance.zoom);
  assert.deepEqual(preferences.general, before.general);
  assert.equal(preferences.chat.sendKey, before.chat.sendKey);
  assert.equal(preferences.chat.density, before.chat.density);
  const disk = JSON.parse(
    fs.readFileSync(path.join(directory, "settings.json"), "utf8"),
  );
  assert.equal(disk.preferences.device.appearance.reducedMotion, true);
  assert.equal(disk.screenshot.hideMainWindow, true);
  assert.equal(disk.server, undefined);
  concurrentExpected = {
    preferences,
    hideMainWindow: screenshotPreferences.hideMainWindow,
  };
  return {
    concurrentIpcWrites: 20,
    preferences,
    screenshotPreferences,
    unchangedShortcutAvailability:
      screenshotBefore.shortcutAvailable ===
      screenshotPreferences.shortcutAvailable,
    fieldsRetained: true,
  };
}

/** 在原生文档窗口验证正式上下文和界面；正文未同步必须单列未覆盖。 */
async function inspectDocument(target, id, title) {
  await target.locator(".documentWindow").waitFor();
  const context = await target.evaluate(async () => {
    const value = await window.documentDesktop.context.get();
    return {
      documentId: value.documentId,
      serverUrl: value.serverUrl,
      authenticated: Boolean(value.accessToken),
    };
  });
  assert.equal(context.documentId, id);
  assert.equal(context.serverUrl, apiUrl);
  assert.equal(context.authenticated, true);
  await target.locator(".documentTitleInput").waitFor();
  assert.equal(await target.locator(".documentTitleInput").inputValue(), title);
  await target.locator(".cloudEditor").waitFor();
  const config = await api(`/api/documents/${id}`);
  const content = await eventually(async () => {
    const value = await target.locator(".cloudEditor").innerText();
    const cells = await target
      .locator(".cloudEditor td, .cloudEditor th")
      .count();
    assert.ok(value.trim() || cells, "正文和表格均未同步");
    return { text: value, cells };
  }, 3000).catch(() => null);
  if (!content) {
    const reason = {
      name: `文档 ${id} 正文展示/编辑/保存`,
      reason:
        "真实窗口已打开且认证成功，但协作连接未同步，正文为空；不把加载壳当成内容展示通过",
      collaborationUrl: config.collaborationUrl,
      status: await target.locator(".documentSyncStatus").innerText(),
    };
    report.notCovered.push(reason);
    console.log(`NOT_COVERED ${JSON.stringify(reason)}`);
  }
  await screenshot(target, `native-document-${id}`);
  return {
    ...context,
    titleDisplayed: true,
    contentDisplayed: Boolean(content),
    collaborationUrl: config.collaborationUrl,
  };
}

/** 真实键盘修改文档或单元格，轮询服务器持久化版本，再走关闭协议并从列表重开确认。 */
async function editAndReopen(target, created) {
  await target
    .locator(".documentSyncStatus")
    .filter({ hasText: "已保存到云端" })
    .waitFor({ timeout: 20_000 });
  const text = `${marker}-${created.type}-保存重开`;
  if (created.type === "sheet") {
    const cell = target.locator(".cloudEditor tr").nth(1).locator("td").first();
    await cell.click();
    await target.keyboard.insertText(text);
    await eventually(async () =>
      assert.ok((await cell.innerText()).includes(text)),
    );
  } else {
    await target.locator(".cloudEditor").click();
    await target.keyboard.press("Control+End");
    await target.keyboard.press("Enter");
    await target.keyboard.insertText(text);
    await eventually(async () =>
      assert.ok(
        (await target.locator(".cloudEditor").innerText()).includes(text),
      ),
    );
  }
  const saved = await eventually(async () => {
    const versions = await api(`/api/documents/${created.id}/versions`);
    assert.ok(versions.length, "尚无真实数据库持久化版本");
    const preview = await api(
      `/api/documents/${created.id}/versions/${versions[0].id}`,
    );
    assert.ok(preview.text.includes(text), "数据库版本尚未保存本次键盘修改");
    return { id: preview.id, textPersisted: true };
  });
  await screenshot(target, `native-${created.type}-${created.id}-edited`);
  const closed = target.waitForEvent("close", { timeout: 5000 });
  const handle = await electronApp.browserWindow(target);
  await handle.evaluate((window) => window.close());
  await closed;
  await handle.dispose();
  await navigate("文档");
  const [reopened] = await Promise.all([
    electronApp.waitForEvent("window", { timeout: 12_000 }),
    page
      .locator(
        `.ant-table-row[data-row-key="${created.id}"] .documents-file-button`,
      )
      .click(),
  ]);
  await reopened
    .locator(".documentSyncStatus")
    .filter({ hasText: "已保存到云端" })
    .waitFor({ timeout: 20_000 });
  await eventually(async () =>
    assert.ok(
      (await reopened.locator(".cloudEditor").innerText()).includes(text),
    ),
  );
  if (created.type === "sheet")
    assert.ok(
      (
        await reopened
          .locator(".cloudEditor tr")
          .nth(1)
          .locator("td")
          .first()
          .innerText()
      ).includes(text),
    );
  await screenshot(reopened, `native-${created.type}-${created.id}-reopened`);
  return {
    id: created.id,
    type: created.type,
    keyboardEdited: true,
    databaseVersion: saved.id,
    reopenedContentMatches: true,
    mockProvider: false,
  };
}

/** 主回归链覆盖真实业务、窗口、持久化和最新中性主题。 */
async function verify() {
  await prepare();
  assert.equal(fs.existsSync(path.join(directory, "settings.json")), false);
  await check("新 userData 与默认服务器（settings 初始不存在）", async () => {
    const evidence = await launch();
    assert.equal(fs.existsSync(path.join(directory, "settings.json")), false);
    assert.equal(
      (await page.evaluate(() => window.desktop.server.get())).url,
      apiUrl,
      "默认服务器不匹配时请加 --build-main",
    );
    return evidence;
  });
  assert.ok(page, "Electron 启动失败，无法继续");
  await check("真 UI 登录、本地 SQLite 同步", async () => {
    await signIn();
    const conversations = await eventually(async () => {
      const list = await database("listConversations");
      assert.ok(list.length);
      return list;
    });
    conversation =
      conversations.find((item) => item.type === "direct") || conversations[0];
    await eventually(async () => {
      const status = await page.evaluate(() => window.desktop.sync.getStatus());
      assert.equal(status.phase, "idle");
      assert.equal(status.historyComplete, true);
    });
    const databases = fs
      .readdirSync(path.join(directory, "data"), { recursive: true })
      .filter((name) => String(name).endsWith("chat.db"));
    assert.ok(databases.length);
    for (const file of databases) {
      const descriptor = fs.openSync(path.join(directory, "data", file), "r");
      const header = Buffer.alloc(16);
      try {
        fs.readSync(descriptor, header, 0, 16, 0);
      } finally {
        fs.closeSync(descriptor);
      }
      assert.equal(header.toString(), "SQLite format 3\0");
    }
    await openConversation();
    return {
      conversationId: conversation.id,
      conversationCount: conversations.length,
      databases,
    };
  });
  await check(
    "发送纯文本/HTTP+HTTPS，正 ID、sent、无 failed、outbox 空",
    async () => {
      plainMessage = await send(`${marker}-纯文本`);
      linkMessage = await send(
        `${marker}-链接 ${apiUrl}/api/health https://example.com/?native=${path.basename(directory)}`,
      );
      return {
        ids: [plainMessage.id, linkMessage.id],
        outbox: await database("getOutbox"),
      };
    },
  );
  await check(
    "HTTP/HTTPS 真 UI 外链和 unsafe 真 IPC 拒绝（仅 OS 边界 spy）",
    async () => {
      assert.ok(linkMessage);
      await electronApp.evaluate(({ shell }) => {
        globalThis.__nativeVerificationExternal = {
          original: shell.openExternal,
          calls: [],
        };
        shell.openExternal = async (url) => {
          globalThis.__nativeVerificationExternal.calls.push(url);
        };
      });
      try {
        const urls = [
          `${apiUrl}/api/health`,
          `https://example.com/?native=${path.basename(directory)}`,
        ];
        for (const url of urls)
          await page
            .locator(`#message-${linkMessage.id}`)
            .getByRole("link", { name: url, exact: true })
            .click();
        await eventually(async () =>
          assert.deepEqual(
            await electronApp.evaluate(
              () => globalThis.__nativeVerificationExternal.calls,
            ),
            urls,
          ),
        );
        const unsafe = await page.evaluate(async () => {
          const result = [];
          for (const url of [
            "javascript:alert(1)",
            "file:///C:/Windows/win.ini",
            "data:text/html,test",
          ]) {
            try {
              await window.desktop.external.open(url);
              result.push({ url, rejected: false });
            } catch {
              result.push({ url, rejected: true });
            }
          }
          return result;
        });
        assert.ok(unsafe.every((item) => item.rejected));
        assert.deepEqual(
          await electronApp.evaluate(
            () => globalThis.__nativeVerificationExternal.calls,
          ),
          urls,
        );
        return { openedAtOsBoundary: urls, unsafe };
      } finally {
        await electronApp.evaluate(({ shell }) => {
          shell.openExternal = globalThis.__nativeVerificationExternal.original;
          delete globalThis.__nativeVerificationExternal;
        });
        report.externalSpyRestored = true;
      }
    },
  );
  await check(
    clipboardRestricted
      ? "复制UI参数到native边界（OS剪贴板受限）"
      : "复制UI参数到native边界",
    async () => {
      assert.ok(plainMessage);
      report.clipboardDiagnostics = await electronApp.evaluate(
        ({ clipboard }) => {
          const original = clipboard.readText();
          clipboard.writeText("native-clipboard-boundary-probe");
          const result = {
            mainProcessDirectWriteRead:
              clipboard.readText() === "native-clipboard-boundary-probe",
            formats: clipboard.availableFormats(),
            mocked: false,
          };
          clipboard.writeText(original);
          return result;
        },
      );
      const bubble = page.locator(
        `#message-${plainMessage.id} [data-message-content].ant-dropdown-trigger`,
      );
      const originalClipboard = await page.evaluate(() =>
        window.desktop.clipboard.readText(),
      );
      try {
        await traceClipboard(async () => {
          await page.bringToFront();
          await bubble.click({ button: "right" });
          await page
            .getByRole("menuitem", { name: "复制文本", exact: true })
            .click();
          await eventually(async () => {
            const count = await electronApp.evaluate(
              () => globalThis.__nativeVerificationClipboard.calls.length,
            );
            assert.equal(count, 1, "等待真实异步 IPC 到达后再还原旁路追踪");
          }, 2000);
        }, `${marker}-纯文本`);
        assert.equal(report.clipboardPath.nativeCalls.length, 1);
        assert.equal(
          report.clipboardPath.nativeCalls[0].argumentMatchesFixture,
          true,
          "传入真实 clipboard.writeText 的参数必须等于完整 fixture",
        );
        assert.equal(report.clipboardPath.renderer.navigatorCalls, 0);
        assert.equal(report.clipboardPath.nativeOriginalRestored, true);
        assert.equal(
          report.clipboardPath.renderer.navigatorOriginalRestored,
          true,
        );
        if (
          clipboardRestricted &&
          !report.clipboardDiagnostics.mainProcessDirectWriteRead
        ) {
          report.notCovered.push({
            name: "右键复制文本真实 OS 剪贴板",
            reason:
              "当前会话 OS 剪贴板不可用：独立 Windows Set/Get 探针失败且 Win32 OpenClipboard AccessDenied(5)，本轮真实 native 写后读也失败；此处只有参数边界断言通过，不是端到端通过",
          });
          report.limitations.push(
            "系统剪贴板读写/粘贴端到端未覆盖；独立 OS 探针与 Electron 原实现均读空，无内存 fallback，历史红报告保留",
          );
        } else {
          await check("右键复制文本真实 OS 剪贴板", async () => {
            await eventually(
              async () =>
                assert.equal(
                  await page.evaluate(() =>
                    window.desktop.clipboard.readText(),
                  ),
                  `${marker}-纯文本`,
                ),
              2000,
            );
          });
        }
        return report.clipboardPath;
      } finally {
        await page.evaluate(
          (text) => window.desktop.clipboard.writeText(text),
          originalClipboard,
        );
      }
    },
  );
  await check("右键回复引用发送、多选和取消", async () => {
    assert.ok(plainMessage);
    const bubble = page.locator(
      `#message-${plainMessage.id} [data-message-content].ant-dropdown-trigger`,
    );
    try {
      await bubble.click({ button: "right" });
      await page.getByRole("menuitem", { name: "回复", exact: true }).click();
      await page
        .getByRole("button", { name: "取消回复", exact: true })
        .waitFor();
      const reply = await send(`${marker}-回复`);
      assert.ok(
        reply.parts.some(
          (part) => part.type === "quote" && part.messageId === plainMessage.id,
        ),
        "引用必须实际写入消息 parts",
      );
      await bubble.click({ button: "right" });
      await page.getByRole("menuitem", { name: "多选", exact: true }).click();
      await page
        .getByRole("button", { name: "退出多选", exact: true })
        .waitFor();
      await page.locator(`#message-${reply.id}`).getByRole("checkbox").check();
      assert.equal(
        await page.getByRole("checkbox", { checked: true }).count(),
        2,
      );
      if (
        clipboardRestricted &&
        !report.clipboardDiagnostics?.mainProcessDirectWriteRead
      ) {
        await page.getByRole("button", { name: "复制", exact: true }).click();
        report.notCovered.push({
          name: "多选复制真实 OS 剪贴板",
          reason:
            "真实多选复制按钮已点击，但当前会话 OS 剪贴板经独立探针证实不可用；不能断言复制后粘贴内容，不记端到端 PASS",
        });
      } else
        await check("多选复制真实 OS 剪贴板", async () => {
          const before = await page.evaluate(() =>
            window.desktop.clipboard.readText(),
          );
          try {
            await page
              .getByRole("button", { name: "复制", exact: true })
              .click();
            await eventually(async () => {
              const copied = await page.evaluate(() =>
                window.desktop.clipboard.readText(),
              );
              assert.ok(
                copied.includes(`${marker}-纯文本`) &&
                  copied.includes(`${marker}-回复`),
              );
            }, 2000);
          } finally {
            await page.evaluate(
              (text) => window.desktop.clipboard.writeText(text),
              before,
            );
          }
        });
      await screenshot(page, "message-multiselect");
      await page.getByRole("button", { name: "退出多选", exact: true }).click();
      await page.getByRole("textbox", { name: "消息输入框" }).waitFor();
      assert.equal(await page.getByRole("checkbox").count(), 0);
      return {
        replyId: reply.id,
        quoteId: plainMessage.id,
        selectedMessages: 2,
        selectionCancelled: true,
      };
    } finally {
      if (
        await page
          .getByRole("button", { name: "退出多选", exact: true })
          .isVisible()
      )
        await page
          .getByRole("button", { name: "退出多选", exact: true })
          .click();
    }
  });
  await check("主题 quick menu、IPC 持久化和亮暗中性气泡", async () => {
    for (const [mode, expected] of [
      ["light", "rgb(238, 240, 244)"],
      ["dark", "rgb(48, 53, 59)"],
    ]) {
      await theme(mode);
      const color = await page
        .locator(
          `#message-${plainMessage.id} [data-message-content].ant-dropdown-trigger`,
        )
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      assert.equal(color, expected);
      if (mode === "dark") {
        const palette = await page.evaluate(() => {
          const style = getComputedStyle(document.documentElement);
          return Object.fromEntries(
            [
              "--app-canvas",
              "--app-surface",
              "--app-surface-soft",
              "--app-surface-muted",
              "--app-line",
              "--app-primary-soft",
            ].map((name) => [name, style.getPropertyValue(name).trim()]),
          );
        });
        for (const [name, value] of Object.entries({
          "--app-canvas": "#141619",
          "--app-surface": "#1c1f24",
          "--app-surface-soft": "#24282e",
          "--app-surface-muted": "#2e333b",
          "--app-line": "#353b43",
          "--app-primary-soft": "#2d323b",
        }))
          assert.equal(palette[name].toLowerCase(), value);
        report.colors.push({ mode, palette });
      }
      await neutralStates(page, `chat-${mode}`);
      await screenshot(page, `chat-${mode}`);
    }
    await theme("system");
    await theme("dark");
    const stored = JSON.parse(
      fs.readFileSync(path.join(directory, "settings.json"), "utf8"),
    );
    assert.equal(stored.preferences.device.appearance.theme, "dark");
    assert.equal(
      stored.server,
      undefined,
      "主题保存不能偷偷写入 server 来掩盖默认配置回归",
    );
    return {
      light: "#eef0f4",
      dark: "#30353b",
      storedTheme: "dark",
      serverStillAbsent: true,
    };
  });
  await check("历史辅助窗打开、搜索与主题跟随", async () => {
    await page
      .getByRole("button", { name: "打开聊天记录", exact: true })
      .click();
    historyPage = await eventually(async () => {
      for (const candidate of electronApp.windows()) {
        if (
          candidate !== page &&
          (await candidate.getByPlaceholder("搜索聊天记录").isVisible())
        )
          return candidate;
      }
      throw new Error("未找到真实历史辅助窗口");
    });
    await historyPage.getByPlaceholder("搜索聊天记录").fill(`${marker}-纯文本`);
    await historyPage
      .getByRole("article")
      .filter({ hasText: `${marker}-纯文本` })
      .first()
      .waitFor();
    await theme("light", [historyPage]);
    await theme("dark", [historyPage]);
    await screenshot(historyPage, "native-history-dark-search");
    return { url: historyPage.url(), searched: `${marker}-纯文本` };
  });
  await check(
    "文档列表打开 native 窗口（未保存 server 的默认配置）",
    async () => {
      await navigate("文档");
      await page.locator(".ant-table-row").first().waitFor();
      const documents = await api("/api/documents?view=recent");
      documentFixture =
        documents.find((item) => item.type === "doc") || documents[0];
      assert.ok(documentFixture);
      const waiting = electronApp.waitForEvent("window");
      await page
        .locator(
          `.ant-table-row[data-row-key="${documentFixture.id}"] .documents-file-button`,
        )
        .click();
      documentPage = await waiting;
      const evidence = await inspectDocument(
        documentPage,
        documentFixture.id,
        documentFixture.title,
      );
      assert.equal(
        JSON.parse(
          fs.readFileSync(path.join(directory, "settings.json"), "utf8"),
        ).server,
        undefined,
      );
      await theme("light", [
        documentPage,
        ...(historyPage ? [historyPage] : []),
      ]);
      await screenshot(documentPage, "native-document-light");
      await theme("dark", [
        documentPage,
        ...(historyPage ? [historyPage] : []),
      ]);
      await screenshot(documentPage, "native-document-dark");
      return evidence;
    },
  );
  for (const [type, label] of [
    ["doc", "创建在线文档"],
    ["sheet", "创建在线表格"],
  ]) {
    await check(`新建${type}真实 API 与原生窗口`, async () => {
      await navigate("文档");
      const [target, created] = await Promise.all([
        electronApp.waitForEvent("window", { timeout: 20_000 }),
        perform("POST", "/api/documents", () =>
          page.getByRole("button", { name: new RegExp(label) }).click(),
        ),
      ]);
      assert.equal(created.type, type);
      const opened = await inspectDocument(target, created.id, created.title);
      if (!opened.contentDisplayed) {
        if (process.argv.includes("--require-collaboration"))
          throw new Error(`${type} 协作内容未同步`);
        return opened;
      }
      const persisted = await editAndReopen(target, created);
      return { opened, persisted };
    });
  }
  await check("任务真实 UI 完整 CRUD", tasks);
  await check("审批页和文档提交评审入口（不重复完整审批）", async () => {
    await navigate("审批");
    await page
      .getByRole("heading", { name: "文档评审", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "前往文档发起评审", exact: true })
      .click();
    const row = page.locator(
      `.ant-table-row[data-row-key="${documentFixture.id}"]`,
    );
    await row.getByRole("button", { name: /^更多操作：/ }).click();
    await page.getByRole("menuitem", { name: "提交评审", exact: true }).click();
    await page.getByRole("dialog", { name: "提交文档评审" }).waitFor();
    await page
      .getByRole("combobox", { name: "关联群聊", exact: true })
      .waitFor();
    await page
      .getByRole("dialog", { name: "提交文档评审" })
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "提交文档评审" })
      .waitFor({ state: "hidden" });
    return {
      nativeRenderer: true,
      submissionDialogOpened: true,
      decisionNotRepeated: true,
    };
  });
  await check("减少动效真实 IPC，Select 和文档 portal 菜单可点击", async () => {
    await page.evaluate(() =>
      window.desktop.preferences.update({
        appearance: { reducedMotion: true },
      }),
    );
    try {
      await navigate("任务");
      await choose("任务优先级", "优先级：高");
      await neutralStates(page, "tasks-reduced-motion");
      await navigate("文档");
      await page
        .locator(".ant-table-row")
        .first()
        .getByRole("button", { name: /^更多操作：/ })
        .click();
      await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      const duration = await page
        .getByRole("dialog")
        .evaluate((element) => getComputedStyle(element).transitionDuration);
      assert.ok(
        duration.split(",").every((value) => Number.parseFloat(value) === 0),
      );
      return { portalWorkaround: false, transitionDuration: duration };
    } finally {
      const dialog = page.getByRole("dialog", { name: "重命名文档" });
      if (await dialog.isVisible()) {
        await dialog.getByRole("button", { name: /^取\s*消$/ }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      await page.evaluate(() =>
        window.desktop.preferences.update({
          appearance: { reducedMotion: false },
        }),
      );
    }
  });
  await check("最新版 Settings 原生模态与三档尺寸", async () => {
    await theme("dark");
    await page.getByRole("button", { name: "打开设置", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "外观设置", exact: true }).click();
    await dialog
      .getByRole("button", { name: "使用深色主题", exact: true })
      .waitFor();
    await neutralStates(page, "settings-dark");
    const container = page.locator(".ant-modal-container");
    const style = await container.evaluate((element) => {
      const value = getComputedStyle(element);
      return {
        padding: value.padding,
        background: value.backgroundColor,
        border: value.borderWidth,
      };
    });
    assert.equal(style.padding, "0px", "Antd6 container 不应残留默认厚外边距");
    for (const width of [1024, 1280, 1440])
      await layout(
        "settings-dark",
        [
          dialog.getByRole("button", { name: "外观设置", exact: true }),
          dialog.getByRole("button", { name: "使用深色主题", exact: true }),
          dialog.getByRole("button", { name: "Close", exact: true }),
        ],
        width,
      );
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    return style;
  });
  await check("暗色 DatePicker 选中日期和输入背景为中灰", async () => {
    await navigate("任务");
    await theme("dark");
    await page
      .getByRole("textbox", { name: "任务截止时间", exact: true })
      .click();
    const dropdown = page
      .locator(".ant-picker-dropdown")
      .filter({ visible: true });
    await dropdown
      .locator(".ant-picker-cell-today .ant-picker-cell-inner")
      .click();
    const selected = dropdown
      .locator(".ant-picker-cell-selected .ant-picker-cell-inner")
      .first();
    await selected.waitFor();
    const background = await eventually(async () => {
      const value = await selected.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      assert.deepEqual(
        value
          .match(/[\d.]+/g)
          .map(Number)
          .slice(0, 3),
        [85, 94, 107],
        "日期选中态应使用已确认的中灰 #555e6b，不应恢复品牌蓝",
      );
      return value;
    }, 2000);
    const rendered = await renderedBackground(selected);
    report.colors.push({
      label: "datepicker-dark",
      selectedBackground: background,
      rendered,
    });
    await screenshot(page, "datepicker-dark-selected");
    await dropdown.locator(".ant-picker-ok button").click();
    await dropdown.waitFor({ state: "hidden" });
    return { selectedBackground: background, rendered };
  });
  await check("暗色静态 Modal.confirm 重命名正文和按钮对比", async () => {
    await navigate("文档");
    await theme("dark");
    await page
      .locator(".ant-table-row")
      .first()
      .getByRole("button", { name: /^更多操作：/ })
      .click();
    await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "重命名文档" });
    await dialog.waitFor();
    try {
      const containerBackground = await renderedBackground(
        dialog.locator(".ant-modal-container"),
      );
      assert.equal(
        containerBackground,
        "rgb(28, 31, 36)",
        "静态模态必须使用暗色 surface",
      );
      const samples = [];
      for (const target of [
        dialog.locator(".ant-modal-title").first(),
        dialog.getByRole("textbox"),
        ...(await dialog.getByRole("button").all()),
      ]) {
        const text = await target.evaluate((element) => ({
          name:
            element.getAttribute("aria-label") ||
            element.textContent?.trim() ||
            "重命名输入",
          color: getComputedStyle(element).color,
        }));
        const background = await renderedBackground(target);
        const ratio = contrast(text.color, background);
        samples.push({ ...text, background, contrast: ratio });
        assert.ok(
          ratio >= 4.5,
          `静态模态文字对比不足：${JSON.stringify(samples.at(-1))}`,
        );
      }
      await screenshot(page, "static-rename-dark-contrast");
      return { background: containerBackground, samples };
    } finally {
      const cancel = dialog.getByRole("button", { name: /^取\s*消$/ });
      if (await cancel.isVisible()) await cancel.click();
      await dialog.waitFor({ state: "hidden" });
    }
  });
  for (const mode of ["light", "dark"]) {
    for (const section of [
      "消息",
      "文档",
      "任务",
      "审批",
      "搜索",
      "通讯录",
      "通知",
      "组织管理",
    ]) {
      await check(
        `${section}/${mode}真实窗口1024/1280/1440与中性输入选中态`,
        async () => {
          if (section === "消息") await openConversation();
          else await navigate(section);
          await theme(mode);
          const controls = [
            page.getByRole("button", { name: "打开设置", exact: true }),
            page.getByRole("button", { name: "切换主题", exact: true }),
          ];
          if (section === "消息")
            controls.push(
              page.getByRole("button", { name: "打开聊天记录", exact: true }),
              page.getByRole("textbox", { name: "消息输入框" }),
              page.getByRole("button", { name: /^发\s*送$/ }),
            );
          if (section === "文档")
            controls.push(
              page.getByRole("button", { name: /创建在线文档/ }),
              page.getByRole("button", { name: /创建在线表格/ }),
              page.getByRole("textbox", { name: "搜索文档", exact: true }),
              page
                .locator(".ant-table-row")
                .first()
                .getByRole("button", { name: /^更多操作：/ }),
            );
          if (section === "任务")
            controls.push(
              page.getByRole("button", { name: "新增任务", exact: true }),
              page.getByRole("textbox", { name: "任务标题", exact: true }),
            );
          if (section === "审批")
            controls.push(
              page.getByRole("button", {
                name: "前往文档发起评审",
                exact: true,
              }),
            );
          await neutralStates(page, `${section}-${mode}`);
          await hoverStates(`${section}-${mode}`);
          await controls[0].hover();
          neutral(
            await controls[0].evaluate(
              (element) => getComputedStyle(element).backgroundColor,
            ),
            `${section}设置hover`,
          );
          await page.mouse.move(0, 0);
          const errors = [];
          for (const width of [1024, 1280, 1440]) {
            try {
              await layout(`${section}-${mode}`, controls, width);
            } catch (error) {
              errors.push(error.message);
            }
          }
          assert.deepEqual(
            errors,
            [],
            "三档尺寸发现关键操作裁切，完整测量和截图已保留",
          );
        },
      );
    }
  }
  await check(
    "二十次 appearance/chat/screenshot IPC 并发更新不丢字段",
    concurrentSettings,
  );
  await check(
    "preferences/截图/聊天设置重启一致，含辅助窗退出超时兜底",
    async () => {
      assert.ok(concurrentExpected, "并发设置尚未通过，不能声明重启一致");
      await shutdown();
      await launch();
      await signIn();
      const preferences = await page.evaluate(() =>
        window.desktop.preferences.get(),
      );
      assert.deepEqual(preferences, concurrentExpected.preferences);
      assert.equal(
        (await page.evaluate(() => window.desktop.screenshot.getPreferences()))
          .hideMainWindow,
        concurrentExpected.hideMainWindow,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "dark",
      );
      await screenshot(page, "restart-persisted-dark");
      return { preferences, shutdown: report.shutdowns.at(-1) };
    },
  );
  await check("没有未捕获渲染异常或服务端5xx", async () => {
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.networkFailures, []);
    return { consoleErrorsRetainedForAudit: report.consoleErrors.length };
  });
}

/** 收到中断时也只清理本轮自有实例，并保留已收集证据。 */
async function interrupted(signal) {
  report.failures.push({ name: "运行中断", error: signal });
  await shutdown();
  writeReport();
  console.log(`REPORT ${reportPath}`);
  process.exit(130);
}

process.once("SIGINT", () => void interrupted("SIGINT"));
process.once("SIGTERM", () => void interrupted("SIGTERM"));
console.log(`TEMP_DIR ${directory}`);
console.log(`REPORT ${reportPath}`);
try {
  await verify();
} catch (error) {
  report.failures.push({
    name: "回归入口",
    error: error.stack || String(error),
  });
  console.error(error.message);
} finally {
  await shutdown().catch((error) =>
    report.failures.push({ name: "自有进程退出", error: error.message }),
  );
  writeReport();
  console.log(
    `RESULT ${report.status}: ${report.checks.length} passed, ${report.failures.length} failed, ${report.notCovered.length} not covered`,
  );
  console.log(`REPORT ${reportPath}`);
  process.exit(report.failures.length ? 1 : 0);
}
