// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation, Message, User } from "@chat/shared";
import { useChat, useConversations } from "./hooks";
import { chatService } from "../../services/chat";
import { queryKeys } from "../../constants/query-keys";
import { useWorkspaceEvents } from "../../hooks/useWorkspaceEvents";

const { listeners, socket } = vi.hoisted(() => {
  const listeners = new Map<string, Set<(message: Message) => unknown>>();
  return {
    listeners,
    socket: {
      on: (name: string, listener: (message: Message) => unknown) => {
        const callbacks = listeners.get(name) ?? new Set();
        callbacks.add(listener);
        listeners.set(name, callbacks);
      },
      off: (name: string, listener: (message: Message) => unknown) => {
        listeners.get(name)?.delete(listener);
      },
      emit: vi.fn(),
    },
  };
});
vi.mock("../../hooks/useSocket", () => ({ useSocket: () => socket }));
vi.mock("../../services/chat", () => ({
  chatService: { conversations: vi.fn(), messages: vi.fn(), read: vi.fn() },
}));
vi.mock("../../services/local-database", () => ({
  localDatabase: { available: () => false },
}));

const currentUser: User = {
  id: 1,
  companyId: 1,
  departmentId: null,
  phone: "13800000001",
  name: "成员",
  title: "",
  avatar: "成",
  email: "",
  bio: "",
  presenceStatus: "available",
  statusText: "",
  statusExpiresAt: null,
  role: "member",
  status: "active",
};
const active: Conversation = {
  id: 1,
  type: "group",
  createdBy: 2,
  name: "当前群聊",
  avatar: "群",
  lastMessage: "原消息",
  lastMessageId: 10,
  lastMessageAt: "2026-10-23T08:00:00Z",
  unreadCount: 0,
  memberCount: 2,
  members: [],
};
const other: Conversation = { ...active, id: 2, unreadCount: 5 };

/** 构造通过真实实时消息处理链路写入缓存的消息。 */
function message(id: number): Message {
  return {
    schemaVersion: 1,
    id,
    clientId: `message-${id}`,
    conversationId: 1,
    senderId: 2,
    senderName: "同事",
    senderAvatar: "同",
    kind: "user",
    parts: [],
    summary: `消息${id}`,
    version: 1,
    createdAt: "2026-10-23T08:00:00Z",
    updatedAt: "2026-10-23T08:00:00Z",
    deletedAt: null,
  };
}

/** 手动控制已读确认和列表快照的返回顺序。 */
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
let client: QueryClient;
let serverUnread: number;
let lastMessageId: number;
let readRequest: ReturnType<typeof deferred<{ messageId: number }>>;

/** 同时订阅真实列表与会话 Hook，不模拟 React Query 的失效和通知行为。 */
function Harness({
  conversationId,
  focusedMessageId,
}: {
  conversationId: number;
  focusedMessageId?: number;
}) {
  const conversations = useConversations();
  useWorkspaceEvents();
  useChat(conversationId, currentUser, focusedMessageId);
  return (
    <>
      {conversations.data?.map((item) => (
        <output key={item.id} data-conversation-id={item.id}>
          {item.unreadCount}
        </output>
      ))}
    </>
  );
}

/** 推进真实 Promise 和查询通知队列。 */
async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** 从独立服务端状态生成快照，避免测试与客户端共享可变对象。 */
function conversationSnapshot() {
  return [
    { ...active, lastMessageId, unreadCount: serverUnread },
    { ...other },
  ];
}

/** 挂载或切换会话后等待已读流程，再开始实时消息场景。 */
async function mount(conversationId = 1, focusedMessageId?: number) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness
          conversationId={conversationId}
          focusedMessageId={focusedMessageId}
        />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

/** 发送 Socket 新消息，但保留已读请求挂起以暴露列表/已读的竞态。 */
async function receiveMessage() {
  serverUnread = 1;
  lastMessageId = 11;
  await act(async () => {
    listeners.get("message:new")?.forEach((listener) => {
      void listener(message(11));
    });
  });
  await settle();
}

