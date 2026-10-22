// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Modal, message } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CloudDocument,
  DocumentReview,
  DocumentReviewOptions,
} from "@chat/shared";
import DocumentReviewModal from "./DocumentReviewModal";
import DocumentsPage from "../index";
import { documentReviewsService } from "../../../services/document-reviews";
import { documentsService } from "../../../services/documents";

vi.mock("../../../services/document-reviews", () => ({
  documentReviewsService: { options: vi.fn(), submit: vi.fn() },
}));
vi.mock("antd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("antd")>()),
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

/** 创建字段完整的文档样本，以同一页面验证 editor 与 viewer 入口。 */
function cloudDocument(
  id = 7,
  permission: CloudDocument["permission"] = "editor",
): CloudDocument {
  return {
    id,
    permission,
    companyId: 1,
    ownerId: 1,
    title: `文档 ${id}`,
    type: "doc",
    icon: "",
    color: "#1677ff",
    favorite: false,
    members: [],
    createdAt: "2026-10-10T12:00:00.000Z",
    updatedAt: "2026-10-10T12:00:00.000Z",
  };
}

/** 两个群包含互不重叠的成员，用来发现群切换后残留的审批人和负责人。 */
function options(): DocumentReviewOptions {
  return {
    groups: [
      {
        id: 8,
        name: "发布群",
        members: [
          { id: 2, name: "林审批", avatar: "林" },
          { id: 3, name: "陈负责人", avatar: "陈" },
        ],
      },
      {
        id: 9,
        name: "研发群",
        members: [
          { id: 4, name: "王审批", avatar: "王" },
          { id: 5, name: "赵负责人", avatar: "赵" },
        ],
      },
    ],
  };
}

/** 创建真实提交成功契约，文档标识随提交的文档变化。 */
function submitted(documentId = 7): DocumentReview {
  return {
    id: 41,
    documentId,
    documentVersionId: 141,
    documentTitle: `文档 ${documentId}`,
    conversationId: 8,
    conversationName: "发布群",
    submitterId: 1,
    approverId: 2,
    assigneeId: 3,
    submitter: { id: 1, name: "发起者", avatar: "发" },
    approver: { id: 2, name: "林审批", avatar: "林" },
    assignee: { id: 3, name: "陈负责人", avatar: "陈" },
    title: "评审任务",
    dueAt: "2026-11-01T12:30:00.000Z",
    status: "pending_review",
    taskId: null,
    decisionComment: "",
    decidedAt: null,
    createdAt: "2026-10-11T12:00:00.000Z",
  };
}

/** 控制请求完成时间，验证加载态、双击和切换文档竞态。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("DocumentReviewModal 真实交互", { timeout: 15_000 }, () => {
  let root: Root;
  let host: HTMLDivElement;
  let client: QueryClient;
  let onClose: ReturnType<typeof vi.fn>;
  let onSubmitted: ReturnType<typeof vi.fn>;

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
    vi.mocked(documentReviewsService.options).mockResolvedValue(options());
    vi.mocked(documentReviewsService.submit).mockResolvedValue(submitted());
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    onClose = vi.fn();
    onSubmitted = vi.fn();
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
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  /** 在同一根节点切换文档，保留真实 React 生命周期与查询缓存。 */
  async function renderDocument(value: CloudDocument | null = cloudDocument()) {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <DocumentReviewModal
            document={value}
            onClose={onClose}
            onSubmitted={onSubmitted}
          />
        </QueryClientProvider>,
      ),
    );
  }

  /** 等待表单验证、查询通知与真实浮层完成，不吞掉失败断言。 */
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

  /** 从真实按钮文案定位点击目标，兼容中文按钮自动添加的空格。 */
  function button(label: string): HTMLButtonElement {
    const target = [...document.body.querySelectorAll("button")].find(
      (item) =>
        item.textContent?.replace(/\s/g, "") === label.replace(/\s/g, ""),
    );
    if (!target) throw new Error(`找不到按钮：${label}`);
    return target;
  }

  /** 点击用户可操作的真实 DOM 元素，不直接调用 onFinish。 */
  async function click(target: string | HTMLElement) {
    await act(async () => {
      (typeof target === "string" ? button(target) : target).click();
    });
  }

  /** 获取带可访问名称的真实表单输入框。 */
  function input(label: string): HTMLInputElement {
    const target = document.body.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    );
    if (!target) throw new Error(`找不到输入框：${label}`);
    return target;
  }

  /** 原生输入事件更新受控字段，避免绕过表单校验和控件状态。 */
  async function type(label: string, value: string) {
    await act(async () => {
      const target = input(label);
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(target, value);
      target.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /** 打开真实 Select 浮层，从当前可见成员列表中选择选项。 */
  async function choose(label: string, text: string) {
    await act(async () => {
      const target = input(label).closest<HTMLElement>(".ant-select")!;
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    let option: HTMLElement | undefined;
    await waitFor(() => {
      option = [
        ...document.body.querySelectorAll<HTMLElement>(
          ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option",
        ),
      ].find((item) => item.textContent === text);
      expect(option).toBeDefined();
    });
    await click(option!);
    await waitFor(() =>
      expect(input(label).closest(".ant-select")?.textContent).toContain(text),
    );
  }

  /** 在真实日期时间选择器输入确定的本地时间，并使用它的确认按钮提交。 */
  async function dueDate() {
    await click(input("任务截止时间"));
    await type("任务截止时间", "2026-11-01 20:30:00");
    let confirm: HTMLButtonElement | null = null;
    await waitFor(() => {
      confirm = document.body.querySelector<HTMLButtonElement>(
        ".ant-picker-dropdown:not(.ant-picker-dropdown-hidden) .ant-picker-ok button",
      );
      expect(confirm).not.toBeNull();
      expect(confirm!.disabled).toBe(false);
    });
    await click(confirm!);
    await waitFor(() =>
      expect(input("任务截止时间").value).toBe("2026-11-01 20:30:00"),
    );
  }

  /** 完成用户能实际操作的全部必填字段，不调用 Form 实例设置值。 */
  async function fill(title = "  发布跟进  ") {
    await waitFor(() => expect(input("任务标题").value).toBe("跟进：文档 7"));
    await type("任务标题", title);
    await choose("关联群聊", "发布群");
    await choose("指定审批人", "林审批");
    await choose("任务负责人", "陈负责人");
    await dueDate();
    expect(documentReviewsService.submit).not.toHaveBeenCalled();
  }

  it("候选加载中仅显示骨架，完成后展示默认标题与待选成员", async () => {
    const pending = deferred<DocumentReviewOptions>();
    vi.mocked(documentReviewsService.options).mockReturnValueOnce(
      pending.promise,
    );
    await renderDocument();
    expect(documentReviewsService.options).toHaveBeenCalledExactlyOnceWith(7);
    expect(document.body.querySelector(".ant-skeleton")).not.toBeNull();
    expect(document.body.querySelector("form")).toBeNull();
    await act(async () => pending.resolve(options()));
    await waitFor(() => expect(input("任务标题").value).toBe("跟进：文档 7"));
    expect(input("指定审批人").disabled).toBe(true);
    expect(input("任务负责人").disabled).toBe(true);
    expect(documentReviewsService.submit).not.toHaveBeenCalled();
  });

  it("候选加载失败展示错误，重试后恢复表单，不误显示空群提示", async () => {
    vi.mocked(documentReviewsService.options).mockRejectedValueOnce(
      new Error("候选成员加载失败"),
    );
    await renderDocument();
    await waitFor(() =>
      expect(document.body.textContent).toContain("候选成员加载失败"),
    );
    expect(document.body.textContent).not.toContain("暂无可关联的群聊");
    expect(document.body.querySelector("form")).toBeNull();
    await click("重试");
    await waitFor(() => expect(input("任务标题").value).toBe("跟进：文档 7"));
    expect(documentReviewsService.options).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain("候选成员加载失败");
  });

  it("空候选只展示共享提示，没有可以提交的表单", async () => {
    vi.mocked(documentReviewsService.options).mockResolvedValue({ groups: [] });
    await renderDocument();
    await waitFor(() =>
      expect(document.body.textContent).toContain("暂无可关联的群聊"),
    );
    expect(document.body.textContent).toContain("请先加入企业群聊");
    expect(document.body.querySelector("form")).toBeNull();
    expect(document.body.textContent).not.toContain("提交评审");
    expect(documentReviewsService.submit).not.toHaveBeenCalled();
  });

  it("空白标题与所有未选必填项阻止提交并展示逐项校验信息", async () => {
    await renderDocument();
    await waitFor(() => expect(input("任务标题")).toBeDefined());
    await type("任务标题", "   ");
    await click("提交评审");
    await waitFor(() => {
      for (const error of [
        "请输入任务标题",
        "请选择群聊",
        "请选择审批人",
        "请选择负责人",
        "请选择截止时间",
      ]) {
        expect(document.body.textContent).toContain(error);
      }
    });
    expect(documentReviewsService.submit).not.toHaveBeenCalled();
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("切换群聊重置两个人员字段且新列表不包含旧群成员", async () => {
    await renderDocument();
    await waitFor(() => expect(input("任务标题")).toBeDefined());
    await choose("关联群聊", "发布群");
    await choose("指定审批人", "林审批");
    await choose("任务负责人", "陈负责人");
    await choose("关联群聊", "研发群");
    expect(
      input("指定审批人").closest(".ant-select")?.textContent,
    ).not.toContain("林审批");
    expect(
      input("任务负责人").closest(".ant-select")?.textContent,
    ).not.toContain("陈负责人");
    await click("提交评审");
    await waitFor(() => {
      expect(document.body.textContent).toContain("请选择审批人");
      expect(document.body.textContent).toContain("请选择负责人");
    });
    expect(documentReviewsService.submit).not.toHaveBeenCalled();
    await choose("指定审批人", "王审批");
    await choose("任务负责人", "赵负责人");
    const dropdowns = [
      ...document.body.querySelectorAll(".ant-select-dropdown"),
    ]
      .map((item) => item.textContent)
      .join("|");
    expect(dropdowns).not.toContain("林审批");
    expect(dropdowns).not.toContain("陈负责人");
  });

  it("真实选择和提交修剪标题，失败保留表单及幂等键，重试成功刷新列表/版本/通知", async () => {
    const pending = deferred<DocumentReview>();
    vi.mocked(documentReviewsService.submit).mockReturnValueOnce(
      pending.promise,
    );
    client.setQueryData(["document-reviews", "pending"], []);
    client.setQueryData(["document-versions", 7], []);
    client.setQueryData(["document-versions", 10], []);
    client.setQueryData(["notifications"], []);
    await renderDocument();
    await fill();
    const expectedDueAt = new Date(2026, 10, 1, 20, 30, 0).toISOString();
    await click("提交评审");
    await waitFor(() =>
      expect(documentReviewsService.submit).toHaveBeenCalledOnce(),
    );
    const first = vi.mocked(documentReviewsService.submit).mock.calls[0][0];
    expect(first).toEqual({
      documentId: 7,
      conversationId: 8,
      approverId: 2,
      assigneeId: 3,
      title: "发布跟进",
      dueAt: expectedDueAt,
      requestKey: expect.any(String),
    });
    expect(first.requestKey).toMatch(/^[\da-f-]{36}$/i);
    expect(input("任务标题").disabled).toBe(true);
    expect(button("取消").disabled).toBe(true);
    await click("提交评审");
    expect(documentReviewsService.submit).toHaveBeenCalledOnce();
    await act(async () => pending.reject(new Error("提交请求超时")));
    await waitFor(() =>
      expect(document.body.textContent).toContain("提交请求超时"),
    );
    expect(input("任务标题").value).toBe("  发布跟进  ");
    expect(input("指定审批人").closest(".ant-select")?.textContent).toContain(
      "林审批",
    );
    expect(input("任务负责人").closest(".ant-select")?.textContent).toContain(
      "陈负责人",
    );
    expect(input("任务截止时间").value).toBe("2026-11-01 20:30:00");
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(message.success).not.toHaveBeenCalled();
    expect(client.getQueryState(["notifications"])?.isInvalidated).toBe(false);
    await click("提交评审");
    await waitFor(() =>
      expect(onSubmitted).toHaveBeenCalledExactlyOnceWith(submitted()),
    );
    expect(documentReviewsService.submit).toHaveBeenCalledTimes(2);
    expect(vi.mocked(documentReviewsService.submit).mock.calls[1][0]).toEqual(
      first,
    );
    expect(
      client.getQueryState(["document-reviews", "pending"])?.isInvalidated,
    ).toBe(true);
    expect(client.getQueryState(["document-versions", 7])?.isInvalidated).toBe(
      true,
    );
    expect(client.getQueryState(["document-versions", 10])?.isInvalidated).toBe(
      false,
    );
    expect(client.getQueryState(["notifications"])?.isInvalidated).toBe(true);
  });

  it("失败后改变内容生成新请求键，而不是误复用旧提交结果", async () => {
    vi.mocked(documentReviewsService.submit).mockRejectedValueOnce(
      new Error("提交失败"),
    );
    await renderDocument();
    await fill();
    await click("提交评审");
    await waitFor(() =>
      expect(document.body.textContent).toContain("提交失败"),
    );
    const first = vi.mocked(documentReviewsService.submit).mock.calls[0][0];
    await type("任务标题", "更新后的任务");
    await click("提交评审");
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());
    const second = vi.mocked(documentReviewsService.submit).mock.calls[1][0];
    expect(second.title).toBe("更新后的任务");
    expect(second.requestKey).not.toBe(first.requestKey);
  });

  it("切换文档与关闭重开都不继承草稿、成员或错误状态", async () => {
    vi.mocked(documentReviewsService.submit).mockRejectedValueOnce(
      new Error("旧文档提交失败"),
    );
    await renderDocument();
    await fill();
    await click("提交评审");
    await waitFor(() =>
      expect(document.body.textContent).toContain("旧文档提交失败"),
    );
    await renderDocument(cloudDocument(10));
    await waitFor(() => expect(input("任务标题").value).toBe("跟进：文档 10"));
    expect(input("指定审批人").disabled).toBe(true);
    expect(input("任务负责人").disabled).toBe(true);
    expect(input("任务截止时间").value).toBe("");
    expect(document.body.textContent).not.toContain("旧文档提交失败");
    await click("取消");
    expect(onClose).toHaveBeenCalledOnce();
    await renderDocument(null);
    expect(document.body.querySelector("form")).toBeNull();
    await renderDocument();
    await waitFor(() => expect(input("任务标题").value).toBe("跟进：文档 7"));
    expect(input("指定审批人").disabled).toBe(true);
    expect(input("任务截止时间").value).toBe("");
    expect(document.body.textContent).not.toContain("旧文档提交失败");
  });

  it("旧文档候选迟到不覆盖新文档的群聊", async () => {
    const pending = deferred<DocumentReviewOptions>();
    vi.mocked(documentReviewsService.options).mockReturnValueOnce(
      pending.promise,
    );
    await renderDocument();
    await renderDocument(cloudDocument(10));
    await waitFor(() => expect(input("任务标题").value).toBe("跟进：文档 10"));
    await act(async () =>
      pending.resolve({
        groups: [{ id: 99, name: "旧文档专属群", members: [] }],
      }),
    );
    await waitFor(() =>
      expect(client.getQueryData(["document-review-options", 7])).toEqual({
        groups: [{ id: 99, name: "旧文档专属群", members: [] }],
      }),
    );
    await choose("关联群聊", "研发群");
    expect(document.body.textContent).not.toContain("旧文档专属群");
    expect(input("任务标题").value).toBe("跟进：文档 10");
  });

  it("旧提交迟到只刷新原文档版本，不关闭新弹窗或触发新文档成功回调", async () => {
    const pending = deferred<DocumentReview>();
    vi.mocked(documentReviewsService.submit).mockReturnValueOnce(
      pending.promise,
    );
    client.setQueryData(["document-versions", 7], []);
    client.setQueryData(["document-versions", 10], []);
    await renderDocument();
    await fill();
    await click("提交评审");
    await waitFor(() =>
      expect(documentReviewsService.submit).toHaveBeenCalledOnce(),
    );
    await renderDocument(cloudDocument(10));
    await waitFor(() => expect(input("任务标题").value).toBe("跟进：文档 10"));
    await type("任务标题", "新文档草稿");
    await act(async () => pending.resolve(submitted()));
    await waitFor(() =>
      expect(
        client.getQueryState(["document-versions", 7])?.isInvalidated,
      ).toBe(true),
    );
    expect(client.getQueryState(["document-versions", 10])?.isInvalidated).toBe(
      false,
    );
    expect(input("任务标题").value).toBe("新文档草稿");
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(message.success).not.toHaveBeenCalled();
  });

  it.each(["viewer", "editor", "owner"] as const)(
    "真实文档菜单的 %s 权限入口正确，viewer 无提交入口",
    async (permission) => {
      vi.spyOn(documentsService, "list").mockResolvedValue([
        cloudDocument(7, permission),
      ]);
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <MemoryRouter>
              <DocumentsPage />
            </MemoryRouter>
          </QueryClientProvider>,
        ),
      );
      let menu: HTMLButtonElement | undefined;
      await waitFor(() => {
        const row = document.body.querySelector('tr[data-row-key="7"]');
        menu = [...(row?.querySelectorAll("button") ?? [])].at(-1);
        expect(menu).toBeDefined();
      });
      await click(menu!);
      await waitFor(() =>
        expect(document.body.querySelector('[role="menu"]')).not.toBeNull(),
      );
      const items = [
        ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ];
      const entry = items.find((item) => item.textContent === "提交评审");
      expect(Boolean(entry)).toBe(permission !== "viewer");
      expect(documentReviewsService.options).not.toHaveBeenCalled();
      if (permission !== "viewer") {
        await click(entry!);
        await waitFor(() =>
          expect(input("任务标题").value).toBe("跟进：文档 7"),
        );
        expect(documentReviewsService.options).toHaveBeenCalledExactlyOnceWith(
          7,
        );
      }
      expect(documentReviewsService.submit).not.toHaveBeenCalled();
    },
  );
});
