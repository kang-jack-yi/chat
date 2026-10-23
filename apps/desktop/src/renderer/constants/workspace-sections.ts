import { ROUTES } from "./routes";

export const workspaceSections = {
  work: {
    title: "工作中心",
    description: "跟进待办，处理审批，查看工作动态",
    items: [
      { to: ROUTES.tasks, label: "任务", adminOnly: false },
      { to: ROUTES.reviews, label: "审批", adminOnly: false },
      { to: ROUTES.notifications, label: "通知", adminOnly: false },
    ],
  },
  team: {
    title: "团队",
    description: "找到同事，了解团队，管理组织",
    items: [
      { to: ROUTES.contacts, label: "通讯录", adminOnly: false },
      { to: ROUTES.organization, label: "组织管理", adminOnly: true },
    ],
  },
} as const;

export type WorkspaceSection = keyof typeof workspaceSections;

/** 匹配页面及其详情路径，避免相似前缀误点亮其他入口。 */
export function matchesWorkspaceRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}
