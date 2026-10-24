// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Conversation, User } from "@chat/shared";
import InviteGroupMembersModal from "./InviteGroupMembersModal";
import { queryKeys } from "../../../constants/query-keys";
import { chatService } from "../../../services/chat";

vi.mock("../../../services/chat", () => ({
  chatService: { addMembers: vi.fn() },
}));
vi.mock("../../../services/organization", () => ({
  organizationService: { departments: vi.fn() },
}));

/** 构造同部门的正常企业成员，复用真实目录树和勾选事件。 */
function user(id: number, name: string): User {
  return {
    id,
    name,
    companyId: 1,
    departmentId: 1,
    phone: `1380000000${id}`,
    title: "设计师",
    avatar: name.slice(0, 1),
    email: "",
    bio: "",
    presenceStatus: "available",
    statusText: "",
    statusExpiresAt: null,
    role: "member",
    status: "active",
  };
}
const users = [user(1, "群主"), user(2, "张三"), user(3, "李四")];
const conversation: Conversation = {
  id: 99,
  type: "group",
  createdBy: 1,
  name: "邀请验收",
  avatar: "群",
  lastMessage: "",
  lastMessageId: 0,
  lastMessageAt: "2026-10-24T00:00:00Z",
  unreadCount: 0,
  memberCount: 1,
  members: [users[0]],
};
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;

/** 等待真实组件状态与查询完成，不替换 Ant Design 的 Tree 和 Modal。 */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 在输入框中执行搜索，触发和真实用户相同的 input 事件。 */
async function search(name: string) {
  const input = document.querySelector<HTMLInputElement>(
    '[aria-label="搜索企业成员"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

/** 勾选指定成员对应的真实树节点。 */
async function toggle(name: string) {
  const title = [
    ...document.querySelectorAll(".invite-member-person-copy strong"),
  ].find((node) => node.textContent === name)!;
  const checkbox = title
    .closest(".ant-tree-treenode")!
    .querySelector<HTMLElement>(".ant-tree-checkbox")!;
  await act(async () => checkbox.click());
  await settle();
}

/** 读取用户可见的已选名单，而非页面内部状态。 */
function selectedNames() {
  return [...document.querySelectorAll(".invite-members-selected-name")].map(
    (node) => node.textContent,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
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
  const getComputedStyle = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    getComputedStyle(element),
  );
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.departments, [
    { id: 1, companyId: 1, name: "产品部", parentId: null, sortOrder: 0 },
  ]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(chatService.addMembers).mockResolvedValue(true);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <InviteGroupMembersModal
          open
          conversation={conversation}
          users={users}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    ),
  );
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  client.clear();
  Reflect.deleteProperty(window, "desktop");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("切换搜索再选择成员时保留筛选外的已选项，取消当前项不影响其他成员", async () => {
  await search("张三");
  await toggle("张三");
  await search("李四");
  await toggle("李四");
  expect(selectedNames()).toEqual(["张三", "李四"]);
  await toggle("李四");
  expect(selectedNames()).toEqual(["张三"]);
  await search("");
  expect(selectedNames()).toEqual(["张三"]);
});

it("读取附带历史期间不可提交，读取成功后提交成员和对应记录", async () => {
  await search("张三");
  await toggle("张三");
  let finish!: (ids: number[]) => void;
  const history = new Promise<number[]>((resolve) => {
    finish = resolve;
  });
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: { windows: { getRecentInviteHistoryIds: () => history } },
  });
  const checkbox = document.querySelector<HTMLInputElement>(
    '[aria-label="附带最近聊天记录"]',
  )!;
  await act(async () => checkbox.click());
  const submit = document.querySelector<HTMLButtonElement>(
    ".invite-members-action-buttons .ant-btn-primary",
  )!;
  expect(submit.disabled).toBe(true);
  await act(async () => finish([41, 42]));
  expect(submit.disabled).toBe(false);
  await act(async () => submit.click());
  await settle();
  expect(chatService.addMembers).toHaveBeenCalledWith(99, [2], [41, 42]);
});