/** 确认服务端完成已读，再允许客户端处理响应。 */
async function confirmRead() {
  serverUnread = 0;
  await act(async () => readRequest.resolve({ messageId: 11 }));
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  serverUnread = 0;
  lastMessageId = 10;
  readRequest = deferred();
  vi.mocked(chatService.conversations).mockImplementation(async () =>
    conversationSnapshot(),
  );
  vi.mocked(chatService.read).mockImplementation(async (_id, messageId) =>
    messageId === 11 ? readRequest.promise : { messageId },
  );
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.conversations, conversationSnapshot());
  client.setQueryData(queryKeys.messages(1), {
    pages: [{ items: [message(10)], nextCursor: null }],
    pageParams: [undefined],
  });
  client.setQueryData(queryKeys.messages(2), {
    pages: [
      { items: [{ ...message(20), conversationId: 2 }], nextCursor: null },
    ],
    pageParams: [undefined],
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("active conversation unread cache", () => {
  it("refreshes an unread list snapshot after the server confirms read", async () => {
    await mount();
    await receiveMessage();
    expect(chatService.read).toHaveBeenCalledWith(1, 11);
    expect(host.querySelector('[data-conversation-id="1"]')?.textContent).toBe(
      "1",
    );
    await confirmRead();
    expect(serverUnread).toBe(0);
    expect(host.querySelector('[data-conversation-id="1"]')?.textContent).toBe(
      "0",
    );
    expect(host.querySelector('[data-conversation-id="2"]')?.textContent).toBe(
      "5",
    );
  });

  it("does not let a list response started before read acknowledgement restore stale unread", async () => {
    await mount();
    const staleList = deferred<Conversation[]>();
    vi.mocked(chatService.conversations).mockReturnValueOnce(staleList.promise);
    await receiveMessage();
    const snapshot = conversationSnapshot();
    await confirmRead();
    await act(async () => staleList.resolve(snapshot));
    await settle();
    expect(serverUnread).toBe(0);
    expect(host.querySelector('[data-conversation-id="1"]')?.textContent).toBe(
      "0",
    );
    expect(host.querySelector('[data-conversation-id="2"]')?.textContent).toBe(
      "5",
    );
  });

  it("preserves newer background unread when an older read is acknowledged after switching conversations", async () => {
    await mount();
    await receiveMessage();
    await mount(2);
    lastMessageId = 12;
    serverUnread = 1;
    await act(async () => {
      listeners.get("message:new")?.forEach((listener) => {
        void listener(message(12));
      });
      listeners.get("conversation:updated")?.forEach((listener) => {
        void listener(message(12));
      });
    });
    await settle();
    await act(async () => readRequest.resolve({ messageId: 11 }));
    await settle();
    expect(chatService.read).not.toHaveBeenCalledWith(1, 12);
    expect(host.querySelector('[data-conversation-id="1"]')?.textContent).toBe(
      "1",
    );
    expect(
      client
        .getQueryData<Conversation[]>(queryKeys.conversations)
        ?.find((item) => item.id === 1)?.lastMessageId,
    ).toBe(12);
  });

  it("keeps unread when read confirmation fails", async () => {
    await mount();
    await receiveMessage();
    const refreshCount = vi.mocked(chatService.conversations).mock.calls.length;
    await act(async () => readRequest.reject(new Error("read failed")));
    await settle();
    expect(host.querySelector('[data-conversation-id="1"]')?.textContent).toBe(
      "1",
    );
    expect(chatService.conversations).toHaveBeenCalledTimes(refreshCount);
  });

  it("refreshes after acknowledging the initial message page without a socket event", async () => {
    vi.mocked(chatService.read).mockReturnValue(readRequest.promise);
    serverUnread = 1;
    await mount();
    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.conversations });
    });
    await settle();
    expect(host.querySelector('[data-conversation-id="1"]')?.textContent).toBe(
      "1",
    );
    serverUnread = 0;
    await act(async () => readRequest.resolve({ messageId: 10 }));
    await settle();
    expect(host.querySelector('[data-conversation-id="1"]')?.textContent).toBe(
      "0",
    );
  });

  it("refreshes socket read confirmations while a search result is focused", async () => {
    client.setQueryData(queryKeys.messageContext(1, 10), {
      items: [message(10)],
      targetId: 10,
    });
    await mount(1, 10);
    expect(chatService.read).not.toHaveBeenCalled();
    await receiveMessage();
    expect(chatService.read).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-conversation-id="1"]')?.textContent).toBe(
      "1",
    );
    await confirmRead();
    expect(host.querySelector('[data-conversation-id="1"]')?.textContent).toBe(
      "0",
    );
  });
});
