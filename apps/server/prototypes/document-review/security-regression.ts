// PROTOTYPE：独立安全回归，仅使用 harness 生成的临时库，不修改正式路由或模型。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import {
  bootPrototype,
  closePrototype,
  fixture,
  login,
  reviewInput,
  scratchDatabase,
} from "./harness";

type Identity = Awaited<ReturnType<typeof login>>;
type Fixture = Awaited<ReturnType<typeof fixture>>;
type CaseResult = { name: string; passed: boolean; error?: string };

/** 启动隔离应用，逐项执行真实 HTTP 回归，最后清理并汇总失败。 */
async function main() {
  const databasePath = scratchDatabase();
  const reportPath = path.join(
    path.dirname(databasePath),
    "security-regression-report.json",
  );
  const cases: CaseResult[] = [];
  const concurrencyRounds: any[] = [];
  let queueRecovery: any = null;
  let app: any;
  let sequence = 0;
  let fatal: string | undefined;
  let cleanupCompleted = false;

  /** 保留失败断言并继续其他独立用例，便于一次运行收集最小复现。 */
  async function check(name: string, test: () => Promise<void>) {
    try {
      await test();
      cases.push({ name, passed: true });
      console.log(`PASS ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cases.push({ name, passed: false, error: message });
      console.error(`FAIL ${name}: ${message}`);
    }
  }

  /** 使用真实 HTTP 入口，异常状态由调用方断言而不是吞掉。 */
  async function http(
    method: "get" | "post" | "put",
    url: string,
    identity?: Identity,
    body?: Record<string, any>,
  ) {
    let request = app.httpRequest()[method](url);
    if (identity)
      request = request.set("Authorization", identity.authorization);
    if (body) request = request.send(body);
    return await request.timeout({ response: 15_000, deadline: 30_000 });
  }

  /** 同时断言 HTTP 状态和领域错误，附上不含令牌的最小请求复现。 */
  function status(
    response: any,
    expected: number,
    repro: string,
    code?: string,
  ) {
    const detail = `${repro}; HTTP=${response.status}; body=${JSON.stringify(response.body)}`;
    assert.equal(response.status, expected, detail);
    if (expected === 200) assert.equal(response.body.success, true, detail);
    else {
      assert.equal(response.body.success, false, detail);
      if (code) assert.equal(response.body.error?.code, code, detail);
    }
    return response.body.data;
  }

  /** 为每个独立场景生成唯一标题和请求键，避免相邻失败污染计数。 */
  function input(data: Fixture, label: string) {
    const key = `security-${++sequence}-${label}`;
    return { ...reviewInput(data, key), title: `安全回归-${key}` };
  }

  /** 通过真实提交接口创建待审批实例，不直接写入原型表。 */
  async function submit(data: Fixture, label: string) {
    const body = input(data, label);
    const review = status(
      await http("post", "/prototype/reviews", data.owner, body),
      200,
      `owner POST /prototype/reviews ${JSON.stringify(body)}`,
    );
    assert.equal(review.status, "pending_review");
    assert.equal(review.taskId, null);
    return { body, review };
  }

  /** 从公开查询入口观察状态，不依赖原型内部模型。 */
  async function detail(id: number, identity: Identity) {
    return status(
      await http("get", `/prototype/reviews/${id}`, identity),
      200,
      `participant GET /prototype/reviews/${id}`,
    );
  }

  /** 从既有 HTTP API 收集与唯一标题相关的任务、通知和群消息。 */
  async function effects(data: Fixture, title: string) {
    const tasks = status(
      await http("get", "/api/tasks?scope=all", data.owner),
      200,
      "owner GET /api/tasks?scope=all",
    );
    const notifications: number[][] = [];
    for (const identity of [data.owner, data.approver, data.assignee]) {
      const page = status(
        await http("get", "/api/notifications?limit=100", identity),
        200,
        "participant GET /api/notifications?limit=100",
      );
      assert.ok(
        page.items.length < 100,
        "通知窗口不足，不能把截断当作无副作用",
      );
      notifications.push(
        page.items
          .filter((item: any) => item.body.includes(title))
          .map((item: any) => item.id)
          .sort((a: number, b: number) => a - b),
      );
    }
    const page = status(
      await http(
        "get",
        `/api/conversations/${data.conversation.id}/messages?limit=100`,
        data.owner,
      ),
      200,
      "owner GET conversation messages",
    );
    assert.equal(
      page.nextCursor,
      null,
      "群消息窗口不足，不能把截断当作无副作用",
    );
    return {
      tasks: tasks
        .filter((item: any) => item.title === title)
        .map((item: any) => item.id)
        .sort((a: number, b: number) => a - b),
      notifications,
      messages: page.items
        .filter((item: any) => item.summary.includes(title))
        .map((item: any) => item.id)
        .sort((a: number, b: number) => a - b),
    };
  }

  /** 临时撤销隔离夹具权限或账号状态，并在任何断言失败后恢复。 */
  async function changed(
    model: any,
    where: any,
    patch: any,
    test: () => Promise<void>,
  ) {
    const row = await model.findOne({ where });
    assert.ok(row, `缺少撤销权限夹具 ${JSON.stringify(where)}`);
    const previous = Object.fromEntries(
      Object.keys(patch).map((key) => [key, row.get(key)]),
    );
    await row.update(patch);
    try {
      await test();
    } finally {
      await row.update(previous);
    }
  }

  /** 在同一微任务门闩释放所有真实 HTTP 请求，禁止串行冒充并发。 */
  async function simultaneous(actions: Array<() => Promise<any>>) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = actions.map(async (action) => {
      await gate;
      return action();
    });
    release();
    return await Promise.all(pending);
  }

  console.log(`SECURITY_REGRESSION_START ${JSON.stringify({ databasePath })}`);
  try {
    ({ app } = await bootPrototype(databasePath));
    const data = await fixture(app);
    const base = await submit(data, "authorization");
    const decisionUrl = `/prototype/reviews/${base.review.id}/decision`;
    const baseEffects = await effects(data, base.body.title);

    await check("未登录不能提交、查询或审批", async () => {
      for (const [method, url, body] of [
        ["post", "/prototype/reviews", input(data, "anonymous")],
        ["get", `/prototype/reviews/${base.review.id}`, undefined],
        ["post", decisionUrl, { requestKey: "anonymous", decision: "approve" }],
      ] as const)
        status(
          await http(method, url, undefined, body),
          401,
          `anonymous ${method} ${url}`,
          "UNAUTHORIZED",
        );
      assert.deepEqual(await effects(data, base.body.title), baseEffects);
    });

    await check("三位参与者均可查询，不能读取内部幂等指纹", async () => {
      for (const identity of [data.owner, data.approver, data.assignee]) {
        const review = await detail(base.review.id, identity);
        assert.equal(review.id, base.review.id);
        for (const key of ["requestHash", "requestKey", "decisionKey"])
          assert.equal(key in review, false);
      }
    });

    await check("同企业无关成员不能查询、审批或发起", async () => {
      status(
        await http(
          "get",
          `/prototype/reviews/${base.review.id}`,
          data.outsider,
        ),
        403,
        "outsider GET review",
        "REVIEW_FORBIDDEN",
      );
      status(
        await http("post", decisionUrl, data.outsider, {
          requestKey: "outsider",
          decision: "approve",
        }),
        403,
        "outsider POST decision",
        "NOT_APPROVER",
      );
      status(
        await http(
          "post",
          "/prototype/reviews",
          data.outsider,
          input(data, "outsider"),
        ),
        403,
        "outsider POST review",
        "REVIEW_TARGET_FORBIDDEN",
      );
      assert.deepEqual(await effects(data, base.body.title), baseEffects);
      assert.equal(
        (await detail(base.review.id, data.owner)).status,
        "pending_review",
      );
    });

    for (const role of ["owner", "assignee"] as const)
      await check(`非指定审批人 ${role} 不能以伪造 body 审批`, async () => {
        status(
          await http("post", decisionUrl, data[role], {
            requestKey: `forged-${role}`,
            decision: "approve",
            userId: data.approver.user.id,
            approverId: data[role].user.id,
            companyId: data.owner.user.companyId,
          }),
          403,
          `${role} POST decision with forged approverId/userId`,
          "NOT_APPROVER",
        );
        assert.deepEqual(await effects(data, base.body.title), baseEffects);
      });

    await check("文档只读成员不能发起评审", async () => {
      status(
        await http(
          "post",
          "/prototype/reviews",
          data.approver,
          input(data, "viewer"),
        ),
        403,
        "viewer POST review",
        "DOCUMENT_READ_ONLY",
      );
    });

    // 第二企业同样真实注册和登录，SQL 仅用于准备其第二位群成员。
    status(
      await http("post", "/api/auth/company-register", undefined, {
        companyName: "安全回归隔离企业",
        name: "隔离所有者",
        phone: "13900000001",
        password: "123456",
      }),
      200,
      "POST company-register",
    );
    const foreign = await login(app, "13900000001");
    const originalUser = await app.chatDb.User.findByPk(data.outsider.user.id);
    await app.chatDb.User.create({
      companyId: foreign.user.companyId,
      departmentId: foreign.user.departmentId,
      name: "隔离成员",
      phone: "13900000002",
      passwordHash: originalUser.get("passwordHash"),
      status: "active",
    });
    const foreignMember = await login(app, "13900000002");
    const foreignDocument = status(
      await http("post", "/api/documents", foreign, {
        title: "隔离企业文档",
        type: "doc",
      }),
      200,
      "foreign POST document",
    );
    const foreignConversation = status(
      await http("post", "/api/conversations", foreign, {
        type: "group",
        name: "隔离企业群",
        memberIds: [foreignMember.user.id],
      }),
      200,
      "foreign POST group",
    );
    const foreignInput = {
      ...input(data, "foreign"),
      documentId: foreignDocument.id,
      conversationId: foreignConversation.id,
      approverId: foreign.user.id,
      assigneeId: foreign.user.id,
    };
    const foreignReview = status(
      await http("post", "/prototype/reviews", foreign, foreignInput),
      200,
      "foreign POST review",
    );

    for (const direction of ["foreign-to-local", "local-to-foreign"] as const)
      await check(`跨企业不能读取或决定 ${direction}`, async () => {
        const identity =
          direction === "foreign-to-local" ? foreign : data.approver;
        const id =
          direction === "foreign-to-local" ? base.review.id : foreignReview.id;
        const missing = await http(
          "get",
          "/prototype/reviews/2147483647",
          identity,
        );
        const denied = await http("get", `/prototype/reviews/${id}`, identity);
        status(
          denied,
          404,
          `${direction} GET /prototype/reviews/${id}`,
          "REVIEW_NOT_FOUND",
        );
        assert.deepEqual(
          denied.body,
          missing.body,
          "跨企业响应不能泄露实例是否存在",
        );
        for (const decision of ["approve", "reject"])
          status(
            await http("post", `/prototype/reviews/${id}/decision`, identity, {
              requestKey: `${direction}-${decision}`,
              decision,
              companyId:
                direction === "foreign-to-local"
                  ? data.owner.user.companyId
                  : foreign.user.companyId,
            }),
            404,
            `${direction} POST decision ${decision}`,
            "REVIEW_NOT_FOUND",
          );
        assert.deepEqual(await effects(data, base.body.title), baseEffects);
        assert.equal(
          (await detail(foreignReview.id, foreign)).status,
          "pending_review",
        );
      });

    for (const [field, value, expected, code] of [
      ["documentId", foreignDocument.id, 404, "DOCUMENT_NOT_FOUND"],
      ["conversationId", foreignConversation.id, 403, "GROUP_FORBIDDEN"],
      ["approverId", foreign.user.id, 403, "REVIEW_TARGET_FORBIDDEN"],
      ["assigneeId", foreign.user.id, 403, "REVIEW_TARGET_FORBIDDEN"],
    ] as const)
      await check(`不能提交跨企业引用 ${field}`, async () => {
        const body = {
          ...input(data, `cross-${field}`),
          [field]: value,
          companyId: foreign.user.companyId,
        };
        status(
          await http("post", "/prototype/reviews", data.owner, body),
          expected,
          `owner POST review ${JSON.stringify(body)}`,
          code,
        );
        assert.deepEqual(await effects(data, body.title), {
          tasks: [],
          notifications: [[], [], []],
          messages: [],
        });
      });

    await check("body 中伪造企业和提交者不能覆盖登录身份", async () => {
      const body = {
        ...input(data, "forged-body"),
        companyId: foreign.user.companyId,
        submitterId: foreign.user.id,
        userId: foreign.user.id,
      };
      const review = status(
        await http("post", "/prototype/reviews", data.owner, body),
        200,
        "owner POST with forged companyId/submitterId",
      );
      assert.equal(review.companyId, data.owner.user.companyId);
      assert.equal(review.submitterId, data.owner.user.id);
      status(
        await http("get", `/prototype/reviews/${review.id}`, foreign),
        404,
        "foreign GET forged-body review",
        "REVIEW_NOT_FOUND",
      );
      status(
        await http("post", "/prototype/reviews", foreign, {
          ...input(data, "forged-foreign"),
          companyId: data.owner.user.companyId,
          submitterId: data.owner.user.id,
        }),
        404,
        "foreign POST local references with forged companyId",
        "DOCUMENT_NOT_FOUND",
      );
    });

    await check("篡改令牌或可信签名但用户企业不匹配均被拒绝", async () => {
      const parts = foreign.authorization.slice("Bearer ".length).split(".");
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      parts[1] = Buffer.from(
        JSON.stringify({ ...payload, companyId: data.owner.user.companyId }),
      ).toString("base64url");
      const mismatched = jwt.sign(
        {
          userId: foreign.user.id,
          companyId: data.owner.user.companyId,
          role: "owner",
          tokenType: "access",
        },
        app.config.jwtSecret,
        { expiresIn: "5m" },
      );
      for (const token of [parts.join("."), mismatched]) {
        const identity = { ...foreign, authorization: `Bearer ${token}` };
        status(
          await http("get", `/prototype/reviews/${base.review.id}`, identity),
          401,
          "forged-token GET local review",
          "UNAUTHORIZED",
        );
        status(
          await http(
            "post",
            "/prototype/reviews",
            identity,
            input(data, "forged-token"),
          ),
          401,
          "forged-token POST review",
          "UNAUTHORIZED",
        );
        status(
          await http("post", decisionUrl, identity, {
            requestKey: "forged-token",
            decision: "approve",
          }),
          401,
          "forged-token POST decision",
          "UNAUTHORIZED",
        );
      }
    });

    for (const role of ["owner", "approver", "assignee"] as const) {
      for (const target of ["document", "group", "account"] as const)
        await check(
          `撤销 ${role} 的 ${target} 权限后提交与审批均拒绝且无副作用`,
          async () => {
            const test = await submit(data, `revoke-${role}-${target}`);
            const before = await effects(data, test.body.title);
            const userId = data[role].user.id;
            const model =
              target === "document"
                ? app.chatDb.CloudDocumentMember
                : target === "group"
                  ? app.chatDb.ConversationMember
                  : app.chatDb.User;
            const where =
              target === "document"
                ? { documentId: data.document.id, userId }
                : target === "group"
                  ? { conversationId: data.conversation.id, userId }
                  : { id: userId };
            const patch =
              target === "document"
                ? { permission: role === "owner" ? "viewer" : "removed" }
                : target === "group"
                  ? { leftAt: new Date() }
                  : { status: "disabled" };
            // 文档成员无停用字段，删除真实夹具成员实现撤权，随后恢复原始记录。
            const member =
              target === "document" && role !== "owner"
                ? await model.findOne({ where })
                : null;
            const original = member?.get({ plain: true });
            const exercise = async () => {
              const submissionExpected =
                target === "account" && role === "owner" ? 401 : 403;
              const decisionExpected =
                target === "account" && role === "approver" ? 401 : 403;
              status(
                await http(
                  "post",
                  "/prototype/reviews",
                  data.owner,
                  input(data, `revoked-submit-${role}-${target}`),
                ),
                submissionExpected,
                `revoke ${role}/${target}, owner POST review`,
              );
              for (const decision of ["approve", "reject"])
                status(
                  await http(
                    "post",
                    `/prototype/reviews/${test.review.id}/decision`,
                    data.approver,
                    {
                      requestKey: `revoked-${role}-${target}-${decision}`,
                      decision,
                    },
                  ),
                  decisionExpected,
                  `revoke ${role}/${target}, approver POST decision ${decision}`,
                );
              if (target === "account")
                status(
                  await http(
                    "get",
                    `/prototype/reviews/${test.review.id}`,
                    data[role],
                  ),
                  401,
                  `disabled ${role} GET review`,
                  "UNAUTHORIZED",
                );
            };
            if (member) {
              await member.destroy();
              try {
                await exercise();
              } finally {
                await model.create(original);
              }
            } else await changed(model, where, patch, exercise);
            assert.equal(
              (await detail(test.review.id, data.owner)).status,
              "pending_review",
            );
            assert.deepEqual(await effects(data, test.body.title), before);
          },
        );
    }

    await check("文档移入回收站后提交与审批拒绝", async () => {
      const test = await submit(data, "trashed-document");
      const before = await effects(data, test.body.title);
      await changed(
        app.chatDb.CloudDocument,
        { id: data.document.id },
        { trashedAt: new Date() },
        async () => {
          status(
            await http(
              "post",
              "/prototype/reviews",
              data.owner,
              input(data, "trashed-submit"),
            ),
            404,
            "trashed document POST review",
            "DOCUMENT_NOT_FOUND",
          );
          status(
            await http(
              "post",
              `/prototype/reviews/${test.review.id}/decision`,
              data.approver,
              { requestKey: "trashed", decision: "approve" },
            ),
            404,
            "trashed document POST decision",
            "DOCUMENT_NOT_FOUND",
          );
        },
      );
      assert.equal(
        (await detail(test.review.id, data.owner)).status,
        "pending_review",
      );
      assert.deepEqual(await effects(data, test.body.title), before);
    });

    await check("重复提交同一请求只创建一个实例和一条审批通知", async () => {
      const test = await submit(data, "repeat-submit");
      const before = await effects(data, test.body.title);
      assert.deepEqual(before, {
        tasks: [],
        notifications: [[], before.notifications[1], []],
        messages: [],
      });
      assert.equal(before.notifications[1].length, 1);
      for (let round = 0; round < 3; round++)
        assert.deepEqual(
          status(
            await http("post", "/prototype/reviews", data.owner, test.body),
            200,
            `repeat submit ${round}`,
          ),
          test.review,
        );
      assert.deepEqual(await effects(data, test.body.title), before);
    });

    await check("同提交请求键的不同有效 payload 返回 409", async () => {
      const test = await submit(data, "payload-conflict");
      const before = await effects(data, test.body.title);
      for (const patch of [
        { title: `${test.body.title}-changed` },
        { dueAt: "2030-01-03T00:00:00.000Z" },
        { assigneeId: data.approver.user.id },
      ])
        status(
          await http("post", "/prototype/reviews", data.owner, {
            ...test.body,
            ...patch,
          }),
          409,
          `same requestKey ${test.body.requestKey}, changed ${JSON.stringify(patch)}`,
          "REQUEST_KEY_CONFLICT",
        );
      assert.deepEqual(await detail(test.review.id, data.owner), test.review);
      assert.deepEqual(await effects(data, test.body.title), before);
    });

    await check("真正并发重复提交只得到一个实例和一条通知", async () => {
      const body = input(data, "concurrent-submit");
      const responses = await simultaneous(
        Array.from(
          { length: 8 },
          () => () => http("post", "/prototype/reviews", data.owner, body),
        ),
      );
      const reviews = responses.map((response, index) =>
        status(
          response,
          200,
          `concurrent submit ${index} key=${body.requestKey}`,
        ),
      );
      assert.equal(new Set(reviews.map((review) => review.id)).size, 1);
      const observed = await effects(data, body.title);
      assert.equal(observed.notifications[1].length, 1);
      assert.deepEqual(observed.tasks, []);
      assert.deepEqual(observed.messages, []);
    });

    await check(
      "批准后同键及不同键重复批准均不重复副作用，拒绝返回 409",
      async () => {
        const test = await submit(data, "repeat-approval");
        const url = `/prototype/reviews/${test.review.id}/decision`;
        const approved = status(
          await http("post", url, data.approver, {
            requestKey: "approve-original",
            decision: "approve",
          }),
          200,
          "first approval",
        );
        assert.equal(approved.status, "approved");
        const before = await effects(data, test.body.title);
        assert.deepEqual(before.tasks, [approved.taskId]);
        assert.equal(before.notifications[1].length, 1);
        assert.equal(before.notifications[2].length, 1);
        assert.equal(before.messages.length, 1);
        for (const requestKey of [
          "approve-original",
          "approve-original",
          "approve-another",
        ])
          assert.deepEqual(
            status(
              await http("post", url, data.approver, {
                requestKey,
                decision: "approve",
              }),
              200,
              `repeat approval ${requestKey}`,
            ),
            approved,
          );
        for (const requestKey of ["approve-original", "reject-another"])
          status(
            await http("post", url, data.approver, {
              requestKey,
              decision: "reject",
            }),
            409,
            `approve then reject key=${requestKey}`,
            "REVIEW_ALREADY_DECIDED",
          );
        assert.deepEqual(await detail(test.review.id, data.owner), approved);
        assert.deepEqual(await effects(data, test.body.title), before);
      },
    );

    await check("拒绝后重复拒绝无任务，改为批准返回 409", async () => {
      const test = await submit(data, "repeat-rejection");
      const url = `/prototype/reviews/${test.review.id}/decision`;
      const rejected = status(
        await http("post", url, data.approver, {
          requestKey: "reject-original",
          decision: "reject",
        }),
        200,
        "first rejection",
      );
      assert.equal(rejected.status, "rejected");
      assert.equal(rejected.taskId, null);
      const before = await effects(data, test.body.title);
      for (const requestKey of ["reject-original", "reject-another"])
        assert.deepEqual(
          status(
            await http("post", url, data.approver, {
              requestKey,
              decision: "reject",
            }),
            200,
            `repeat rejection ${requestKey}`,
          ),
          rejected,
        );
      status(
        await http("post", url, data.approver, {
          requestKey: "reject-original",
          decision: "approve",
        }),
        409,
        "reject then approve",
        "REVIEW_ALREADY_DECIDED",
      );
      assert.deepEqual(before.tasks, []);
      assert.deepEqual(before.messages, []);
      assert.deepEqual(before.notifications[2], []);
      assert.deepEqual(await effects(data, test.body.title), before);
    });

    for (let round = 1; round <= 6; round++)
      await check(
        `并发批准拒绝竞争第 ${round} 轮：唯一决定且一个或零个任务`,
        async () => {
          const test = await submit(data, `decision-race-${round}`);
          const decisions = Array.from({ length: 8 }, (_, index) =>
            (index + round) % 2 ? "approve" : "reject",
          );
          const responses = await simultaneous(
            decisions.map(
              (decision, index) => () =>
                http(
                  "post",
                  `/prototype/reviews/${test.review.id}/decision`,
                  data.approver,
                  {
                    requestKey: `race-${round}-${index % 4}`,
                    decision,
                  },
                ),
            ),
          );
          const observed = await detail(test.review.id, data.owner);
          const winner = observed.status === "approved" ? "approve" : "reject";
          const sideEffects = await effects(data, test.body.title);
          concurrencyRounds.push({
            round,
            reviewId: test.review.id,
            winner: observed.status,
            taskId: observed.taskId,
            sideEffects,
            statuses: responses.map((response) => response.status),
            errorCodes: responses.map(
              (response) => response.body.error?.code || null,
            ),
            decisions,
          });
          assert.ok(
            ["approved", "rejected"].includes(observed.status),
            JSON.stringify(concurrencyRounds.at(-1)),
          );
          assert.deepEqual(
            sideEffects.tasks,
            winner === "approve" ? [observed.taskId] : [],
          );
          assert.equal(sideEffects.notifications[1].length, 1);
          assert.equal(
            sideEffects.notifications[2].length,
            winner === "approve" ? 1 : 0,
          );
          assert.equal(
            sideEffects.messages.length,
            winner === "approve" ? 1 : 0,
          );
          assert.deepEqual(sideEffects.notifications[0], []);
          if (winner === "reject") assert.equal(observed.taskId, null);
          for (let index = 0; index < responses.length; index++) {
            const result = status(
              responses[index],
              decisions[index] === winner ? 200 : 409,
              `round=${round}, review=${test.review.id}, parallel decision=${decisions[index]}, key=race-${round}-${index % 4}`,
              decisions[index] === winner
                ? undefined
                : "REVIEW_ALREADY_DECIDED",
            );
            if (decisions[index] === winner) assert.deepEqual(result, observed);
          }
        },
      );

    await check(
      "任务写入失败回滚且不毒化队列：后续新写入和同一回调重试均成功",
      async () => {
        const test = await submit(data, "queue-failure");
        const before = await effects(data, test.body.title);
        const url = `/prototype/reviews/${test.review.id}/decision`;
        const callback = {
          requestKey: "queue-failure-callback",
          decision: "approve",
        };
        const triggerTitle = test.body.title.replace(/'/g, "''");
        await app.chatDb.sequelize.query(
          `CREATE TRIGGER prototype_security_task_failure BEFORE INSERT ON tasks WHEN NEW.title = '${triggerTitle}' BEGIN SELECT RAISE(ABORT, 'PROTOTYPE_SECURITY_TASK_FAILURE'); END`,
        );
        let subsequent: any;
        try {
          status(
            await http("post", url, data.approver, callback),
            400,
            `trigger RAISE(ABORT), approver POST ${url} ${JSON.stringify(callback)}`,
            "VALIDATION_ERROR",
          );
          assert.deepEqual(
            await detail(test.review.id, data.owner),
            test.review,
          );
          assert.deepEqual(await effects(data, test.body.title), before);
          // 保留故障触发器时就执行后续正常写入，避免移除触发器掩盖队列中毒。
          const later = await submit(data, "after-queue-failure");
          subsequent = status(
            await http(
              "post",
              `/prototype/reviews/${later.review.id}/decision`,
              data.approver,
              {
                requestKey: "after-queue-failure-approve",
                decision: "approve",
              },
            ),
            200,
            "failed callback followed by successful new submit and approval",
          );
          assert.equal(subsequent.status, "approved");
          assert.ok(subsequent.taskId);
          const subsequentEffects = await effects(data, later.body.title);
          assert.deepEqual(subsequentEffects.tasks, [subsequent.taskId]);
          assert.equal(subsequentEffects.notifications[1].length, 1);
          assert.equal(subsequentEffects.notifications[2].length, 1);
          assert.equal(subsequentEffects.messages.length, 1);
        } finally {
          await app.chatDb.sequelize.query(
            "DROP TRIGGER IF EXISTS prototype_security_task_failure",
          );
        }
        const retried = status(
          await http("post", url, data.approver, callback),
          200,
          `after dropping trigger, retry identical callback ${JSON.stringify(callback)}`,
        );
        assert.equal(retried.status, "approved");
        assert.ok(retried.taskId);
        const after = await effects(data, test.body.title);
        assert.deepEqual(after.tasks, [retried.taskId]);
        assert.equal(after.notifications[1].length, 1);
        assert.equal(after.notifications[2].length, 1);
        assert.equal(after.messages.length, 1);
        assert.deepEqual(
          status(
            await http("post", url, data.approver, callback),
            200,
            "repeat identical callback after successful retry",
          ),
          retried,
        );
        assert.deepEqual(await effects(data, test.body.title), after);
        queueRecovery = {
          failedReviewId: test.review.id,
          failureStatus: 400,
          failureCode: "VALIDATION_ERROR",
          subsequentReviewId: subsequent.id,
          subsequentTaskId: subsequent.taskId,
          retryTaskId: retried.taskId,
          sideEffects: after,
        };
      },
    );
  } catch (error) {
    fatal =
      error instanceof Error ? error.stack || error.message : String(error);
    console.error(`FAIL 初始化或夹具: ${fatal}`);
  } finally {
    if (app)
      await check("SQL.close 与 app.close 均正常完成", async () => {
        await closePrototype(app);
        cleanupCompleted = true;
      });
  }
  const failed =
    cases.filter((item) => !item.passed).length + Number(Boolean(fatal));
  const summary = {
    databasePath,
    reportPath,
    passed: cases.filter((item) => item.passed).length,
    failed,
    total: cases.length + Number(Boolean(fatal)),
    cleanupCompleted,
    concurrencyRounds,
    queueRecovery,
    failures: cases.filter((item) => !item.passed),
    fatal: fatal || null,
    cases,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`SECURITY_REGRESSION_JSON ${JSON.stringify(summary)}`);
  console.log(`SECURITY_REGRESSION_REPORT ${reportPath}`);
  console.log(
    `SECURITY_REGRESSION_TOTAL PASS=${summary.passed} FAIL=${failed} TOTAL=${summary.total}`,
  );
  if (failed)
    throw new Error(
      `安全回归存在 ${failed} 项失败，失败断言和最小复现见 SECURITY_REGRESSION_JSON`,
    );
}

// egg-mock 附带句柄不会自行退出；必须在 main 完成断言与清理之后显式退出。
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
