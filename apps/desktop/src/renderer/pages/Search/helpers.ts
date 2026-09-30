import type { Notification, WorkspaceSearchHit } from "@chat/shared";
import { ROUTES } from "../../constants/routes";

/** 只接受正整数定位标识，忽略无效或越界的 URL 参数。 */
export function searchTargetId(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** 将非文档结果转换为保留目标标识的深链接；文档使用独立窗口打开。 */
export function searchResultRoute(hit: WorkspaceSearchHit): string | undefined {
  switch (hit.type) {
    case "message":
      return hit.conversationId
        ? `${ROUTES.chatDetail(hit.conversationId)}?messageId=${hit.messageId ?? hit.id}`
        : undefined;
    case "member":
      return ROUTES.contactDetail(hit.userId ?? hit.id);
    case "task":
      return `${ROUTES.tasks}?taskId=${hit.taskId ?? hit.id}`;
    case "notification":
      return `${ROUTES.notifications}?notificationId=${hit.notificationId ?? hit.id}`;
    case "document":
      return undefined;
  }
}

/** 任务通知优先定位任务，避免关联会话抢占到期提醒的跳转。 */
export function notificationRoute(item: Pick<Notification, "taskId" | "conversationId">) {
  if (item.taskId) return `${ROUTES.tasks}?taskId=${item.taskId}`;
  if (item.conversationId) return ROUTES.chatDetail(item.conversationId);
  return undefined;
}

/** 补入列表之外的搜索目标，同时保留原列表顺序且不重复显示。 */
export function includeSearchTarget<T extends { id: number }>(items: T[], target?: T): T[] {
  return target && !items.some((item) => item.id === target.id)
    ? [target, ...items]
    : items;
}
