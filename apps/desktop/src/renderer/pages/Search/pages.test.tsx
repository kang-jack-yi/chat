import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { Notification, Task } from "@chat/shared";
import SearchPage from "./index";
import TasksPage from "../Tasks";
import NotificationsPage from "../Notifications";
import { queryKeys } from "../../constants/query-keys";

const notification: Notification = {
  id: 7,
  type: "task_due",
  title: "较早的到期通知",
  body: "季度计划即将到期",
  entityType: "task",
  entityId: "17",
  taskId: 17,
  conversationId: 42,
  documentId: null,
  readAt: "2026-09-30T00:00:00Z",
  createdAt: "2026-09-01T00:00:00Z",
};
const task: Task = {
  id: 17,
  companyId: 1,
  creatorId: 1,
  assigneeId: 2,
  conversationId: 42,
  messageId: 3,
  title: "已完成的搜索目标任务",
  status: "done",
  priority: "normal",
  dueAt: null,
  completedAt: "2026-09-30T00:00:00Z",
  creator: { id: 1, name: "创建者", avatar: "创" },
  assignee: { id: 2, name: "负责人", avatar: "负" },
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-30T00:00:00Z",
};

/** 使用真实路由和查询缓存渲染页面，检验用户可见的定位状态。 */
function renderPage(page: ReactNode, route: string, client: QueryClient) {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** 创建隔离缓存，避免渲染测试产生真实网络请求或相互污染。 */
function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
}

describe("workspace search pages", () => {
  it("shows a keyword input, type filter and initial empty guidance", () => {
    const client = createClient();
    const html = renderPage(<SearchPage />, "/search", client);
    expect(html).toContain("工作区搜索");
    expect(html).toContain('aria-label="搜索关键词"');
    expect(html).toContain('aria-label="搜索类型"');
    expect(html).toContain("输入关键词开始搜索");
    client.clear();
  });

  it("visibly highlights a completed task selected by its deep link", () => {
    const client = createClient();
    client.setQueryData(queryKeys.tasks(), [task]);
    client.setQueryData(queryKeys.users, []);
    const html = renderPage(<TasksPage />, "/tasks?taskId=17", client);
    expect(html).toContain("已完成的搜索目标任务");
    expect(html).toContain('data-search-highlighted="true"');
    expect(html).toContain("ring-2 ring-[var(--app-primary)]");
    expect(html).toContain("全部状态");
    client.clear();
  });

  it("does not highlight unrelated tasks", () => {
    const client = createClient();
    client.setQueryData(queryKeys.tasks(), [task]);
    client.setQueryData(queryKeys.users, []);
    const html = renderPage(<TasksPage />, "/tasks?taskId=18", client);
    expect(html).not.toContain("data-search-highlighted");
    client.clear();
  });

  it("renders an older notification outside the current list with due label and highlight", () => {
    const client = createClient();
    client.setQueryData(queryKeys.notifications(), { items: [], unreadCount: 0 });
    client.setQueryData(["notification-search-target", 7], notification);
    const html = renderPage(<NotificationsPage />, "/notifications?notificationId=7", client);
    expect(html).toContain("较早的到期通知");
    expect(html).toContain("任务到期");
    expect(html).toContain('data-search-highlighted="true"');
    expect(html).toContain("ring-2 ring-[var(--app-primary)]");
    expect(html).not.toContain("暂无通知");
    client.clear();
  });

  it("renders a matching notification only once", () => {
    const client = createClient();
    client.setQueryData(queryKeys.notifications(), { items: [notification], unreadCount: 0 });
    client.setQueryData(["notification-search-target", 7], notification);
    const html = renderPage(<NotificationsPage />, "/notifications?notificationId=7", client);
    expect(html.split("较早的到期通知")).toHaveLength(2);
    client.clear();
  });

  it("does not highlight notifications without a search target", () => {
    const client = createClient();
    client.setQueryData(queryKeys.notifications(), { items: [notification], unreadCount: 0 });
    const html = renderPage(<NotificationsPage />, "/notifications", client);
    expect(html).toContain("任务到期");
    expect(html).not.toContain("data-search-highlighted");
    client.clear();
  });
});
