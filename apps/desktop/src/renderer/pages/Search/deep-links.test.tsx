// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation, Notification, SessionData } from "@chat/shared";
import ChatPage from "../Chat";
import NotificationsPage from "../Notifications";
import { chatService } from "../../services/chat";
import { notificationsService } from "../../services/notifications";
import { organizationService } from "../../services/organization";
import { get } from "../../services/request";
import { queryKeys } from "../../constants/query-keys";
import { useUserStore } from "../../stores/user-store";

vi.mock("../../services/chat", () => ({ chatService: { conversations: vi.fn(), settings: vi.fn() } }));
vi.mock("../../services/notifications", () => ({ notificationsService: { list: vi.fn(), read: vi.fn(), readAll: vi.fn() } }));
vi.mock("../../services/organization", () => ({ organizationService: { users: vi.fn() } }));
vi.mock("../../services/request", () => ({ get: vi.fn() }));
vi.mock("../Chat/components/ConversationList", () => ({ default: () => null }));
vi.mock("../Chat/components/GroupDialog", () => ({ default: () => null }));
vi.mock("../Chat/components/ChatSidePanel", () => ({ default: () => null }));
vi.mock("../Chat/components/ConversationSettingsModal", () => ({ default: () => null }));
vi.mock("../Chat/components/InviteGroupMembersModal", () => ({ default: () => null }));
vi.mock("../Chat/components/ChatPanel", () => ({
  default: ({ conversation, focusedMessageId }: { conversation: Conversation | null; focusedMessageId?: number }) => (
    <div data-testid="chat-panel" data-conversation-id={conversation?.id} data-message-id={focusedMessageId} />
  ),
}));

const target: Conversation = {
  id: 42, type: "direct", createdBy: 1, name: "隐藏会话", avatar: "隐",
  lastMessage: "待定位消息", lastMessageId: 123, lastMessageAt: "2026-09-30T00:00:00Z",
  unreadCount: 0, memberCount: 2, pinned: false, muted: false, hidden: true, members: [],
};
const other: Conversation = { ...target, id: 9, name: "其他会话", hidden: false };
const notification: Notification = {
  id: 7, type: "task_due", title: "最近一百条以外的通知", body: "任务即将到期",
  entityType: "task", entityId: "17", taskId: 17, conversationId: 42, documentId: null,
  readAt: "2026-09-30T00:00:00Z", createdAt: "2026-08-01T00:00:00Z",
};
const session: SessionData = {
  company: { id: 1, name: "测试企业", code: "TEST", ownerId: 1 },
  user: {
    id: 1, companyId: 1, departmentId: 1, phone: "13800000001", name: "测试用户", title: "",
    avatar: "测", email: "", bio: "", presenceStatus: "available", statusText: "", statusExpiresAt: null,
    role: "member", status: "active",
  },
};

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
let visibleConversations: Conversation[];

/** 控制真实异步请求边界的完成时间，不模拟页面内部状态和 effect。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

/** 展示真实路由，并允许在请求进行中发起新的用户导航。 */
function RouteHarness({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="route">{location.pathname}{location.search}</output>
      <button data-testid="leave-chat" onClick={() => navigate("/notifications")}>离开会话</button>
      {children}
    </>
  );
}

/** 推进 React 和查询通知队列，保持真实 Promise 与组件生命周期。 */
async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

/** 通过 React DOM 挂载页面；ChatPanel 仅替代重型视图边界以观察定位输入。 */
async function mount(route: string, notificationPage = false) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>
          <RouteHarness>
            <Routes>
              <Route path="/chat/:conversationId" element={<ChatPage />} />
              <Route path="/notifications" element={notificationPage ? <NotificationsPage /> : <div>通知页</div>} />
            </Routes>
          </RouteHarness>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false, media: "", onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  useUserStore.setState({ session, bootstrapped: true });
  visibleConversations = [other];
  vi.mocked(chatService.conversations).mockImplementation(async () => visibleConversations);
  vi.mocked(organizationService.users).mockResolvedValue([]);
  vi.mocked(get).mockResolvedValue(target);
  vi.mocked(notificationsService.list).mockResolvedValue({ items: [], unreadCount: 0 });
  vi.mocked(notificationsService.read).mockResolvedValue(notification);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.conversations, [other]);
  client.setQueryData(queryKeys.users, []);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  client.clear();
  host.remove();
  useUserStore.setState({ session: null });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("message deep links", () => {
  it("fetches a hidden conversation missing from the visible list, unhides it and focuses the message", async () => {
    vi.mocked(chatService.settings).mockImplementation(async () => {
      const opened = { ...target, hidden: false };
      visibleConversations = [other, opened];
      return opened;
    });
    await mount("/chat/42?messageId=123");
    expect(get).toHaveBeenCalledWith("/api/conversations/42");
    expect(chatService.settings).toHaveBeenCalledWith(42, { hidden: false });
    expect(host.querySelector('[data-testid="route"]')?.textContent).toBe("/chat/42");
    expect(host.querySelector('[data-testid="chat-panel"]')?.getAttribute("data-conversation-id")).toBe("42");
    expect(host.querySelector('[data-testid="chat-panel"]')?.getAttribute("data-message-id")).toBe("123");
  });

  // 请求完成后必须尊重用户的新导航；普通断言直接报告尚未修复的竞态。
  it("does not override newer navigation when an old hidden-conversation request completes", async () => {
    const settings = deferred<Conversation>();
    vi.mocked(chatService.settings).mockReturnValue(settings.promise);
    await mount("/chat/42?messageId=123");
    expect(chatService.settings).toHaveBeenCalledWith(42, { hidden: false });
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="leave-chat"]')!.click(); });
    expect(host.querySelector('[data-testid="route"]')?.textContent).toBe("/notifications");
    visibleConversations = [other, { ...target, hidden: false }];
    await act(async () => { settings.resolve({ ...target, hidden: false }); });
    await settle();
    expect(host.querySelector('[data-testid="route"]')?.textContent).toBe("/notifications");
  });
});

describe("older notification deep links", () => {
  it("reads and displays a target outside the current list, highlights it and scrolls to it", async () => {
    client.setQueryData(queryKeys.notifications(), { items: [], unreadCount: 1 });
    await mount("/notifications?notificationId=7", true);
    expect(notificationsService.read).toHaveBeenCalledWith(7);
    expect(host.textContent).toContain(notification.title);
    expect(host.querySelector('[data-search-highlighted="true"]')?.textContent).toContain(notification.title);
    expect(host.textContent).not.toContain("暂无通知");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  // read 成功不应被无关列表刷新阻塞目标展示。
  it("shows a successfully read target without waiting for a slow notification-list refresh", async () => {
    const list = deferred<{ items: Notification[]; unreadCount: number }>();
    client.setQueryData(queryKeys.notifications(), { items: [], unreadCount: 1 });
    vi.mocked(notificationsService.list).mockReturnValue(list.promise);
    await mount("/notifications?notificationId=7", true);
    expect(notificationsService.read).toHaveBeenCalledWith(7);
    expect(notificationsService.list).toHaveBeenCalled();
    const visibleBeforeListReturns = host.textContent?.includes(notification.title);
    await act(async () => { list.resolve({ items: [], unreadCount: 0 }); });
    await settle();
    expect(host.textContent).toContain(notification.title);
    expect(visibleBeforeListReturns).toBe(true);
  });
});
