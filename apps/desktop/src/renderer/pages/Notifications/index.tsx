import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Empty, Segmented, Tag, message } from "antd";
import { Bell, Check, CheckCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Notification as AppNotification } from "@chat/shared";
import { queryKeys } from "../../constants/query-keys";
import { ROUTES } from "../../constants/routes";
import { notificationsService } from "../../services/notifications";

const typeLabels: Record<AppNotification["type"], string> = {
  task_assigned: "任务分配",
  task_completed: "任务完成",
  mention: "提及",
  comment: "评论",
  system: "系统通知",
};

function notificationTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const notifications = useQuery({
    queryKey: queryKeys.notifications(unreadOnly),
    queryFn: () => notificationsService.list(unreadOnly),
  });
  const read = useMutation({
    mutationFn: (id: number) => notificationsService.read(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
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
  const items = data?.items || [];

  function openNotification(item: AppNotification) {
    if (!item.readAt) read.mutate(item.id);
    if (item.conversationId) navigate(ROUTES.chatDetail(item.conversationId));
    else if (item.taskId) navigate(ROUTES.tasks);
    else if (item.documentId) void window.desktop?.windows.openDocument(item.documentId);
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--app-canvas)] px-[clamp(20px,4vw,64px)] py-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="m-0 flex items-center gap-2 text-2xl font-semibold text-[var(--app-text)]"><Bell size={24} />通知中心</h1>
            <p className="mb-0 mt-1 text-sm text-[var(--app-text-secondary)]">集中查看任务、提及和系统通知。</p>
          </div>
          <Button icon={<CheckCheck size={16} />} disabled={!data?.unreadCount || readAll.isPending} loading={readAll.isPending} onClick={() => readAll.mutate()}>全部已读</Button>
        </header>

        <section className="mb-4 flex items-center justify-between rounded-xl border border-[var(--app-line)] bg-[var(--app-surface)] p-3 shadow-[var(--app-shadow-panel)]">
          <Segmented
            value={unreadOnly ? "未读" : "全部"}
            options={["全部", "未读"]}
            onChange={(value) => setUnreadOnly(value === "未读")}
          />
          <span className="text-sm text-[var(--app-text-secondary)]">{data?.unreadCount || 0} 条未读</span>
        </section>

        <div className="grid gap-3">
          {items.map((item) => (
            <NotificationCard key={item.id} item={item} loading={read.isPending} onRead={() => read.mutate(item.id)} onOpen={() => openNotification(item)} />
          ))}
          {!notifications.isLoading && !items.length && <Empty description={unreadOnly ? "暂无未读通知" : "暂无通知"} />}
        </div>
      </div>
    </div>
  );
}

function NotificationCard({ item, loading, onRead, onOpen }: { item: AppNotification; loading: boolean; onRead: () => void; onOpen: () => void }) {
  return (
    <article className={`flex items-start gap-3 rounded-xl border bg-[var(--app-surface)] p-4 shadow-sm ${item.readAt ? "border-[var(--app-line)]" : "border-[var(--app-primary)]/35"} ${item.conversationId || item.taskId || item.documentId ? "cursor-pointer transition-shadow hover:shadow-md" : ""}`} onClick={item.conversationId || item.taskId || item.documentId ? onOpen : undefined}>
      <div className={`mt-0.5 rounded-full p-2 ${item.readAt ? "bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]" : "bg-[var(--app-primary)]/10 text-[var(--app-primary)]"}`}>
        {item.readAt ? <Check size={16} /> : <Bell size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-sm text-[var(--app-text)]">{item.title}</strong>
          <Tag>{typeLabels[item.type]}</Tag>
          {!item.readAt && <span className="h-1.5 w-1.5 rounded-full bg-[var(--app-primary)]" aria-label="未读" />}
        </div>
        <p className="mb-1 mt-1 text-sm text-[var(--app-text-secondary)]">{item.body}</p>
        <time className="text-xs text-[var(--app-text-tertiary)]">{notificationTime(item.createdAt)}</time>
      </div>
      {!item.readAt && <Button type="text" size="small" loading={loading} onClick={(event) => { event.stopPropagation(); onRead(); }}>标为已读</Button>}
    </article>
  );
}
