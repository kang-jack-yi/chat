// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { message } from "antd";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation, SessionData } from "@chat/shared";
import ChatPage from "./index";
import type { ChatPanelProps } from "./components/ChatPanel";
import { queryKeys } from "../../constants/query-keys";
import { useAppStore } from "../../stores/app-store";
import { useUserStore } from "../../stores/user-store";

vi.mock("../../services/chat", () => ({
  chatService: { conversations: vi.fn() },
}));
vi.mock("../../services/organization", () => ({
  organizationService: { users: vi.fn() },
}));
vi.mock("./components/ConversationList", () => ({
  default: ({ onSelect }: { onSelect: (id: number) => void }) => (
    <button onClick={() => onSelect(42)}>选择群聊</button>
  ),
}));
vi.mock("./components/GroupDialog", () => ({ default: () => null }));
vi.mock("./components/ConversationSettingsModal", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="settings-modal" /> : null,
}));
vi.mock("./components/InviteGroupMembersModal", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="invite-modal" /> : null,
}));
vi.mock("./components/ChatPanel", () => ({
  default: ({
    conversation,
    membersOpen,
    onToggleMembers,
    onOpenHistory,
    onOpenSettings,
  }: ChatPanelProps) => (
    <div data-testid="chat-panel" data-conversation-id={conversation?.id}>
      {conversation?.type === "group" && (
        <button
          aria-label="群成员"
          aria-expanded={membersOpen}
          onClick={onToggleMembers}
        >
          群成员
        </button>
      )}
      <button aria-label="打开聊天记录" onClick={onOpenHistory}>
        聊天记录
      </button>
      <button aria-label="打开聊天设置" onClick={onOpenSettings}>
        设置
      </button>
    </div>
  ),
}));

const session: SessionData = {
  company: { id: 1, name: "测试企业", code: "TEST", ownerId: 1 },
  user: {
    id: 1,
    companyId: 1,
    departmentId: 1,
    phone: "13800000001",
    name: "测试用户",
    title: "设计师",
    avatar: "测",
    email: "",
    bio: "",
    presenceStatus: "available",
    statusText: "",
    statusExpiresAt: null,
    role: "member",
    status: "active",
  },
};
const group: Conversation = {
  id: 42,
  type: "group",
  createdBy: 1,
  name: "协作群",
  avatar: "群",
  lastMessage: "",
  lastMessageId: 123,
  lastMessageAt: "2026-09-30T00:00:00Z",
  unreadCount: 0,
  memberCount: 1,
  pinned: false,
  muted: false,
  hidden: false,
  members: [session.user],
};
let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
let viewportWidth: number;
type MediaListener = (event: { matches: boolean }) => void;
const mediaListeners = new Map<string, Set<MediaListener>>();

/** 暴露真实浏览器历史动作，不替换页面内部的路由与详情状态。 */
function RouteHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="route">
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => navigate(-1)}>历史后退</button>
      <button onClick={() => navigate(1)}>历史前进</button>
      <button onClick={() => navigate("/chat/43")}>切换群聊</button>
      <button onClick={() => navigate("/chat/9")}>切换单聊</button>
      <Routes>
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:conversationId" element={<ChatPage />} />
      </Routes>
    </>
  );
}

/** 等待查询与 React effect 完成，避免固定长延迟。 */
async function settle() {
  for (let index = 0; index < 3; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** 在隔离 DOM 和内存路由中挂载聊天外壳。 */
async function mount(route: string) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>
          <RouteHarness />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
}

/** 按可访问名称执行真实按钮点击。 */
async function click(name: string) {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (item) => (item.getAttribute("aria-label") || item.textContent) === name,
  );
  expect(button, name).toBeTruthy();
  await act(async () => {
    button!.click();
  });
  await settle();
}

/** 模拟媒体查询边界，与父页面实际监听的 1100px 断点保持一致。 */
function mediaMatches(query: string) {
  const minimum = /min-width:\s*(\d+)px/.exec(query);
  const maximum = /max-width:\s*(\d+)px/.exec(query);
  return (
    (!minimum || viewportWidth >= Number(minimum[1])) &&
    (!maximum || viewportWidth <= Number(maximum[1]))
  );
}

/** 在已挂载页面上触发媒体查询通知，验证浮层与宽屏偏好的边界。 */
async function resize(width: number) {
  await act(async () => {
    viewportWidth = width;
    mediaListeners.forEach((listeners, query) =>
      listeners.forEach((listener) =>
        listener({ matches: mediaMatches(query) }),
      ),
    );
  });
  await settle();
}

