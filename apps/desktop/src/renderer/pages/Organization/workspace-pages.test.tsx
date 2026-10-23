// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudDocument, User } from "@chat/shared";
import { queryKeys } from "../../constants/query-keys";
import { useUserStore } from "../../stores/user-store";
import { useServerStore } from "../../stores/server-store";
import { useAppStore } from "../../stores/app-store";
import LoginPage from "../Login";
import DocumentsPage from "../Documents";
import ContactDetail from "../Contacts/components/ContactDetail";
import ContactsList from "../Contacts/components/ContactsList";
import OrganizationPage from "./index";

const company = { id: 1, name: "测试协作企业", code: "TEST", ownerId: 1 };
const user: User = {
  id: 1,
  companyId: 1,
  departmentId: 10,
  name: "林远",
  phone: "13800000001",
  avatar: "林",
  title: "产品负责人",
  email: "",
  bio: "",
  presenceStatus: "available",
  statusText: "",
  statusExpiresAt: null,
  role: "owner",
  status: "active",
  departmentName: "产品中心",
};

describe("工作台页面布局重构回归", () => {
  let root: Root;
  let host: HTMLDivElement;
  let client: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      })),
    );
    const computedStyle = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
      computedStyle(element),
    );
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(queryKeys.users, [user]);
    client.setQueryData(queryKeys.departments, [
      { id: 10, companyId: 1, parentId: null, name: "产品中心", sortOrder: 0 },
    ]);
    useUserStore.setState({ session: { user, company } });
    useServerStore.setState({ status: "online", health: null, error: "" });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    useUserStore.setState({ session: null });
    useServerStore.getState().reset();
    useAppStore.getState().reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** 使用真实页面和内存查询缓存挂载，不连接数据库或真实业务接口。 */
  async function renderPage(page: ReactNode) {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>{page}</MemoryRouter>
        </QueryClientProvider>,
      ),
    );
  }

  /** 通过可见按钮文字定位，兼容组件库插入的中文字符空格。 */
  function button(label: string, scope: ParentNode = document.body) {
    const target = [...scope.querySelectorAll("button")].find(
      (item) => item.textContent?.replace(/\s/g, "") === label,
    );
    if (!target) throw new Error(`缺少按钮：${label}`);
    return target;
  }

  it("登录注册表单切换保留字段、自动填充语义与离线禁用反馈", async () => {
    await renderPage(<LoginPage />);
    expect(
      host.querySelector('input[name="phone"]')?.getAttribute("autocomplete"),
    ).toBe("username");
    expect(
      host
        .querySelector('input[name="password"]')
        ?.getAttribute("autocomplete"),
    ).toBe("current-password");
    const registrationTab = [
      ...host.querySelectorAll<HTMLElement>('[role="tab"]'),
    ].find((tab) => tab.textContent === "创建企业")!;
    await act(async () => registrationTab.click());
    expect(host.querySelector('input[name="companyName"]')).not.toBeNull();
    expect(host.querySelector('input[name="name"]')).not.toBeNull();
    expect(
      host
        .querySelector('input[name="password"]')
        ?.getAttribute("autocomplete"),
    ).toBe("new-password");
    await act(async () =>
      useServerStore.getState().setOffline("验收服务器离线"),
    );
    expect(button("创建并进入").disabled).toBe(true);
    expect(host.textContent).toContain("验收服务器离线");
  });

  it("通讯录选中状态可访问，点击成员仍传递真实成员标识", async () => {
    const select = vi.fn();
    await renderPage(
      <ContactsList
        company={company}
        users={[user]}
        query=""
        selectedId={1}
        onQueryChange={vi.fn()}
        onSelect={select}
      />,
    );
    const member = host.querySelector<HTMLButtonElement>(
      '[aria-pressed="true"]',
    )!;
    expect(member.textContent).toContain("林远");
    await act(async () => member.click());
    expect(select).toHaveBeenCalledWith(1);
  });

  it("文档协作者首字头像使用语义主题颜色，不回退为灰底黑字", async () => {
    const document: CloudDocument = {
      id: 7,
      companyId: 1,
      ownerId: 1,
      title: "协作文档",
      type: "doc",
      icon: "",
      color: "",
      permission: "owner",
      favorite: false,
      members: [{ userId: 1, name: "林远", avatar: "林", permission: "owner" }],
      createdAt: "2026-10-22T12:00:00Z",
      updatedAt: "2026-10-22T12:00:00Z",
    };
    client.setQueryData(queryKeys.documents("recent", ""), [document]);
    await renderPage(<DocumentsPage />);
    const avatar = host.querySelector<HTMLElement>(
      ".ant-avatar-group .ant-avatar",
    )!;
    expect(avatar.textContent).toBe("林");
    expect(avatar.style.backgroundColor).toBe("var(--app-primary-soft)");
    expect(avatar.style.color).toBe("var(--app-primary)");
    expect(
      host.querySelector('[aria-label="更多操作：协作文档"]'),
    ).not.toBeNull();
  });

  it("成员资料保留手机号与私聊入口，本人资料不提供自聊入口", async () => {
    const startChat = vi.fn();
    const colleague = { ...user, id: 2, name: "周琪", role: "member" as const };
    await renderPage(
      <ContactDetail
        user={colleague}
        currentUser={user}
        starting={false}
        onStartChat={startChat}
      />,
    );
    expect(host.textContent).toContain(user.phone);
    await act(async () => button("发消息", host).click());
    expect(startChat).toHaveBeenCalledWith(2);
    await renderPage(
      <ContactDetail
        user={user}
        currentUser={user}
        starting={false}
        onStartChat={startChat}
      />,
    );
    expect(host.textContent).not.toContain("发消息");
  });

  it("窄屏组织模式入口可以切换部门架构并打开新建部门弹窗", async () => {
    await renderPage(<OrganizationPage />);
    const mobileNav = host.querySelector(".organization-mobile-nav")!;
    await act(async () => button("部门架构", mobileNav).click());
    expect(button("部门架构", mobileNav).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(host.querySelector(".organization-departments")).not.toBeNull();
    await act(async () => button("新建部门", host).click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("部门名称");
    expect(dialog.textContent).toContain("上级部门");
    expect(dialog.querySelector('input[id$="name"]')).not.toBeNull();
    await act(async () => button("取消", dialog).click());
  });

  it("添加成员弹窗保留姓名、手机号、密码、部门、职位和角色字段", async () => {
    await renderPage(<OrganizationPage />);
    await act(async () => button("添加成员", host).click());
    const dialog = document.querySelector('[role="dialog"]')!;
    for (const label of [
      "姓名",
      "手机号",
      "登录密码",
      "所属部门",
      "职位",
      "角色",
    ]) {
      expect(dialog.textContent).toContain(label);
    }
    expect(dialog.querySelector('input[type="password"]')).not.toBeNull();
    await act(async () => button("取消", dialog).click());
  });
});
