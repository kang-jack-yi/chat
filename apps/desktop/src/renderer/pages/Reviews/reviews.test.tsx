// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { Modal, message } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentReviewDetail, SessionData } from "@chat/shared";
import ReviewsPage from "./index";
import { documentReviewsService } from "../../services/document-reviews";
import { useUserStore } from "../../stores/user-store";

vi.mock("../../services/document-reviews", () => ({
  documentReviewsService: { list: vi.fn(), detail: vi.fn(), decide: vi.fn() },
}));
vi.mock("antd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("antd")>()),
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

/** 提供标题与正文刻意不同的完整评审快照，避免把列表误当详情。 */
function review(
  id = 41,
  status: DocumentReviewDetail["status"] = "pending_review",
): DocumentReviewDetail {
  return {
    id,
    documentId: 7,
    documentVersionId: id + 100,
    documentTitle: "当前文档标题",
    conversationId: 8,
    conversationName: "发布群",
    submitterId: 1,
    approverId: 2,
    assigneeId: 3,
    submitter: { id: 1, name: "发起者", avatar: "发" },
    approver: { id: 2, name: "审批者", avatar: "审" },
    assignee: { id: 3, name: "负责人", avatar: "负" },
    title: `评审任务 ${id}`,
    dueAt: "2026-11-01T12:00:00.000Z",
    status,
    taskId: status === "approved" ? 90 : null,
    decisionComment: "",
    decidedAt: status === "pending_review" ? null : "2026-10-11T12:00:00.000Z",
    createdAt: "2026-10-10T12:00:00.000Z",
    version: {
      id: id + 100,
      documentId: 7,
      title: `提交时标题 ${id}`,
      label: "评审版本",
      author: { id: 1, name: "发起者", avatar: "发" },
      createdAt: "2026-10-10T12:00:00.000Z",
      text: `不可变正文 ${id}\n第二行 <script>不会执行</script>`,
    },
  };
}

/** 使用纯内存会话，不访问用户数据库或桌面桥。 */
function session(
  id = 2,
  role: SessionData["user"]["role"] = "member",
): SessionData {
  return {
    company: { id: 1, name: "测试企业", code: "TEST", ownerId: 1 },
    user: {
      id,
      role,
      companyId: 1,
      departmentId: null,
      phone: "",
      name: "测试用户",
      title: "",
      avatar: "测",
      email: "",
      bio: "",
      presenceStatus: "available",
      statusText: "",
      statusExpiresAt: null,
      status: "active",
    },
  };
}

/** 手动完成服务响应，确定性检验迟到响应及重复点击。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** 公开当前路由并激活下游查询，以真实重新请求验证刷新效果。 */
function Observers({
  tasks,
  notifications,
}: {
  tasks: () => Promise<number>;
  notifications: () => Promise<number>;
}) {
  const location = useLocation();
  const taskQuery = useQuery({ queryKey: ["tasks", "all"], queryFn: tasks });
  const notificationQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: notifications,
  });
  return (
    <output data-testid="observed">
      {location.pathname}
      {location.search}|{taskQuery.data}|{notificationQuery.data}
    </output>
  );
}

