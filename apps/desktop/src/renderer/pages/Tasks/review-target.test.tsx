// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { Modal } from "antd";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";
import type { InternalAxiosRequestConfig } from "axios";
import type { SessionData, Task } from "@chat/shared";
import TasksPage from "./index";
import { tasksService } from "../../services/tasks";
import { organizationService } from "../../services/organization";
import { httpClient } from "../../services/request";
import { useUserStore } from "../../stores/user-store";

vi.mock("../../services/tasks", () => ({
  tasksService: {
    list: vi.fn(),
    detail: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock("../../services/organization", () => ({
  organizationService: { users: vi.fn() },
}));
vi.mock("antd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("antd")>()),
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

/** 审批人既非创建者也非负责人，目标故意不属于其 mine 列表。 */
function task(id = 90, status: Task["status"] = "todo"): Task {
  return {
    id,
    status,
    companyId: 1,
    creatorId: 1,
    assigneeId: 3,
    conversationId: 8,
    messageId: null,
    title: `审批关联任务 ${id}`,
    priority: "normal",
    dueAt: "2026-11-01T12:00:00.000Z",
    completedAt: status === "done" ? "2026-10-11T12:00:00.000Z" : null,
    creator: { id: 1, name: "发起者", avatar: "发" },
    assignee: { id: 3, name: "负责人", avatar: "负" },
    createdAt: "2026-10-10T12:00:00.000Z",
    updatedAt: "2026-10-10T12:00:00.000Z",
  };
}

/** 构造仅在内存使用的会话，以创建者、负责人和审批人检验权限。 */
function session(id = 2): SessionData {
  return {
    company: { id: 1, name: "测试企业", code: "TEST", ownerId: 1 },
    user: {
      id,
      role: "member",
      companyId: 1,
      departmentId: null,
      phone: "",
      name: `成员 ${id}`,
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

/** 人为延迟旧目标请求，确定性复现同一页面的目标切换。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** 使用真实路由切换目标或离开深链接，不重新挂载任务页面。 */
function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output>
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => navigate("/tasks?taskId=91&source=review")}>
        切换目标任务
      </button>
      <button onClick={() => navigate("/tasks")}>返回我的任务</button>
    </>
  );
}

describe("审批关联任务深链接", { timeout: 15_000 }, () => {
  let root: Root;
  let host: HTMLDivElement;
  let client: QueryClient;
  let mine: Task;
  let targets: Map<number, Task>;
  let previousSession: SessionData | null;
  let previousScroll: PropertyDescriptor | undefined;

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
    previousScroll = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    previousSession = useUserStore.getState().session;
    useUserStore.setState({ session: session() });
    mine = {
      ...task(12),
      title: "我自己的任务",
      creatorId: 2,
      assigneeId: 2,
      creator: { id: 2, name: "审批人", avatar: "审" },
      assignee: { id: 2, name: "审批人", avatar: "审" },
    };
    targets = new Map([
      [90, task()],
      [91, task(91)],
    ]);
    vi.mocked(tasksService.list).mockResolvedValue([mine]);
    vi.mocked(tasksService.detail).mockImplementation(async (id) =>
      targets.get(id)!,
    );
    vi.mocked(tasksService.update).mockImplementation(async (id, input) => {
      const result = { ...targets.get(id)!, ...input };
      targets.set(id, result);
      return result;
    });
    vi.mocked(organizationService.users).mockResolvedValue([
      session(1).user,
      session(2).user,
      session(3).user,
    ]);
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
    if (previousScroll)
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        previousScroll,
      );
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  /** 挂载真实任务页面和 Ant Design 控件，服务仅隔离网络边界。 */
  async function mount(route = "/tasks?taskId=90&source=review") {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[route]}>
            <Navigation />
            <TasksPage />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
  }

  /** 串行推进更新队列，避免异步 act 重入并保留原始失败断言。 */
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

  /** 精确找到指定任务卡片，防止用其他 mine 任务的按钮判断权限。 */
  function card(title: string): HTMLElement {
    const result = [...document.querySelectorAll("article")].find(
      (item) => item.querySelector("strong")?.textContent === title,
    );
    if (!result) throw new Error(`找不到任务卡片：${title}`);
    return result;
  }

  /** 使用可访问名称获取目标卡片内的真实动作按钮。 */
  function action(target: HTMLElement, label: string): HTMLButtonElement {
    const result = target.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    if (!result) throw new Error(`找不到任务动作：${label}`);
    return result;
  }

  /** 在 React 更新范围内点击真实按钮。 */
  async function click(target: HTMLElement) {
    await act(async () => target.click());
  }

  /** 以界面文案定位路由或弹窗按钮，兼容中文按钮空格。 */
  function button(label: string): HTMLButtonElement {
    const result = [...document.body.querySelectorAll("button")].find(
      (item) =>
        item.textContent?.replace(/\s/g, "") === label.replace(/\s/g, ""),
    );
    if (!result) throw new Error(`找不到按钮：${label}`);
    return result;
  }

  it("非 mine 审批目标补查后可见且高亮，推进/编辑禁用而自己的任务仍可操作", async () => {
    await mount();
    await waitFor(() =>
      expect(card(task().title).dataset.searchHighlighted).toBe("true"),
    );
    expect(tasksService.list).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(tasksService.detail).toHaveBeenCalledExactlyOnceWith(90);
    expect(client.getQueryData(["tasks", "all"])).toEqual([mine]);
    expect(card(task().title).textContent).toContain("负责人：负责人");
    expect(card(task().title).className).toContain("ring-2");
    for (const label of ["推进任务", "编辑任务"]) {
      expect(action(card(task().title), label).disabled).toBe(true);
      await click(action(card(task().title), label));
      expect(action(card(mine.title), label).disabled).toBe(false);
    }
    expect(
      card(task().title).querySelector('[aria-label="删除任务"]'),
    ).toBeNull();
    expect(tasksService.update).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: "center",
    });
    await click(button("返回我的任务"));
    await waitFor(() =>
      expect(document.body.textContent).not.toContain(task().title),
    );
    expect(card(mine.title)).toBeDefined();
    expect(
      document.body.querySelector('[data-search-highlighted="true"]'),
    ).toBeNull();
    expect(client.getQueryData(["tasks", "all"])).toEqual([mine]);
  });

  it("目标已在 mine 列表中时只显示一张卡片", async () => {
    vi.mocked(tasksService.list).mockResolvedValue([task()]);
    await mount();
    await waitFor(() =>
      expect(card(task().title).dataset.searchHighlighted).toBe("true"),
    );
    expect(
      [...document.querySelectorAll("article strong")].filter(
        (item) => item.textContent === task().title,
      ),
    ).toHaveLength(1);
    expect(tasksService.detail).toHaveBeenCalledExactlyOnceWith(90);
  });

  it("补查失败明确展示权限错误，保留 mine 列表且不伪造目标或动作", async () => {
    vi.mocked(tasksService.detail).mockRejectedValueOnce(
      new Error("无权访问此审批关联任务"),
    );
    await mount();
    await waitFor(() =>
      expect(document.body.querySelector(".ant-alert")?.textContent).toContain(
        "无权访问此审批关联任务",
      ),
    );
    expect(tasksService.detail).toHaveBeenCalledExactlyOnceWith(90);
    expect(card(mine.title)).toBeDefined();
    expect(document.body.textContent).not.toContain(task().title);
    expect(
      document.body.querySelector('[data-search-highlighted="true"]'),
    ).toBeNull();
    expect(tasksService.update).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"] as const)(
    "旧目标 %s 响应迟到不污染新目标的卡片、高亮或错误",
    async (result) => {
      const pending = deferred<Task>();
      vi.mocked(tasksService.detail).mockReturnValueOnce(pending.promise);
      await mount();
      await waitFor(() => expect(card(mine.title)).toBeDefined());
      await click(button("切换目标任务"));
      await waitFor(() =>
        expect(card(task(91).title).dataset.searchHighlighted).toBe("true"),
      );
      expect(tasksService.detail).toHaveBeenLastCalledWith(91);
      await act(async () => {
        if (result === "success") pending.resolve(task());
        else pending.reject(new Error("旧目标无访问权限"));
      });
      await waitFor(() => {
        if (result === "success")
          expect(client.getQueryData(["tasks", "target", 90])).toEqual(task());
        else
          expect(client.getQueryState(["tasks", "target", 90])?.status).toBe(
            "error",
          );
      });
      expect(document.body.textContent).not.toContain(task().title);
      expect(document.body.textContent).not.toContain("旧目标无访问权限");
      expect(card(task(91).title).dataset.searchHighlighted).toBe("true");
      expect(
        document.body.querySelectorAll('[data-search-highlighted="true"]'),
      ).toHaveLength(1);
      expect(client.getQueryData(["tasks", "all"])).toEqual([mine]);
    },
  );

  it.each([1, 3])(
    "原创建者/负责人 %s 仍可推进并通过真实编辑弹窗保存",
    async (userId) => {
      useUserStore.setState({ session: session(userId) });
      vi.mocked(tasksService.list).mockImplementation(async () => [
        targets.get(90)!,
      ]);
      await mount();
      await waitFor(() => expect(card(task().title)).toBeDefined());
      expect(action(card(task().title), "推进任务").disabled).toBe(false);
      expect(action(card(task().title), "编辑任务").disabled).toBe(false);
      expect(
        Boolean(card(task().title).querySelector('[aria-label="删除任务"]')),
      ).toBe(userId === 1);
      await click(action(card(task().title), "推进任务"));
      await waitFor(() =>
        expect(tasksService.update).toHaveBeenCalledExactlyOnceWith(90, {
          status: "in_progress",
        }),
      );
      await waitFor(() =>
        expect(card(task().title).textContent).toContain("进行中"),
      );
      await click(action(card(task().title), "编辑任务"));
      const dialog =
        document.body.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog).not.toBeNull();
      expect(
        dialog.querySelector<HTMLInputElement>('[role="combobox"]')?.disabled,
      ).toBe(userId !== 1);
      const text = dialog.querySelector<HTMLTextAreaElement>(
        '[aria-label="编辑任务标题"]',
      )!;
      expect(text).not.toBeNull();
      for (const label of ["任务负责人", "编辑任务优先级", "编辑任务截止时间"])
        expect(dialog.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(text, "  更新后的任务标题  ");
        text.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await click(button("保存"));
      await waitFor(() => expect(tasksService.update).toHaveBeenCalledTimes(2));
      expect(vi.mocked(tasksService.update).mock.calls[1]).toEqual([
        90,
        {
          title: "更新后的任务标题",
          assigneeId: 3,
          priority: "normal",
          dueAt: "2026-11-01T12:00:00.000Z",
        },
      ]);
      await waitFor(() => expect(card("更新后的任务标题")).toBeDefined());
    },
  );

  it("任务补查 service 使用 GET /api/tasks/:id 并返回 Task 类型", async () => {
    const actual = await vi.importActual<typeof import("../../services/tasks")>(
      "../../services/tasks",
    );
    const previousAdapter = httpClient.defaults.adapter;
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ({
      data: { success: true, data: task() },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    }));
    try {
      httpClient.defaults.adapter = adapter;
      expect(await actual.tasksService.detail(90)).toEqual(task());
      expect(adapter.mock.calls[0][0]).toMatchObject({
        url: "/api/tasks/90",
        method: "get",
      });
      expectTypeOf(actual.tasksService.detail).parameters.toEqualTypeOf<
        [number]
      >();
      expectTypeOf(actual.tasksService.detail).returns.toEqualTypeOf<
        Promise<Task>
      >();
    } finally {
      httpClient.defaults.adapter = previousAdapter;
    }
  });
});
