import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Empty, Segmented, Skeleton, Tag, message } from "antd";
import { ArrowUpRight, Bell, Check, CheckCheck, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Notification as AppNotification } from "@chat/shared";
import { queryKeys } from "../../constants/query-keys";
import { notificationsService } from "../../services/notifications";
import {
  includeSearchTarget,
  notificationRoute,
  searchTargetId,
} from "../Search/helpers";
import "./index.less";

const typeLabels: Record<AppNotification["type"], string> = {
  task_assigned: "任务分配",
  task_completed: "任务完成",
  task_due: "任务到期",
  mention: "提及",
  comment: "评论",
  system: "系统通知",
};

/** 将通知时间转换为本地月日和时分，供卡片展示。 */
function notificationTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** 展示通知工作台，保留已读操作、未读筛选与搜索目标定位。 */
export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const targetNotificationId = searchTargetId(
    searchParams.get("notificationId"),
  );
  const targetNotificationRef = useRef<HTMLElement | null>(null);
  // 定位通知时展示全部，其余筛选跟随 URL，切换工作视图后仍能恢复。
  const unreadOnly =
    !targetNotificationId && searchParams.get("unread") === "1";
  const notifications = useQuery({
    queryKey: queryKeys.notifications(
      targetNotificationId ? false : unreadOnly,
    ),
    queryFn: () =>
      notificationsService.list(targetNotificationId ? false : unreadOnly),
  });
  const searchTarget = useQuery({
    queryKey: ["notification-search-target", targetNotificationId],
    // 已读接口返回完整通知，可补回最近 100 条之外的目标通知。
    queryFn: async () => {
      const item = await notificationsService.read(targetNotificationId!);
      // 目标已返回即可展示；后台列表刷新较慢时不应阻塞搜索定位。
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      return item;
    },
    enabled: Boolean(targetNotificationId),
    retry: false,
    staleTime: 30_000,
  });
  const read = useMutation({
    mutationFn: (id: number) => notificationsService.read(id),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    onError: (error: Error) => message.error(error.message),
  });
  const readAll = useMutation({
    mutationFn: notificationsService.readAll,
    onSuccess: async ({ updatedCount }) => {
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
      if (updatedCount) message.success(`已读 ${updatedCount} 条通知`);
    },
    onError: (error: Error) => message.error(error.message),
  });
  const data = notifications.data;
  const items = includeSearchTarget(data?.items || [], searchTarget.data);

  // 无论目标来自当前列表还是补查，都滚动到其卡片并维持高亮。
  useEffect(() => {
    if (targetNotificationId)
      targetNotificationRef.current?.scrollIntoView({ block: "center" });
  }, [targetNotificationId, notifications.data, searchTarget.data]);

  /** 已读通知后打开关联资源，并反馈桌面文档窗口的打开失败。 */
  async function openNotification(item: AppNotification) {
    if (!item.readAt) read.mutate(item.id);
    try {
      const route = notificationRoute(item);
      if (route) navigate(route);
      else if (item.documentId) {
        if (!window.desktop) throw new Error("请在桌面客户端中打开文档");
        await window.desktop.windows.openDocument(item.documentId);
      }
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "无法打开通知关联内容",
      );
    }
  }

  return (
    <div className="workspace-page notifications-page">
      <div className="workspace-page-body notifications-page-content">
        <header className="workspace-page-header">
          <div className="workspace-page-heading">
            <span className="workspace-eyebrow">
              <Bell size={14} /> 消息与动态
            </span>
            <h1 className="workspace-page-title">通知中心</h1>
            <p className="workspace-page-description">
              集中查看任务、提及和系统通知。
            </p>
          </div>
          <div className="notifications-header-actions">
            <Button
              icon={<RefreshCw size={15} />}
              loading={notifications.isFetching || searchTarget.isFetching}
              onClick={() => {
                void notifications.refetch();
                if (targetNotificationId) void searchTarget.refetch();
              }}
            >
              刷新
            </Button>
            <Button
              icon={<CheckCheck size={16} />}
              disabled={!data?.unreadCount || readAll.isPending}
              loading={readAll.isPending}
              onClick={() => readAll.mutate()}
            >
              全部已读
            </Button>
          </div>
        </header>

        <section
          className="workspace-toolbar notifications-toolbar"
          aria-label="通知筛选"
        >
          <Segmented
            value={!targetNotificationId && unreadOnly ? "未读" : "全部"}
            options={["全部", "未读"]}
            onChange={(value) => {
              const next = new URLSearchParams(searchParams);
              next.delete("notificationId");
              if (value === "未读") next.set("unread", "1");
              else next.delete("unread");
              setSearchParams(next, { replace: true });
            }}
          />
          <span className="notifications-unread-count" aria-live="polite">
            <Bell size={14} />
            {notifications.isLoading ? (
              "正在同步通知"
            ) : (
              <>
                <strong>{data?.unreadCount || 0}</strong> 条未读
              </>
            )}
          </span>
        </section>

        {targetNotificationId && searchTarget.isError && (
          <Alert
            className="mb-4"
            type="error"
            showIcon
            title={searchTarget.error.message || "无法打开搜索结果"}
            action={
              <Button onClick={() => void searchTarget.refetch()}>重试</Button>
            }
          />
        )}
        <div
          className="notifications-list"
          aria-busy={
            notifications.isLoading ||
            Boolean(targetNotificationId && searchTarget.isLoading)
          }
        >
          {notifications.isError && (
            <Alert
              type="error"
              showIcon
              title={notifications.error.message || "通知加载失败"}
              action={
                <Button onClick={() => void notifications.refetch()}>
                  重试
                </Button>
              }
            />
          )}
          {(notifications.isLoading ||
            Boolean(targetNotificationId && searchTarget.isLoading)) && (
            <div
              className="workspace-panel notifications-state"
              role="status"
              aria-label="正在加载通知"
            >
              <Skeleton active paragraph={{ rows: 3 }} />
            </div>
          )}
          {items.map((item) => (
            <NotificationCard
              key={item.id}
              item={item}
              highlighted={item.id === targetNotificationId}
              targetRef={
                item.id === targetNotificationId
                  ? targetNotificationRef
                  : undefined
              }
              loading={read.isPending && read.variables === item.id}
              onRead={() => read.mutate(item.id)}
              onOpen={() => void openNotification(item)}
            />
          ))}
          {!notifications.isLoading &&
            !notifications.isError &&
            !searchTarget.isError &&
            !(targetNotificationId && searchTarget.isLoading) &&
            !items.length && (
              <div className="workspace-panel notifications-state">
                <Empty
                  image={<CheckCheck size={40} strokeWidth={1.4} />}
                  description={
                    <>
                      <strong>
                        {unreadOnly ? "暂无未读通知" : "暂无通知"}
                      </strong>
                      <p>
                        {unreadOnly
                          ? "所有动态都已查看，稍后有新消息会出现在这里。"
                          : "任务分配、提及和系统动态将在这里集中展示。"}
                      </p>
                    </>
                  }
                />
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

/** 展示通知类型和已读状态，并为搜索目标保留可见高亮。 */
function NotificationCard({
  item,
  highlighted,
  targetRef,
  loading,
  onRead,
  onOpen,
}: {
  item: AppNotification;
  highlighted: boolean;
  targetRef?: React.RefObject<HTMLElement | null>;
  loading: boolean;
  onRead: () => void;
  onOpen: () => void;
}) {
  const hasTarget = Boolean(
    item.conversationId ||
    item.taskId ||
    item.documentId ||
    notificationRoute(item),
  );
  const content = (
    <>
      <div className="notifications-card-heading">
        <strong>{item.title}</strong>
        <Tag>{typeLabels[item.type]}</Tag>
        {!item.readAt && (
          <span className="notifications-unread-dot" aria-label="未读" />
        )}
        {hasTarget && (
          <ArrowUpRight
            size={15}
            className="notifications-open-icon"
            aria-hidden="true"
          />
        )}
      </div>
      <p className="notifications-card-body">{item.body}</p>
      <time dateTime={item.createdAt}>{notificationTime(item.createdAt)}</time>
    </>
  );
  return (
    <article
      ref={targetRef}
      data-search-highlighted={highlighted || undefined}
      className={`workspace-panel notifications-card ${highlighted ? "ring-2 ring-[var(--app-primary)]" : ""} ${item.readAt ? "is-read" : "is-unread"}`}
    >
      <div className="notifications-card-icon" aria-hidden="true">
        {item.readAt ? <Check size={16} /> : <Bell size={16} />}
      </div>
      {hasTarget ? (
        <button
          type="button"
          className="notifications-card-content notifications-open"
          onClick={onOpen}
        >
          {content}
        </button>
      ) : (
        <div className="notifications-card-content">{content}</div>
      )}
      {!item.readAt && (
        <Button
          className="notifications-read-action"
          type="text"
          size="small"
          loading={loading}
          onClick={(event) => {
            event.stopPropagation();
            onRead();
          }}
        >
          标为已读
        </Button>
      )}
    </article>
  );
}