describe("ReviewsPage 真实交互", { timeout: 15_000 }, () => {
  let root: Root;
  let host: HTMLDivElement;
  let client: QueryClient;
  let details: Map<number, DocumentReviewDetail>;
  let previousSession: SessionData | null;
  let tasks: ReturnType<typeof vi.fn<() => Promise<number>>>;
  let notifications: ReturnType<typeof vi.fn<() => Promise<number>>>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    const getComputedStyle = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
      getComputedStyle(element),
    );
    previousSession = useUserStore.getState().session;
    useUserStore.setState({ session: session() });
    details = new Map([
      [41, review()],
      [42, review(42)],
    ]);
    vi.mocked(documentReviewsService.list).mockImplementation(async () => [
      ...details.values(),
    ]);
    vi.mocked(documentReviewsService.detail).mockImplementation(async (id) =>
      details.get(id)!,
    );
    vi.mocked(documentReviewsService.decide).mockImplementation(
      async (id, input) => {
        const result = {
          ...details.get(id)!,
          status:
            input.decision === "approve"
              ? ("approved" as const)
              : ("rejected" as const),
          taskId: input.decision === "approve" ? 90 : null,
          decisionComment: input.comment,
          decidedAt: "2026-10-11T12:00:00.000Z",
        };
        details.set(id, result);
        return result;
      },
    );
    tasks = vi.fn().mockResolvedValue(1);
    notifications = vi.fn().mockResolvedValue(1);
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      Modal.destroyAll();
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    host.remove();
    client.clear();
    useUserStore.setState({ session: previousSession });
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  /** 挂载真实页面、路由和查询缓存，不替换页面或 Ant Design 控件。 */
  async function mount(route = "/reviews?reviewId=41") {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[route]}>
            <Observers tasks={tasks} notifications={notifications} />
            <ReviewsPage />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
  }

  /** 推进真实 React 与查询通知队列，失败时报告原始断言。 */
  async function waitFor(check: () => void) {
    const deadline = Date.now() + 3_000;
    let failure: unknown;
    do {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      try {
        check();
        return;
      } catch (reason) {
        failure = reason;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    throw failure;
  }

  /** 按用户可见文案找按钮，忽略中文按钮自动添加的空格。 */
  function button(label: string): HTMLButtonElement {
    const result = [...document.body.querySelectorAll("button")].find(
      (item) =>
        item.textContent?.replace(/\s/g, "") === label.replace(/\s/g, ""),
    );
    if (!result) throw new Error(`找不到按钮：${label}`);
    return result;
  }

  /** 点击真实 DOM 元素，不调用组件内部回调。 */
  async function click(target: string | HTMLElement) {
    await act(async () => {
      (typeof target === "string" ? button(target) : target).click();
    });
  }

  /** 精确读取详情，避免列表中的相同标题造成假阳性。 */
  function detail() {
    return document.querySelector<HTMLElement>(
      'section[aria-label="评审详情"]',
    )!;
  }

  /** 选择真实评审卡片，等待它进入当前 URL。 */
  async function select(id: number) {
    const card = [
      ...document.querySelectorAll<HTMLButtonElement>(
        'section[aria-label="评审列表"] button',
      ),
    ].find(
      (item) => item.querySelector("strong")?.textContent === `评审任务 ${id}`,
    );
    if (!card) throw new Error(`找不到评审卡片：${id}`);
    await click(card);
    await waitFor(() =>
      expect(document.querySelector("output")?.textContent).toContain(
        `reviewId=${id}`,
      ),
    );
  }

  /** 用原生输入事件填写真实受控审批意见框。 */
  async function comment(value: string) {
    const input = detail().querySelector("textarea");
    if (!input) throw new Error("找不到审批意见输入框");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("三个范围触发 pending/submitted/all 请求，点卡片保留其他 URL 参数", async () => {
    await mount("/reviews?source=notification");
    await waitFor(() =>
      expect(document.body.textContent).toContain("评审任务 41"),
    );
    expect(documentReviewsService.list).toHaveBeenCalledExactlyOnceWith(
      "pending",
    );
    expect(documentReviewsService.detail).not.toHaveBeenCalled();
    for (const [label, scope] of [
      ["我发起的", "submitted"],
      ["全部参与", "all"],
    ]) {
      const segmented = [
        ...document.querySelectorAll<HTMLElement>(".ant-segmented-item"),
      ].find((item) => item.textContent === label)!;
      await click(segmented);
      await waitFor(() =>
        expect(documentReviewsService.list).toHaveBeenLastCalledWith(scope),
      );
    }
    await select(42);
    await waitFor(() =>
      expect(detail().querySelector("pre")?.textContent).toBe(
        review(42).version.text,
      ),
    );
    const route = new URL(
      document.querySelector("output")!.textContent!.split("|")[0],
      "http://localhost",
    );
    expect(route.pathname).toBe("/reviews");
    expect(route.searchParams.get("source")).toBe("notification");
    expect(route.searchParams.get("scope")).toBe("all");
    expect(route.searchParams.get("reviewId")).toBe("42");
    expect(documentReviewsService.decide).not.toHaveBeenCalled();
  });

  it("列表外 reviewId 深链接独立加载不可变标题和完整纯文本快照", async () => {
    vi.mocked(documentReviewsService.list).mockResolvedValue([]);
    await mount();
    await waitFor(() =>
      expect(detail().querySelector("pre")?.textContent).toBe(
        review().version.text,
      ),
    );
    expect(documentReviewsService.detail).toHaveBeenCalledExactlyOnceWith(41);
    expect(detail().textContent).toContain("提交时标题 41");
    expect(detail().querySelector("script")).toBeNull();
    expect(detail().textContent).toContain("发布群");
    expect(detail().textContent).toContain("负责人");
    expect(documentReviewsService.decide).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "abc", "9007199254740992"])(
    "无效深链接 %s 不查询不存在的评审",
    async (id) => {
      await mount(`/reviews?reviewId=${id}`);
      await waitFor(() =>
        expect(document.body.textContent).toContain("评审任务 41"),
      );
      expect(detail().textContent).toContain("选择评审查看提交版本和审批进度");
      expect(documentReviewsService.detail).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      status: "pending_review" as const,
      userId: 2,
      role: "member" as const,
      visible: true,
    },
    {
      status: "pending_review" as const,
      userId: 1,
      role: "owner" as const,
      visible: false,
    },
    {
      status: "pending_review" as const,
      userId: 3,
      role: "admin" as const,
      visible: false,
    },
    {
      status: "approved" as const,
      userId: 2,
      role: "member" as const,
      visible: false,
    },
    {
      status: "rejected" as const,
      userId: 2,
      role: "member" as const,
      visible: false,
    },
  ])(
    "审批入口仅 pending + 指定审批人可见：$status/$userId/$role",
    async ({ status, userId, role, visible }) => {
      details.set(41, review(41, status));
      useUserStore.setState({ session: session(userId, role) });
      await mount();
      await waitFor(() => expect(detail().querySelector("pre")).not.toBeNull());
      expect(detail().textContent?.includes("通过并建任务")).toBe(visible);
      expect(detail().textContent?.includes("驳回此评审")).toBe(false);
      expect(
        [...detail().querySelectorAll("button")].some(
          (item) => item.textContent?.replace(/\s/g, "") === "驳回",
        ),
      ).toBe(visible);
      expect(Boolean(detail().querySelector("textarea"))).toBe(visible);
      if (status === "pending_review" && !visible)
        expect(detail().textContent).toContain("只有指定审批人可操作");
      expect(documentReviewsService.decide).not.toHaveBeenCalled();
    },
  );

  it.each(["approve", "reject"] as const)(
    "%s 必须确认；失败保留意见和同一 key，重复点击不重复发送，成功刷新下游",
    async (decision) => {
      const pending = deferred<DocumentReviewDetail>();
      vi.mocked(documentReviewsService.decide).mockReturnValueOnce(
        pending.promise,
      );
      client.setQueryData(["document-reviews", "submitted"], []);
      client.setQueryData(["document-reviews", "all"], []);
      await mount();
      await waitFor(() => expect(detail().querySelector("pre")).not.toBeNull());
      await comment("  请按快照执行  ");
      const trigger = decision === "approve" ? "通过并建任务" : "驳回";
      const confirm = decision === "approve" ? "确认通过" : "确认驳回";
      await click(trigger);
      await waitFor(() => expect(button(confirm)).toBeDefined());
      expect(documentReviewsService.decide).not.toHaveBeenCalled();
      await click("取消");
      expect(documentReviewsService.decide).not.toHaveBeenCalled();
      await click(trigger);
      await waitFor(() => expect(button(confirm)).toBeDefined());
      await click(confirm);
      expect(documentReviewsService.decide).toHaveBeenCalledOnce();
      const first = vi.mocked(documentReviewsService.decide).mock.calls[0][1];
      expect(first).toEqual({
        decision,
        comment: "请按快照执行",
        requestKey: expect.any(String),
      });
      expect(first.requestKey).toMatch(/^[\da-f-]{36}$/i);
      await click(trigger);
      expect(documentReviewsService.decide).toHaveBeenCalledOnce();
      expect(button(trigger).disabled).toBe(true);
      await act(async () => pending.reject(new Error("审批请求超时")));
      await waitFor(() => {
        expect(detail().textContent).toContain("审批请求超时");
        expect(button(trigger).disabled).toBe(false);
      });
      expect(detail().querySelector("textarea")?.value).toBe(
        "  请按快照执行  ",
      );
      expect(tasks).toHaveBeenCalledOnce();
      expect(notifications).toHaveBeenCalledOnce();
      expect(message.success).not.toHaveBeenCalled();
      tasks.mockResolvedValue(2);
      notifications.mockResolvedValue(2);
      await click(trigger);
      await waitFor(() => expect(button(confirm)).toBeDefined());
      await click(confirm);
      await waitFor(() =>
        expect(detail().textContent).toContain(
          decision === "approve" ? "已通过" : "已驳回",
        ),
      );
      expect(documentReviewsService.decide).toHaveBeenCalledTimes(2);
      expect(vi.mocked(documentReviewsService.decide).mock.calls[1]).toEqual([
        41,
        first,
      ]);
      await waitFor(() => {
        expect(tasks).toHaveBeenCalledTimes(2);
        expect(notifications).toHaveBeenCalledTimes(2);
        expect(document.querySelector("output")?.textContent).toContain("|2|2");
      });
      expect(documentReviewsService.list).toHaveBeenCalledTimes(2);
      expect(
        client.getQueryState(["document-reviews", "submitted"])?.isInvalidated,
      ).toBe(true);
      expect(
        client.getQueryState(["document-reviews", "all"])?.isInvalidated,
      ).toBe(true);
      expect(detail().querySelector("textarea")).toBeNull();
      if (decision === "approve") {
        await click("查看自动创建的任务");
        expect(document.querySelector("output")?.textContent).toContain(
          "/tasks?taskId=90",
        );
      } else expect(detail().textContent).not.toContain("查看自动创建的任务");
    },
  );

  it("切换评审后旧详情迟到不覆盖新快照或新审批意见", async () => {
    const pending = deferred<DocumentReviewDetail>();
    vi.mocked(documentReviewsService.detail).mockReturnValueOnce(
      pending.promise,
    );
    await mount();
    await waitFor(() =>
      expect(document.body.textContent).toContain("评审任务 42"),
    );
    await select(42);
    await waitFor(() =>
      expect(detail().querySelector("pre")?.textContent).toBe(
        review(42).version.text,
      ),
    );
    await comment("新评审意见");
    await act(async () => pending.resolve(review()));
    await waitFor(() =>
      expect(client.getQueryData(["document-review", 41])).toEqual(review()),
    );
    expect(detail().querySelector("pre")?.textContent).toBe(
      review(42).version.text,
    );
    expect(detail().querySelector("textarea")?.value).toBe("新评审意见");
    expect(detail().textContent).not.toContain("提交时标题 41");
  });

  it("切换评审后旧审批成功只刷新旧详情，不清空新意见或误报新评审成功", async () => {
    const pending = deferred<DocumentReviewDetail>();
    vi.mocked(documentReviewsService.decide).mockReturnValueOnce(
      pending.promise,
    );
    await mount();
    await waitFor(() => expect(detail().querySelector("pre")).not.toBeNull());
    await click("通过并建任务");
    await waitFor(() => expect(button("确认通过")).toBeDefined());
    await click("确认通过");
    await select(42);
    await waitFor(() =>
      expect(detail().querySelector("pre")?.textContent).toBe(
        review(42).version.text,
      ),
    );
    await comment("保留新意见");
    await act(async () => pending.resolve(review(41, "approved")));
    await waitFor(() => expect(tasks).toHaveBeenCalledTimes(2));
    expect(detail().querySelector("pre")?.textContent).toBe(
      review(42).version.text,
    );
    expect(detail().querySelector("textarea")?.value).toBe("保留新意见");
    expect(button("通过并建任务").disabled).toBe(false);
    expect(message.success).not.toHaveBeenCalled();
    expect(client.getQueryState(["document-review", 41])?.isInvalidated).toBe(
      true,
    );
  });
});
