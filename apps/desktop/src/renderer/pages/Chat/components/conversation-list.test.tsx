// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfigProvider } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation, GlobalMessageSearchPage } from "@chat/shared";
import ConversationList, {
  type ConversationListProps,
} from "./ConversationList";
import { chatService } from "../../../services/chat";
import { useChatDraftStore } from "../../../stores/chat-draft-store";

vi.mock("../../../services/chat", () => ({
  chatService: { searchWorkspace: vi.fn() },
}));

/** 创建完整会话数据，交互测试只覆盖需要变化的业务字段。 */
function conversation(
  id: number,
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id,
    type: "direct",
    createdBy: 1,
    name: `会话${id}`,
    avatar: "聊",
    lastMessage: `最近消息${id}`,
    lastMessageId: id,
    lastMessageAt: "2026-10-23T08:00:00Z",
    unreadCount: 0,
    memberCount: 2,
    ...overrides,
  };
}

/** 构造真实搜索消息结构，让组件自身执行片段高亮与定位。 */
function hit(
  id: number,
  target = conversation(1),
): GlobalMessageSearchPage["messages"][number] {
  return {
    conversation: target,
    snippet: `匹配消息${id}`,
    message: {
      schemaVersion: 1,
      id,
      clientId: `client-${id}`,
      conversationId: target.id,
      senderId: 2,
      senderName: "同事",
      senderAvatar: "同",
      kind: "user",
      parts: [],
      summary: `匹配消息${id}`,
      version: 1,
      createdAt: "2026-10-23T08:00:00Z",
      updatedAt: "2026-10-23T08:00:00Z",
      deletedAt: null,
    },
  };
}

/** 提供成功的空页，避免把测试默认数据与失败状态混淆。 */
function page(
  overrides: Partial<GlobalMessageSearchPage> = {},
): GlobalMessageSearchPage {
  return {
    conversations: [],
    messages: [],
    nextCursor: null,
    historyComplete: true,
    ...overrides,
  };
}

/** 手动控制请求完成顺序，以复现首屏、分页、切换和卸载的竞态。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

let host: HTMLDivElement;
let root: Root;
let props: ConversationListProps;
const search = vi.mocked(chatService.searchWorkspace);

/** 挂载真实列表、Ant Design 输入框与菜单，不用静态标记替代交互。 */
async function render(overrides: Partial<ConversationListProps> = {}) {
  props = { ...props, ...overrides };
  await act(async () =>
    root.render(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <ConversationList {...props} />
      </ConfigProvider>,
    ),
  );
}

/** 查询 DOM 元素并明确断言存在，避免缺失目标时测试静默通过。 */
function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const target = document.querySelector<T>(selector);
  expect(target, selector).not.toBeNull();
  return target!;
}

/** 按用户可见文本查找按钮，兼容 Ant Design 的内部 span。 */
function button(text: string): HTMLButtonElement {
  const target = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.replace(/\s/g, "") === text,
  );
  expect(target, text).toBeDefined();
  return target!;
}

/** 点击真实控件并刷新 React 更新。 */
async function click(target: HTMLElement) {
  await act(async () => target.click());
}