/** 触发原生输入事件，覆盖真实 Input 过滤及清空逻辑。 */
async function searchMembers(value: string) {
  const input = document.querySelector<HTMLInputElement>(
    '[aria-label="搜索群成员"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

/** 查询父 header 契约中当前公布的成员展开状态。 */
function membersExpanded() {
  return host
    .querySelector('[aria-label="群成员"]')
    ?.getAttribute("aria-expanded");
}

beforeEach(() => {
  vi.clearAllMocks();
  viewportWidth = 375;
  mediaListeners.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom 无布局观察 API，仅补浏览器接口，不替换 Drawer 或成员列表。
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
    vi.fn((query: string) => ({
      get matches() {
        return mediaMatches(query);
      },
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_type: string, listener: MediaListener) => {
        const listeners = mediaListeners.get(query) ?? new Set();
        listeners.add(listener);
        mediaListeners.set(query, listeners);
      },
      removeEventListener: (_type: string, listener: MediaListener) => {
        mediaListeners.get(query)?.delete(listener);
      },
      dispatchEvent: vi.fn(),
    })),
  );
  const getComputedStyle = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    getComputedStyle(element),
  );
  useUserStore.setState({ session, bootstrapped: true });
  useAppStore.setState({ mobileDetailOpen: false, groupDialogOpen: false });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.conversations, [
    group,
    { ...group, id: 43 },
    { ...group, id: 9, type: "direct" },
  ]);
  client.setQueryData(queryKeys.users, [session.user]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    message.destroy();
  });
  client.clear();
  host.remove();
  useUserStore.setState({ session: null });
  useAppStore.setState({ mobileDetailOpen: false });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("chat shell routing", () => {
  it("opens an ordinary narrow-screen conversation deep link", async () => {
    await mount("/chat/42");
    expect(host.querySelector("main")?.className).toContain(
      "max-md:translate-x-0",
    );
  });

  it.each([375, 767])(
    "keeps /chat on the conversation list at %ipx",
    async (width) => {
      viewportWidth = width;
      await mount("/chat");
      expect(host.querySelector('[data-testid="route"]')?.textContent).toBe(
        "/chat",
      );
      expect(useAppStore.getState().mobileDetailOpen).toBe(false);
    },
  );

  it.each([375, 1440])(
    "recovers an invalid conversation through the root at %ipx",
    async (width) => {
      viewportWidth = width;
      await mount("/chat/999");
      expect(host.querySelector('[data-testid="route"]')?.textContent).toBe(
        width < 768 ? "/chat" : "/chat/42",
      );
    },
  );

  it.each([768, 1100, 1440])(
    "preserves desktop root selection at %ipx",
    async (width) => {
      viewportWidth = width;
      await mount("/chat");
      expect(host.querySelector('[data-testid="route"]')?.textContent).toBe(
        "/chat/42",
      );
      expect(useAppStore.getState().mobileDetailOpen).toBe(true);
    },
  );

  it("keeps list/detail visibility consistent with back and forward history", async () => {
    await mount("/chat");
    await click("选择群聊");
    await click("返回会话列表");
    expect(host.querySelector('[data-testid="route"]')?.textContent).toBe(
      "/chat",
    );
    expect(useAppStore.getState().mobileDetailOpen).toBe(false);
    await click("历史后退");
    expect(host.querySelector('[data-testid="route"]')?.textContent).toBe(
      "/chat/42",
    );
    expect(useAppStore.getState().mobileDetailOpen).toBe(true);
    await click("历史前进");
    expect(host.querySelector('[data-testid="route"]')?.textContent).toBe(
      "/chat",
    );
    expect(useAppStore.getState().mobileDetailOpen).toBe(false);
  });
});

