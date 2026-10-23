// 用法：node apps/desktop/scripts/verify-workspace-ui.mjs <playwright模块路径> msedge --sections-only
// 复用隔离 Egg/Vite/数据库生命周期，仅通过真实 HTTP 与浏览器公开界面准备和验证业务。
import assert from "node:assert/strict";
import path from "node:path";

/** 使用真实页面和隔离接口验证合并导航后的筛选、定位、权限及布局。 */
export async function verifyWorkspaceSections({
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
}) {
  const approver = await login("13800000002");
  const assignee = await login("13800000003");
  const suffix = Date.now();
  /** 调用已登录测试账号的真实业务 API，不读取数据库或输出认证信息。 */
  async function api(actor, method, pathname, body) {
    const request = app
      .httpRequest()
      [method](pathname)
      .set("Authorization", actor.authorization);
    if (body) request.send(body);
    const response = await request.expect(200);
    assert.equal(response.body.success, true);
    return response.body.data;
  }
  const todo = await api(account, "post", "/api/tasks", {
    title: `区域回归待办 ${suffix}`,
  });
  const done = await api(account, "post", "/api/tasks", {
    title: `区域回归完成 ${suffix}`,
  });
  await api(account, "patch", `/api/tasks/${done.id}`, { status: "done" });
  await api(account, "post", "/api/notifications/read-all");
  const assigned = [];
  for (const state of ["未读", "已读"]) {
    assigned.push(
      await api(approver, "post", "/api/tasks", {
        title: `区域回归通知${state} ${suffix}`,
        assigneeId: account.user.id,
      }),
    );
  }
  const notices = await api(account, "get", "/api/notifications");
  const unreadNotice = notices.items.find(
    (item) => item.taskId === assigned[0].id,
  );
  const readNotice = notices.items.find(
    (item) => item.taskId === assigned[1].id,
  );
  assert.ok(unreadNotice && readNotice, "真实任务分配必须生成通知");
  await api(account, "post", `/api/notifications/${readNotice.id}/read`);
  const imported = await app
    .httpRequest()
    .post("/api/documents/import")
    .set("Authorization", account.authorization)
    .attach(
      "file",
      Buffer.from("区域合并回归提交版本：审批通过后创建关联任务。"),
      {
        filename: "区域合并回归.txt",
        contentType: "text/plain",
      },
    )
    .expect(200);
  const document = imported.body.data;
  await api(account, "put", `/api/documents/${document.id}/members`, {
    members: [approver, assignee].map((actor) => ({
      userId: actor.user.id,
      permission: "viewer",
    })),
  });
  const review = await api(account, "post", "/api/document-reviews", {
    requestKey: crypto.randomUUID(),
    documentId: document.id,
    conversationId: group.id,
    approverId: approver.user.id,
    assigneeId: assignee.user.id,
    title: `区域回归审批 ${suffix}`,
    dueAt: "2030-01-02T00:00:00.000Z",
  });
  /** 按业务标题定位真实卡片，避免把其他任务的动作当成目标权限。 */
  const card = (title, target = page) =>
    target.getByRole("article").filter({ hasText: title });
  /** 限定工作中心二级导航，避免与侧栏同名入口混淆。 */
  const work = (target = page) =>
    target.getByRole("navigation", { name: "工作中心视图", exact: true });
  /** 按字段读取当前 URL，不依赖查询参数序列化顺序。 */
  const query = (target = page) => new URL(target.url()).searchParams;
  /** 等待正式工作台挂载，并确认没有注入模拟 native 桥。 */
  async function ready(target = page) {
    await target.locator(".workspace-main").waitFor();
    assert.equal(await target.evaluate(() => Boolean(window.desktop)), false);
  }
  /** 冷开原业务深链，覆盖入口初始化与登录守卫。 */
  async function open(route, target = page) {
    await target.goto(`${url}${route}`);
    await ready(target);
  }
  /** 通过真实二级链接离开并返回，验证区域内最近 URL 的恢复。 */
  async function toggleAwayBack(name, target = page) {
    await navigate(target, name === "审批" ? "通知" : "审批");
    await navigate(target, name);
  }
  /** 检查 Segmented 的真实选中值；交互仍点击可见标签。 */
  async function selectedRadio(label, target = page) {
    await target
      .getByRole("radio", { name: label, exact: true })
      .waitFor({ state: "attached" });
    assert.equal(
      await target.getByRole("radio", { name: label, exact: true }).isChecked(),
      true,
    );
  }
  /** 确认唯一高亮来自指定卡片，不把单纯跳转视作定位成功。 */
  async function highlighted(title, target = page) {
    await card(title, target)
      .and(target.locator('[data-search-highlighted="true"]'))
      .waitFor();
    assert.equal(
      await target.locator('[data-search-highlighted="true"]').count(),
      1,
    );
  }
  /** 等待侧栏与通知子页角标同时反映真实未读数量。 */
  async function badge(count, target = page) {
    await target.waitForFunction((expected) => {
      const sidebar = document.querySelector(
        '.workspace-nav-item[aria-label="工作中心"] .workspace-nav-badge',
      );
      const tab = document.querySelector(
        '.workspace-section-link[aria-label="通知"] .workspace-section-badge',
      );
      return expected
        ? sidebar?.textContent === String(expected) &&
            tab?.textContent === String(expected)
        : !sidebar && !tab;
    }, count);
  }

  await check(
    "工作中心保留五入口/三子页语义，任务状态切换返回与刷新恢复真实筛选",
    async () => {
      await navigate(page, "任务");
      assert.deepEqual(
        await page
          .locator(".workspace-nav a")
          .evaluateAll((links) =>
            links.map((link) => link.getAttribute("aria-label")),
          ),
        ["消息", "搜索", "团队", "文档", "工作中心"],
      );
      assert.deepEqual(
        await work()
          .getByRole("link")
          .evaluateAll((links) =>
            links.map((link) => link.getAttribute("aria-label")),
          ),
        ["任务", "审批", "通知"],
      );
      await choose(page, "状态", "已完成");
      /** 同时核对 URL、筛选控件与列表内容，供往返/刷新重复验收。 */
      const assertFilter = async () => {
        assert.equal(query().get("status"), "done");
        await page
          .locator('.tasks-status-filter .ant-select-content[title="已完成"]')
          .waitFor();
        await card(done.title).waitFor();
        await card(todo.title).waitFor({ state: "hidden" });
        assert.equal(
          await work()
            .getByRole("link", { name: "任务", exact: true })
            .getAttribute("aria-current"),
          "page",
        );
      };
      await assertFilter();
      await toggleAwayBack("任务");
      await assertFilter();
      await page.reload();
      await assertFilter();
    },
  );

  await check(
    "审批 submitted/all 范围及选中详情在子页往返和刷新后保留",
    async () => {
      await navigate(page, "审批");
      for (const [label, scope] of [
        ["我发起的", "submitted"],
        ["全部参与", "all"],
      ]) {
        await page
          .locator(".reviews-toolbar")
          .getByText(label, { exact: true })
          .click();
        const reviewCard = page
          .getByRole("region", { name: "评审列表", exact: true })
          .getByRole("button")
          .filter({ hasText: review.title });
        await reviewCard.click();
        /** 核对审批范围、列表、选中版本及发起者只读权限。 */
        const assertFilter = async () => {
          assert.equal(query().get("scope"), scope);
          assert.equal(query().get("reviewId"), String(review.id));
          await selectedRadio(label);
          await reviewCard.waitFor();
          await page
            .getByRole("heading", { name: review.title, exact: true })
            .waitFor();
          await page
            .getByText("区域合并回归提交版本：审批通过后创建关联任务。", {
              exact: true,
            })
            .waitFor();
          assert.equal(
            await page
              .getByRole("button", { name: "通过并建任务", exact: true })
              .count(),
            0,
          );
        };
        await assertFilter();
        await toggleAwayBack("审批");
        await assertFilter();
        await page.reload();
        await assertFilter();
      }
    },
  );

  await check(
    "通知未读筛选返回与刷新恢复，已读卡片隐藏且两处角标一致",
    async () => {
      await navigate(page, "通知");
      await page
        .locator(".notifications-toolbar")
        .getByText("未读", { exact: true })
        .click();
      /** 验证未读过滤确实隐藏已读通知，并与两处角标一致。 */
      const assertFilter = async () => {
        assert.equal(query().get("unread"), "1");
        await selectedRadio("未读");
        await card(assigned[0].title).waitFor();
        await card(assigned[1].title).waitFor({ state: "hidden" });
        await badge(1);
      };
      await assertFilter();
      await toggleAwayBack("通知");
      await assertFilter();
      await page.reload();
      await assertFilter();
    },
  );

  await check(
    "taskId 优先于冲突状态，返回和刷新保持高亮，主动筛选清除旧定位",
    async () => {
      await open(`/tasks?taskId=${todo.id}&status=done&source=regression`);
      /** 定位任务须覆盖冲突状态，同时保留来源参数与唯一高亮。 */
      const assertTarget = async () => {
        await highlighted(todo.title);
        await card(done.title).waitFor();
        await page
          .locator('.tasks-status-filter .ant-select-content[title="全部状态"]')
          .waitFor();
        assert.equal(query().get("taskId"), String(todo.id));
        assert.equal(query().get("source"), "regression");
      };
      await assertTarget();
      await work().getByRole("link", { name: "任务", exact: true }).click();
      await assertTarget();
      await toggleAwayBack("任务");
      await assertTarget();
      await page.reload();
      await assertTarget();
      await choose(page, "状态", "已完成");
      await card(todo.title).waitFor({ state: "hidden" });
      assert.equal(query().has("taskId"), false);
      assert.equal(query().get("source"), "regression");
      await toggleAwayBack("任务");
      assert.equal(query().has("taskId"), false);
      await card(todo.title).waitFor({ state: "hidden" });
    },
  );

  await check(
    "reviewId 不受待我审批空列表影响，切换返回仍展示只读提交快照",
    async () => {
      await open(`/reviews?reviewId=${review.id}&source=notification`);
      /** 待审批列表为空时，选中的只读评审仍须独立显示。 */
      const assertTarget = async () => {
        await selectedRadio("待我审批");
        await page.getByText("暂无待审批评审", { exact: true }).waitFor();
        await page
          .getByRole("heading", { name: review.title, exact: true })
          .waitFor();
        assert.equal(query().get("reviewId"), String(review.id));
        assert.equal(query().get("source"), "notification");
        assert.equal(
          await page
            .getByRole("button", { name: "通过并建任务", exact: true })
            .count(),
          0,
        );
      };
      await assertTarget();
      await toggleAwayBack("审批");
      await assertTarget();
      await page.reload();
      await assertTarget();
    },
  );

  await check(
    "notificationId 优先于 unread=1，已读目标往返/刷新保持定位，改筛选清除定位",
    async () => {
      await open(
        `/notifications?notificationId=${readNotice.id}&unread=1&source=search`,
      );
      /** 已读定位通知须绕过未读过滤，并保持其已读状态。 */
      const assertTarget = async () => {
        await highlighted(assigned[1].title);
        await selectedRadio("全部");
        assert.equal(query().get("notificationId"), String(readNotice.id));
        assert.equal(query().get("source"), "search");
        assert.equal(
          await card(assigned[1].title)
            .getByRole("button", { name: "标为已读", exact: true })
            .count(),
          0,
        );
      };
      await assertTarget();
      await toggleAwayBack("通知");
      await assertTarget();
      await page.reload();
      await assertTarget();
      await page
        .locator(".notifications-toolbar")
        .getByText("未读", { exact: true })
        .click();
      await card(assigned[1].title).waitFor({ state: "hidden" });
      assert.equal(query().has("notificationId"), false);
      assert.equal(query().get("source"), "search");
      await toggleAwayBack("通知");
      await selectedRadio("未读");
      await card(assigned[1].title).waitFor({ state: "hidden" });
    },
  );

  await check(
    "通知真实标已读减少 API 未读数，侧栏/子导航角标同步归零",
    async () => {
      await open("/notifications?unread=1");
      await badge(1);
      await perform(
        page,
        "POST",
        `/api/notifications/${unreadNotice.id}/read`,
        () =>
          card(assigned[0].title)
            .getByRole("button", { name: "标为已读", exact: true })
            .click(),
      );
      await card(assigned[0].title).waitFor({ state: "hidden" });
      await badge(0);
      assert.equal(
        (await api(account, "get", "/api/notifications")).unreadCount,
        0,
      );
      await page.getByText("暂无未读通知", { exact: true }).waitFor();
    },
  );

  await check(
    "搜索任务与已读通知结果进入原URL并定位，通知关联入口再定位任务",
    async () => {
      for (const [type, title, key, id] of [
        ["任务", todo.title, "taskId", todo.id],
        ["通知", assigned[1].title, "notificationId", readNotice.id],
      ]) {
        await navigate(page, "搜索");
        await page
          .getByRole("textbox", { name: "搜索关键词", exact: true })
          .fill(title);
        await choose(page, "搜索类型", type);
        await page
          .locator(".search-result-card")
          .filter({ hasText: title })
          .click();
        await highlighted(title);
        assert.equal(query().get(key), String(id));
        assert.equal(
          await page
            .getByRole("link", { name: "工作中心", exact: true })
            .getAttribute("aria-current"),
          "page",
        );
        await toggleAwayBack(type);
        await highlighted(title);
      }
      await card(assigned[1].title).locator(".notifications-open").click();
      await highlighted(assigned[1].title);
      assert.equal(new URL(page.url()).pathname, "/tasks");
      assert.equal(query().get("taskId"), String(assigned[1].id));
    },
  );

  await check(
    "审批通知→审批通过→非mine关联任务只读→二级页返回原定位",
    async () => {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const reviewer = await context.newPage();
      observe(reviewer);
      reviewer.setDefaultTimeout(20_000);
      try {
        await signIn(reviewer, approver.user.phone);
        await navigate(reviewer, "通知");
        await card(review.title, reviewer)
          .locator(".notifications-open")
          .click();
        await reviewer
          .getByRole("heading", { name: review.title, exact: true })
          .waitFor();
        assert.equal(query(reviewer).get("reviewId"), String(review.id));
        await reviewer.getByLabel("审批意见（可选）").fill("区域回归通过");
        await reviewer
          .getByRole("button", { name: "通过并建任务", exact: true })
          .click();
        await reviewer
          .getByRole("button", { name: "确认通过", exact: true })
          .click();
        await reviewer
          .getByRole("button", { name: "查看自动创建的任务", exact: true })
          .waitFor();
        const detail = await api(
          approver,
          "get",
          `/api/document-reviews/${review.id}`,
        );
        assert.equal(detail.status, "approved");
        assert.ok(detail.taskId);
        assert.equal(
          (await api(approver, "get", "/api/tasks")).some(
            (item) => item.id === detail.taskId,
          ),
          false,
        );
        await reviewer
          .getByRole("button", { name: "查看自动创建的任务", exact: true })
          .click();
        await highlighted(review.title, reviewer);
        assert.equal(query(reviewer).get("taskId"), String(detail.taskId));
        for (const name of ["推进任务", "编辑任务"])
          assert.equal(
            await card(review.title, reviewer)
              .getByRole("button", { name, exact: true })
              .isDisabled(),
            true,
          );
        assert.equal(
          await card(review.title, reviewer)
            .getByRole("button", { name: "删除任务", exact: true })
            .count(),
          0,
        );
        await navigate(reviewer, "审批");
        assert.equal(query(reviewer).get("reviewId"), String(review.id));
        await reviewer
          .getByRole("button", { name: "查看自动创建的任务", exact: true })
          .waitFor();
        await navigate(reviewer, "任务");
        await highlighted(review.title, reviewer);
        await reviewer.reload();
        await highlighted(review.title, reviewer);
        await capture(reviewer, "section-review-task-readonly", 1024);
      } finally {
        await context.close();
      }
    },
  );

  await check(
    "团队通讯录详情与组织部门view切换返回/刷新恢复，普通成员仍被组织守卫拦截",
    async () => {
      await open(`/contacts/${approver.user.id}?source=regression`);
      await page
        .getByRole("heading", { name: "成员资料", exact: true })
        .waitFor();
      await navigate(page, "组织管理");
      await page
        .getByRole("navigation", { name: "组织管理分区", exact: true })
        .getByRole("button", { name: "部门架构", exact: true })
        .click();
      await page
        .getByRole("button", { name: "新建部门", exact: true })
        .waitFor();
      assert.equal(query().get("view"), "departments");
      await navigate(page, "通讯录");
      assert.equal(
        new URL(page.url()).pathname,
        `/contacts/${approver.user.id}`,
      );
      assert.equal(query().get("source"), "regression");
      await page
        .getByRole("heading", { name: "成员资料", exact: true })
        .waitFor();
      await navigate(page, "组织管理");
      assert.equal(query().get("view"), "departments");
      await page
        .getByRole("button", { name: "新建部门", exact: true })
        .waitFor();
      await page.reload();
      await page
        .getByRole("button", { name: "新建部门", exact: true })
        .waitFor();
      assert.equal(query().get("view"), "departments");
      const context = await browser.newContext();
      const member = await context.newPage();
      observe(member);
      member.setDefaultTimeout(20_000);
      try {
        await signIn(member, assignee.user.phone);
        await navigate(member, "通讯录");
        assert.equal(
          await member
            .getByRole("link", { name: "组织管理", exact: true })
            .count(),
          0,
        );
        await open("/organization?view=departments", member);
        await member.waitForURL(`${url}/chat`);
        await member.locator(".chat-workspace").waitFor();
        await navigate(member, "任务");
        assert.equal(await work(member).getByRole("link").count(), 3);
      } catch (error) {
        await member.screenshot({
          path: path.join(directory, "section-member-failure.png"),
        });
        throw new Error(
          `${error.message}\n成员当前路径：${new URL(member.url()).pathname}；可见区域：${await member
            .locator(".workspace-section-nav")
            .getAttribute("aria-label")
            .catch(() => "无")}`,
        );
      } finally {
        await context.close();
      }
    },
  );

  await check("三页非法筛选值回退默认且旧路径直接刷新可用", async () => {
    await open("/tasks?status=constructor&taskId=-1");
    await page
      .locator('.tasks-status-filter .ant-select-content[title="全部状态"]')
      .waitFor();
    await card(todo.title).waitFor();
    await card(done.title).waitFor();
    await open("/reviews?scope=bogus&reviewId=NaN");
    await selectedRadio("待我审批");
    await page
      .getByText("选择评审查看提交版本和审批进度", { exact: true })
      .waitFor();
    await open("/notifications?unread=true&notificationId=0");
    await selectedRadio("全部");
    await card(assigned[1].title).waitFor();
    assert.equal(
      await page.locator('[data-search-highlighted="true"]').count(),
      0,
    );
  });

  await check(
    "工作中心三页亮暗主题375/1024宽度实际布局无横向溢出",
    async () => {
      for (const [name, theme] of [
        ["任务", "light"],
        ["审批", "dark"],
        ["通知", "dark"],
      ]) {
        await navigate(page, name);
        await page
          .getByRole("button", { name: "切换主题", exact: true })
          .click();
        await page
          .getByRole("menuitem", {
            name: theme === "light" ? "浅色模式" : "深色模式",
            exact: true,
          })
          .click();
        await page.waitForFunction(
          (value) => document.documentElement.dataset.theme === value,
          theme,
        );
        for (const width of [1024, 375]) {
          await capture(page, `section-${name}-${theme}`, width);
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
          );
          assert.equal(await work().getByRole("link").count(), 3);
        }
        await page.setViewportSize({ width: 1440, height: 900 });
      }
    },
  );
}