/** 从原生输入事件更新受控输入框，不绕过组件的 onChange。 */
async function typeQuery(value: string) {
  await act(async () => {
    const input = element<HTMLInputElement>(
      'input[aria-label="搜索会话与消息"]',
    );
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 前进防抖与菜单焦点计时器，不等待真实网络或启动桌面客户端。 */
async function advance(ms = 300) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

/** 派发真实键盘事件，验证菜单的方向键与 Escape 行为。 */
async function key(target: HTMLElement, value: string, keyCode: number) {
  await act(async () =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        code: value,
        keyCode,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await advance(50);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: { im: { call: vi.fn() } },
  });
  search.mockReset();
  search.mockResolvedValue(page());
  useChatDraftStore.setState({ drafts: {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    conversations: [],
    loading: false,
    onSelect: vi.fn(),
    onNewGroup: vi.fn(),
    onSetting: vi.fn(),
    onDelete: vi.fn(),
    onLocateSearchResult: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.desktop;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ConversationList interactions", () => {
  it("filters without changing pinned order, drafts, mentions, muted unread counts or hidden semantics", async () => {
    useChatDraftStore.setState({
      drafts: { 1: { text: "<p>待发送内容</p>", attachments: [] } },
    });
    const items = [
      conversation(1, {
        pinned: true,
        mentioned: true,
        mentionType: "all",
        unreadCount: 2,
      }),
      conversation(2, {
        type: "group",
        muted: true,
        unreadCount: 120,
        mentioned: true,
        mentionType: "member",
      }),
      conversation(3),
      conversation(4, { hidden: true, unreadCount: 99 }),
    ];
    await render({ conversations: items, selectedId: 1 });
    expect(host.textContent).toContain("122 条未读");
    expect(host.textContent).toContain("[草稿]待发送内容");
    expect(host.textContent).toContain("@所有人");
    expect(host.textContent).toContain("[有人@我]");
    expect(host.textContent).not.toContain("会话4");
    expect(element('[aria-label="120 条未读消息"]').textContent).toBe("99+");
    expect(
      element('[aria-label="打开会话：会话1"]').getAttribute("aria-current"),
    ).toBe("true");
    await click(element('[aria-label="未读会话，2 个"]'));
    expect(
      [...host.querySelectorAll(".conversation-list-select")].map((item) =>
        item.getAttribute("aria-label"),
      ),
    ).toEqual(["打开会话：会话1", "打开会话：会话2"]);
    await click(button("群聊"));
    expect(host.querySelectorAll(".conversation-list-select")).toHaveLength(1);
    await click(element('[aria-label="打开会话：会话2"]'));
    expect(props.onSelect).toHaveBeenCalledWith(2);
    await click(button("全部"));
    expect(host.querySelectorAll(".conversation-list-select")).toHaveLength(3);
    await click(element('[aria-label="新建群聊"]'));
    expect(props.onNewGroup).toHaveBeenCalledOnce();
  });

  it("offers a route back from both filter empty states and reacts to read updates", async () => {
    await render({ conversations: [conversation(1, { unreadCount: 1 })] });
    await click(element('[aria-label="未读会话，1 个"]'));
    await render({ conversations: [conversation(1)] });
    expect(host.textContent).toContain("暂无未读会话");
    await click(button("查看全部会话"));
    expect(host.querySelectorAll(".conversation-list-select")).toHaveLength(1);
    await click(button("群聊"));
    expect(host.textContent).toContain("暂无群聊");
    await click(button("查看全部会话"));
    expect(button("全部").getAttribute("aria-pressed")).toBe("true");
    await render({ conversations: [], loading: true });
    expect(host.textContent).not.toContain("暂无会话");
  });

  it("exposes a sibling more button, keyboard menu navigation and Escape focus return", async () => {
    const item = conversation(1);
    await render({ conversations: [item] });
    expect(element(".chat-conversation-row").tagName).toBe("DIV");
    expect(host.querySelector("button button")).toBeNull();
    const more = element<HTMLButtonElement>('[aria-label="会话1的更多操作"]');
    more.focus();
    await key(more, "ArrowDown", 40);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const menu = element('[role="menu"]');
    expect(menu.contains(document.activeElement)).toBe(true);
    await key(document.activeElement as HTMLElement, "Escape", 27);
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(more);
    await key(more, "ArrowDown", 40);
    await key(document.activeElement as HTMLElement, "Enter", 13);
    expect(props.onSetting).toHaveBeenCalledWith(item, { pinned: true });
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("keeps right-click actions and supports tap/click more actions without selecting the row", async () => {
    const item = conversation(1, { pinned: true, muted: true });
    await render({ conversations: [item] });
    await act(async () =>
      element('[aria-label="打开会话：会话1"]').dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    );
    await advance();
    await click(element('[role="menuitem"]'));
    expect(props.onSetting).toHaveBeenCalledWith(item, { pinned: false });
    await advance();
    for (const [label, payload] of [
      ["关闭免打扰", { muted: false }],
      ["隐藏会话", { hidden: true }],
    ] as const) {
      await click(element('[aria-label="会话1的更多操作"]'));
      await advance();
      const action = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ].find((node) => node.textContent === label)!;
      await click(action);
      expect(props.onSetting).toHaveBeenCalledWith(item, payload);
      await advance();
    }
    await click(element('[aria-label="会话1的更多操作"]'));
    await advance();
    await click(
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (node) => node.textContent === "删除聊天记录",
      )!,
    );
    expect(props.onDelete).toHaveBeenCalledWith(item);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("shows loading, distinguishes first-page failure from empty, and retries", async () => {
    const request = deferred<GlobalMessageSearchPage>();
    search.mockReturnValueOnce(request.promise);
    await render();
    await typeQuery("报告");
    expect(host.textContent).toContain("正在搜索");
    expect(host.textContent).not.toContain("没有找到");
    await advance();
    await act(async () => request.reject(new Error("offline")));
    expect(element('[role="alert"]').textContent).toContain("搜索失败");
    expect(host.textContent).not.toContain("没有找到");
    expect(host.textContent).not.toContain("仍在同步");
    await click(button("重试搜索"));
    expect(host.textContent).toContain("正在搜索");
    await advance();
    expect(host.textContent).toContain("没有找到相关内容");
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("debounces input and ignores stale first-page results and errors", async () => {
    const first = deferred<GlobalMessageSearchPage>();
    const second = deferred<GlobalMessageSearchPage>();
    search
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    await render();
    await typeQuery("旧");
    await typeQuery("旧查询");
    await advance();
    expect(search).toHaveBeenCalledExactlyOnceWith("旧查询");
    await typeQuery("新查询");
    await advance();
    await act(async () =>
      second.resolve(
        page({ conversations: [conversation(2, { name: "新结果" })] }),
      ),
    );
    await act(async () => first.reject(new Error("stale")));
    expect(host.textContent).toContain("新结果");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("deduplicates initial and subsequent pages and prevents duplicate pagination requests", async () => {
    const more = deferred<GlobalMessageSearchPage>();
    const item = conversation(1);
    search
      .mockResolvedValueOnce(
        page({
          conversations: [item, item],
          messages: [hit(1), hit(1)],
          nextCursor: "page-2",
        }),
      )
      .mockReturnValueOnce(more.promise);
    await render();
    await typeQuery("匹配");
    await advance();
    expect(host.querySelectorAll("mark")).toHaveLength(1);
    const load = button("加载更多");
    await act(async () => {
      load.click();
      load.click();
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenLastCalledWith("匹配", "page-2");
    await act(async () => more.resolve(page({ messages: [hit(1), hit(2)] })));
    expect(host.querySelectorAll("mark")).toHaveLength(2);
    expect(
      [...host.querySelectorAll("button")].filter(
        (node) => node.textContent === "聊会话1",
      ),
    ).toHaveLength(1);
    expect(host.textContent).not.toContain("加载更多");
  });

  it("retains results on pagination failure, catches rejection and retries the same cursor", async () => {
    search
      .mockResolvedValueOnce(page({ messages: [hit(1)], nextCursor: "page-2" }))
      .mockRejectedValueOnce(new Error("page failed"))
      .mockResolvedValueOnce(page({ messages: [hit(2)] }));
    await render();
    await typeQuery("匹配");
    await advance();
    await click(button("加载更多"));
    expect(host.textContent).toContain("匹配消息1");
    expect(host.textContent).toContain("加载更多失败");
    expect(host.textContent).not.toContain("没有找到");
    await click(button("重试加载更多"));
    expect(search).toHaveBeenLastCalledWith("匹配", "page-2");
    expect(host.textContent).toContain("匹配消息2");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it.each(["resolve", "reject"] as const)(
    "ignores late pagination %s without resetting a new query's loading state",
    async (outcome) => {
      const stale = deferred<GlobalMessageSearchPage>();
      const fresh = deferred<GlobalMessageSearchPage>();
      search
        .mockResolvedValueOnce(
          page({ messages: [hit(1)], nextCursor: "old-page" }),
        )
        .mockReturnValueOnce(stale.promise)
        .mockReturnValueOnce(fresh.promise);
      await render();
      await typeQuery("旧查询");
      await advance();
      await click(button("加载更多"));
      await typeQuery("新查询");
      await advance();
      await act(async () =>
        outcome === "resolve"
          ? stale.resolve(page({ messages: [hit(99)] }))
          : stale.reject(new Error("stale page")),
      );
      expect(host.textContent).toContain("正在搜索");
      expect(host.textContent).not.toContain("匹配消息99");
      expect(host.querySelector('[role="alert"]')).toBeNull();
      await act(async () => fresh.resolve(page({ messages: [hit(2)] })));
      expect(host.textContent).toContain("匹配消息2");
      expect(host.textContent).not.toContain("匹配消息1");
    },
  );

  it("invalidates requests across clear and retyping the same keyword, then ignores unmount rejection", async () => {
    const stale = deferred<GlobalMessageSearchPage>();
    const late = deferred<GlobalMessageSearchPage>();
    search
      .mockResolvedValueOnce(page({ nextCursor: "page-2", messages: [hit(1)] }))
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(page({ messages: [hit(2)], nextCursor: "page-3" }))
      .mockReturnValueOnce(late.promise);
    await render();
    await typeQuery("匹配");
    await advance();
    await click(button("加载更多"));
    await click(element(".ant-input-clear-icon"));
    await typeQuery("匹配");
    await advance();
    await act(async () => stale.resolve(page({ messages: [hit(99)] })));
    expect(host.textContent).toContain("匹配消息2");
    expect(host.textContent).not.toContain("匹配消息99");
    await click(button("加载更多"));
    await act(async () => root.render(null));
    await act(async () => late.reject(new Error("unmounted")));
    expect(host.textContent).toBe("");
  });

  it("does not unlock new-query pagination when an old page finishes", async () => {
    const stale = deferred<GlobalMessageSearchPage>();
    const fresh = deferred<GlobalMessageSearchPage>();
    search
      .mockResolvedValueOnce(
        page({ messages: [hit(1)], nextCursor: "old-page" }),
      )
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(
        page({ messages: [hit(2)], nextCursor: "new-page" }),
      )
      .mockReturnValueOnce(fresh.promise);
    await render();
    await typeQuery("旧查询");
    await advance();
    await click(button("加载更多"));
    await typeQuery("新查询");
    await advance();
    await click(button("加载更多"));
    await act(async () => stale.resolve(page({ messages: [hit(99)] })));
    expect(button("加载更多").className).toContain("ant-btn-loading");
    await click(button("加载更多"));
    expect(search).toHaveBeenCalledTimes(4);
    expect(search).toHaveBeenLastCalledWith("新查询", "new-page");
    await act(async () => fresh.resolve(page({ messages: [hit(3)] })));
    expect(host.textContent).toContain("匹配消息2");
    expect(host.textContent).toContain("匹配消息3");
    expect(host.textContent).not.toContain("匹配消息99");
  });

  it("preserves hidden search results, sync notice and message-location callbacks", async () => {
    const hidden = conversation(8, { hidden: true });
    search.mockResolvedValue(
      page({
        conversations: [hidden],
        messages: [hit(30, hidden)],
        historyComplete: false,
      }),
    );
    await render({ conversations: [conversation(1)] });
    await click(button("群聊"));
    await typeQuery("匹配");
    await advance();
    expect(host.textContent).toContain("已隐藏");
    expect(host.textContent).toContain("仍在同步");
    await click(element("mark").closest("button")!);
    expect(props.onLocateSearchResult).toHaveBeenCalledWith(hidden, 30);
    expect(element<HTMLInputElement>("input").value).toBe("");
    expect(button("群聊").getAttribute("aria-pressed")).toBe("true");
  });

  it("searches only loaded conversation names without a bridge and never claims history is syncing", async () => {
    delete window.desktop;
    const item = conversation(1, { name: "Design 团队" });
    await render({
      conversations: [
        item,
        conversation(2, { lastMessage: "design 仅消息命中" }),
      ],
    });
    await typeQuery("  DESIGN  ");
    await advance();
    expect(host.textContent).toContain("本地历史消息搜索需使用桌面客户端");
    expect(host.textContent).toContain("Design 团队");
    expect(host.textContent).not.toContain("会话2");
    expect(host.textContent).not.toContain("正在搜索");
    expect(host.textContent).not.toContain("仍在同步");
    expect(search).not.toHaveBeenCalled();
    await click(
      [...host.querySelectorAll("button")].find((node) =>
        node.textContent?.includes("Design 团队"),
      )!,
    );
    expect(props.onLocateSearchResult).toHaveBeenCalledWith(item);
    await typeQuery("未加载");
    expect(host.textContent).toContain("没有找到相关内容");
    expect(host.textContent).toContain("需使用桌面客户端");
  });
});
