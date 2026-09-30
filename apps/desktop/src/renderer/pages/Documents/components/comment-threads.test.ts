// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudDocument, DocumentComment } from "@chat/shared";
import { queryKeys } from "../../../constants/query-keys";
import { documentsService } from "../../../services/documents";
import DocumentCommentsModal from "./DocumentCommentsModal";
import { buildCommentThreads } from "./comment-threads";

vi.mock("../../../services/documents", () => ({
  documentsService: {
    comments: vi.fn(),
    createComment: vi.fn(),
    updateComment: vi.fn(),
  },
}));

vi.mock("antd", async (importOriginal) => ({
  ...await importOriginal<typeof import("antd")>(),
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

/** 创建字段完整的评论样本，可覆盖旧数据的父引用与解决状态。 */
function comment(id: number, overrides: Partial<DocumentComment> = {}): DocumentComment {
  return {
    id,
    documentId: 1,
    parentId: null,
    anchor: null,
    content: `评论 ${id}`,
    authorId: 1,
    author: { id: 1, name: "林远", avatar: "林" },
    resolved: false,
    resolvedAt: null,
    resolvedById: null,
    createdAt: `2026-09-30T10:00:0${id}.000Z`,
    updatedAt: "2026-09-30T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildCommentThreads", () => {
  it("将乱序的根评论、直接回复和旧版嵌套回复归入同一线程", () => {
    const comments = [
      comment(3, { parentId: 2 }),
      comment(4),
      comment(2, { parentId: 1 }),
      comment(1),
    ];
    const threads = buildCommentThreads(comments);
    expect(threads.map(({ root, replies }) => [root.id, replies.map((reply) => reply.id)]))
      .toEqual([[1, [2, 3]], [4, []]]);
    expect(comments.map((item) => item.id)).toEqual([3, 4, 2, 1]);
  });

  it("只按根评论状态筛选，保留状态不同步的历史回复", () => {
    const comments = [
      comment(1, { resolved: true }),
      comment(2, { parentId: 1 }),
      comment(3),
      comment(4, { parentId: 3, resolved: true }),
    ];
    expect(buildCommentThreads(comments, "resolved").map(({ root, replies }) =>
      [root.id, replies.map((reply) => reply.id)],
    )).toEqual([[1, [2]]]);
    expect(buildCommentThreads(comments, "unresolved").map(({ root, replies }) =>
      [root.id, replies.map((reply) => reply.id)],
    )).toEqual([[3, [4]]]);
    expect(buildCommentThreads(comments, "all")).toHaveLength(2);
  });

  it("父评论缺失时展示孤立评论并保留其后续回复", () => {
    const threads = buildCommentThreads([
      comment(2, { parentId: 1 }),
      comment(3, { parentId: 2 }),
    ]);
    expect(threads.map(({ root, replies }) => [root.id, replies.map((reply) => reply.id)]))
      .toEqual([[2, [3]]]);
  });

  it("循环父引用不会丢评论或无限递归，归组结果不受输入顺序影响", () => {
    const comments = [
      comment(3, { parentId: 2 }),
      comment(2, { parentId: 1 }),
      comment(1, { parentId: 2 }),
      comment(4, { parentId: 4 }),
    ];
    const threads = buildCommentThreads(comments);
    expect(threads.map(({ root, replies }) => [root.id, replies.map((reply) => reply.id)]))
      .toEqual([[1, [2, 3]], [4, []]]);
    expect(buildCommentThreads([...comments].reverse())).toEqual(threads);
  });

  it("回复按时间和 ID 排序，空数据返回空线程", () => {
    const threads = buildCommentThreads([
      comment(3, { parentId: 1, createdAt: "2026-09-30T09:00:00.000Z" }),
      comment(2, { parentId: 1, createdAt: "2026-09-30T09:00:00.000Z" }),
      comment(1),
    ]);
    expect(threads[0].replies.map((reply) => reply.id)).toEqual([2, 3]);
    expect(buildCommentThreads([])).toEqual([]);
  });
});

/** 创建弹窗所需的文档样本。 */
function cloudDocument(id: number): CloudDocument {
  return {
    id,
    companyId: 1,
    ownerId: 1,
    title: `文档 ${id}`,
    type: "doc",
    icon: "",
    color: "",
    permission: "owner",
    favorite: false,
    members: [],
    createdAt: "2026-09-30T10:00:00.000Z",
    updatedAt: "2026-09-30T10:00:00.000Z",
  };
}

describe("DocumentCommentsModal", () => {
  let host: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  let commentsByDocument: Map<number, DocumentComment[]>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })));
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const getComputedStyle = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
    commentsByDocument = new Map([
      [1, [comment(1), comment(2, { parentId: 1 })]],
      [2, [comment(3, { documentId: 2 })]],
    ]);
    vi.mocked(documentsService.comments).mockImplementation(async (id) => commentsByDocument.get(id) ?? []);
    vi.mocked(documentsService.createComment).mockResolvedValue(comment(5));
    vi.mocked(documentsService.updateComment).mockResolvedValue(comment(1, { resolved: true }));
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    commentsByDocument.forEach((comments, id) => client.setQueryData(queryKeys.documentComments(id), comments));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  /** 使用真实 React 与查询缓存切换文档，验证组件对用户操作的响应。 */
  async function renderDocument(value: CloudDocument | null = cloudDocument(1)) {
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client },
        createElement(DocumentCommentsModal, { document: value, onClose: vi.fn() }),
      ));
    });
  }

  /** 从弹窗中按可见文案寻找按钮。 */
  function button(label: string, index = 0): HTMLButtonElement {
    const buttons = [...document.body.querySelectorAll("button")]
      .filter((item) => item.textContent?.replace(/\s/g, "") === label);
    const target = buttons[index];
    if (!target) throw new Error(`找不到按钮：${label}`);
    return target;
  }

  /** 在 React 更新范围内点击真实控件。 */
  async function click(label: string, index = 0) {
    await act(async () => {
      button(label, index).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  /** 获取当前弹窗的评论输入框。 */
  function textarea(): HTMLTextAreaElement {
    const target = document.body.querySelector("textarea");
    if (!target) throw new Error("找不到评论输入框");
    return target;
  }

  /** 通过原生输入事件更新受控草稿，不直接调用组件内部状态。 */
  async function typeContent(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), value);
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /** 按筛选控件可见文案切换线程状态。 */
  async function selectFilter(label: string) {
    await act(async () => {
      const option = [...document.body.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
        .find((item) => item.closest("label")?.textContent === label);
      if (!option) throw new Error(`找不到筛选项：${label}`);
      option.click();
    });
  }

  it("按线程展示作者、内容和时间，保留三行输入框与原有按钮高度", async () => {
    await renderDocument();
    expect(document.body.querySelectorAll("article")).toHaveLength(1);
    expect(document.body.querySelector("article")?.textContent).toContain("评论 1");
    expect(document.body.querySelector("article")?.textContent).toContain("评论 2");
    expect(document.body.querySelectorAll("time")).toHaveLength(2);
    expect(document.body.querySelector("time")?.getAttribute("datetime"))
      .toBe("2026-09-30T10:00:01.000Z");
    expect(textarea().rows).toBe(3);
    expect(button("发布评论").className).not.toContain("ant-btn-sm");
    expect(button("解决").className).toContain("ant-btn-sm");
  });

  it("选择线程回复会提交根 ID，取消回复后保留草稿并发布根评论", async () => {
    await renderDocument();
    await click("回复");
    expect(textarea().placeholder).toBe("写下你的回复");
    await typeContent("  回复内容  ");
    await click("发布回复");
    expect(documentsService.createComment).toHaveBeenLastCalledWith(1, { content: "回复内容", parentId: 1 });
    expect(textarea().value).toBe("");
    expect(textarea().placeholder).toBe("写下你的评论");

    await click("回复");
    await typeContent("改为根评论");
    await click("取消回复");
    expect(textarea().value).toBe("改为根评论");
    await click("发布评论");
    expect(documentsService.createComment).toHaveBeenLastCalledWith(1, { content: "改为根评论", parentId: null });
  });

  it("筛选完整线程并禁止回复已解决线程，重新打开只操作根评论", async () => {
    const comments = [comment(1, { resolved: true }), comment(2, { parentId: 1 }), comment(3)];
    commentsByDocument.set(1, comments);
    client.setQueryData(queryKeys.documentComments(1), comments);
    await renderDocument();
    expect(button("回复", 0).disabled).toBe(true);
    expect(document.body.textContent).toContain("已解决，请先重新打开后回复");
    await selectFilter("未解决");
    expect(document.body.querySelectorAll("article")).toHaveLength(1);
    expect(document.body.querySelector("article")?.textContent).toContain("评论 3");
    expect(document.body.querySelector("article")?.textContent).not.toContain("评论 2");
    await selectFilter("已解决");
    expect(document.body.querySelectorAll("article")).toHaveLength(1);
    expect(document.body.querySelector("article")?.textContent).toContain("评论 2");
    expect(document.body.querySelector("article")?.textContent).not.toContain("评论 3");

    commentsByDocument.set(1, [comment(1), comment(2, { parentId: 1 }), comment(3)]);
    await click("重新打开");
    expect(documentsService.updateComment).toHaveBeenCalledWith(1, 1, false);
    expect(document.body.querySelectorAll("article")).toHaveLength(0);
    expect(document.body.textContent).toContain("没有已解决的评论");
  });

  it("正在回复的线程被解决后阻止发布，取消回复可以发布新根评论", async () => {
    await renderDocument();
    await click("回复");
    await typeContent("草稿保留");
    await act(async () => {
      client.setQueryData(queryKeys.documentComments(1), [comment(1, { resolved: true }), comment(2, { parentId: 1 })]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(button("发布回复").disabled).toBe(true);
    expect(document.body.textContent).toContain("该线程已解决，请先重新打开后回复");
    await click("发布回复");
    expect(documentsService.createComment).not.toHaveBeenCalled();
    await click("取消回复");
    expect(textarea().value).toBe("草稿保留");
    expect(button("发布评论").disabled).toBe(false);
  });

  it("切换或关闭文档清空草稿与回复目标", async () => {
    await renderDocument();
    await click("回复");
    await typeContent("旧草稿");
    await renderDocument(cloudDocument(2));
    expect(textarea().value).toBe("");
    expect(textarea().placeholder).toBe("写下你的评论");
    await typeContent("第二份草稿");
    await renderDocument(null);
    await renderDocument(cloudDocument(2));
    expect(textarea().value).toBe("");
  });

  it("旧文档发布返回不会清空新文档草稿或回复目标，只刷新原文档缓存", async () => {
    let finish!: (value: DocumentComment) => void;
    vi.mocked(documentsService.createComment).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await renderDocument();
    await click("回复");
    await typeContent("旧文档回复");
    await click("发布回复");
    expect(documentsService.createComment).toHaveBeenCalledWith(1, { content: "旧文档回复", parentId: 1 });
    await renderDocument(cloudDocument(2));
    await click("回复");
    await typeContent("新文档草稿");
    await act(async () => finish(comment(5)));
    expect(textarea().value).toBe("新文档草稿");
    expect(textarea().placeholder).toBe("写下你的回复");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.documentComments(1) });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.documentComments(2) });
  });

  it("旧文档解决请求返回只刷新原文档，不改变新文档草稿", async () => {
    let finish!: (value: DocumentComment) => void;
    vi.mocked(documentsService.updateComment).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await renderDocument();
    await click("解决");
    await renderDocument(cloudDocument(2));
    await typeContent("新文档草稿");
    await act(async () => finish(comment(1, { resolved: true })));
    expect(documentsService.updateComment).toHaveBeenCalledWith(1, 1, true);
    expect(textarea().value).toBe("新文档草稿");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.documentComments(1) });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.documentComments(2) });
  });

  it("切回同一文档的新草稿也不会被上一次打开时的请求清空", async () => {
    let finish!: (value: DocumentComment) => void;
    vi.mocked(documentsService.createComment).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await renderDocument();
    await typeContent("第一次打开的评论");
    await click("发布评论");
    await renderDocument(cloudDocument(2));
    await renderDocument(cloudDocument(1));
    await click("回复");
    await typeContent("重新打开后的新草稿");
    await act(async () => finish(comment(5)));
    expect(textarea().value).toBe("重新打开后的新草稿");
    expect(textarea().placeholder).toBe("写下你的回复");
  });

  it("发布失败保留草稿和回复目标，空白草稿不能发布", async () => {
    vi.mocked(documentsService.createComment).mockRejectedValueOnce(new Error("发布失败"));
    await renderDocument();
    await typeContent("   ");
    expect(button("发布评论").disabled).toBe(true);
    await click("发布评论");
    expect(documentsService.createComment).not.toHaveBeenCalled();
    await click("回复");
    await typeContent("失败后可重试");
    await click("发布回复");
    expect(textarea().value).toBe("失败后可重试");
    expect(textarea().placeholder).toBe("写下你的回复");
    expect(button("发布回复").disabled).toBe(false);
  });
});