describe("responsive group members", () => {
  it.each([375, 1440])(
    "preserves announcement entry at %ipx",
    async (width) => {
      viewportWidth = width;
      client.setQueryData(queryKeys.conversations, [
        { ...group, announcement: "[群公告] 周五统一确认本周进展" },
      ]);
      await mount("/chat/42");
      if (width < 1100) await click("群成员");
      const announcement = document.querySelector('[aria-label="查看群公告"]');
      expect(announcement?.textContent).toContain("周五统一确认本周进展");
      expect(announcement?.textContent).not.toContain("[群公告]");
      await click("查看群公告");
      expect(
        host.querySelector('[data-testid="settings-modal"]'),
      ).not.toBeNull();
      if (width < 1100) expect(membersExpanded()).toBe("false");
    },
  );

  it.each([1100, 1440])(
    "defaults to an inline pane at %ipx and allows collapse/reopen",
    async (width) => {
      viewportWidth = width;
      await mount("/chat/42");
      expect(membersExpanded()).toBe("true");
      expect(
        host
          .querySelector("main")
          ?.classList.contains("chat-main-with-members"),
      ).toBe(true);
      expect(host.querySelector("aside h2")?.textContent).toContain("1 人");
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(
        document.querySelectorAll('[aria-label="打开聊天记录"]'),
      ).toHaveLength(1);
      expect(
        document.querySelectorAll('[aria-label="打开聊天设置"]'),
      ).toHaveLength(1);
      await click("关闭群成员");
      expect(membersExpanded()).toBe("false");
      expect(host.querySelector("aside")).toBeNull();
      expect(
        host
          .querySelector("main")
          ?.classList.contains("chat-main-with-members"),
      ).toBe(false);
      await click("群成员");
      expect(host.querySelector("aside")).toBeTruthy();
      await click("群成员");
      await click("切换群聊");
      expect(membersExpanded()).toBe("false");
    },
  );

  it.each([375, 767, 768, 1099])(
    "uses a closed-by-default Drawer below 1100px (%i)",
    async (width) => {
      viewportWidth = width;
      await mount("/chat/42");
      expect(membersExpanded()).toBe("false");
      expect(document.querySelector("aside")).toBeNull();
      await click("群成员");
      expect(membersExpanded()).toBe("true");
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog?.getAttribute("aria-label")).toBe("群成员");
      expect(dialog?.querySelector("aside")).toBeTruthy();
      expect(host.querySelector("main aside")).toBeNull();
      await act(async () => {
        dialog!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            keyCode: 27,
            bubbles: true,
          }),
        );
      });
      await settle();
      expect(membersExpanded()).toBe("false");
    },
  );

  it("closes the Drawer on conversation changes and resets search for the next group", async () => {
    await mount("/chat/42");
    await click("群成员");
    await searchMembers("不存在");
    await click("切换群聊");
    expect(membersExpanded()).toBe("false");
    await click("群成员");
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="搜索群成员"]')
        ?.value,
    ).toBe("");
    await click("切换单聊");
    expect(host.querySelector('[aria-label="群成员"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("does not carry a wide pane into a narrow Drawer and remembers wide collapse", async () => {
    viewportWidth = 1440;
    await mount("/chat/42");
    await resize(1099);
    expect(membersExpanded()).toBe("false");
    await click("群成员");
    await resize(1100);
    expect(membersExpanded()).toBe("true");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click("关闭群成员");
    await resize(1099);
    await resize(1100);
    expect(membersExpanded()).toBe("false");
  });

  it.each([375, 1440])(
    "shares name/title search and empty-result clearing at %ipx",
    async (width) => {
      viewportWidth = width;
      await mount("/chat/42");
      if (width < 1100) await click("群成员");
      await searchMembers("设计师");
      expect(document.querySelectorAll(".chat-members-row")).toHaveLength(1);
      await searchMembers("测试用户");
      expect(document.querySelectorAll(".chat-members-row")).toHaveLength(1);
      await searchMembers("不存在");
      expect(document.querySelectorAll(".chat-members-row")).toHaveLength(0);
      expect(
        document.querySelector(".chat-members-empty")?.textContent,
      ).toContain("没有匹配的成员");
      await click("清除成员搜索");
      expect(
        document.querySelector<HTMLInputElement>('[aria-label="搜索群成员"]')
          ?.value,
      ).toBe("");
      expect(document.querySelectorAll(".chat-members-row")).toHaveLength(1);
    },
  );

  it("keeps invitations available to a group member and closes the overlay first", async () => {
    await mount("/chat/42");
    await click("群成员");
    await click("邀请群成员");
    expect(membersExpanded()).toBe("false");
    expect(host.querySelector('[data-testid="invite-modal"]')).toBeTruthy();
    await click("打开聊天设置");
    expect(host.querySelector('[data-testid="settings-modal"]')).toBeTruthy();
  });

  it("explains desktop-only history when the browser has no native bridge", async () => {
    const info = vi.spyOn(message, "info");
    await mount("/chat/42");
    await click("打开聊天记录");
    expect(info).toHaveBeenCalledWith("聊天记录请在桌面客户端中查看");
  });

  it("preserves the native history bridge without browser fallback", async () => {
    const openChatHistory = vi.fn().mockResolvedValue(undefined);
    const info = vi.spyOn(message, "info");
    vi.stubGlobal("desktop", {
      screenshot: { setActiveConversation: vi.fn(), onUnavailable: vi.fn() },
      windows: { openChatHistory, onLocateHistoryMessage: vi.fn() },
    });
    await mount("/chat/42");
    await click("打开聊天记录");
    expect(openChatHistory).toHaveBeenCalledWith({ conversationId: 42 });
    expect(info).not.toHaveBeenCalled();
  });

  it("retains the existing self and disabled-member messaging restrictions", async () => {
    viewportWidth = 1440;
    const disabledMember = {
      ...session.user,
      id: 2,
      name: "停用成员",
      status: "disabled",
    };
    client.setQueryData(queryKeys.conversations, [
      { ...group, memberCount: 2, members: [session.user, disabledMember] },
    ]);
    await mount("/chat/42");
    await click("查看测试用户的成员资料");
    expect(
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent === "发消息",
      ),
    ).toBe(false);
    await click("查看测试用户的成员资料");
    await click("查看停用成员的成员资料");
    const sendButton = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "发消息");
    expect(sendButton?.disabled).toBe(true);
  });
});
