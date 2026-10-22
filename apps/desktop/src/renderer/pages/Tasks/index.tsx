import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Alert,
  DatePicker,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Tag,
  message,
} from "antd";
import {
  CheckCircle2,
  Circle,
  ListTodo,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import dayjs, { type Dayjs } from "dayjs";
import type { Task, TaskPriority, TaskStatus } from "@chat/shared";
import { queryKeys } from "../../constants/query-keys";
import { tasksService } from "../../services/tasks";
import { organizationService } from "../../services/organization";
import { useUserStore } from "../../stores/user-store";
import { includeSearchTarget, searchTargetId } from "../Search/helpers";

const priorityLabels: Record<TaskPriority, string> = {
  low: "低",
  normal: "普通",
  high: "高",
  urgent: "紧急",
};
const statusLabels: Record<TaskStatus, string> = {
  todo: "待处理",
  in_progress: "进行中",
  done: "已完成",
  cancelled: "已取消",
};

function dueText(value: string | null) {
  return value
    ? `截止 ${dayjs(value).format("YYYY-MM-DD HH:mm")}`
    : "未设置截止时间";
}

export default function TasksPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const targetTaskId = searchTargetId(searchParams.get("taskId"));
  const targetTaskRef = useRef<HTMLElement | null>(null);
  const currentUserId = useUserStore((state) => state.session?.user.id);
  const [status, setStatus] = useState<TaskStatus | "">("");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [dueAt, setDueAt] = useState<Dayjs | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAssigneeId, setEditAssigneeId] = useState<number>();
  const [editPriority, setEditPriority] = useState<TaskPriority>("normal");
  const [editDueAt, setEditDueAt] = useState<Dayjs | null>(null);
  const tasks = useQuery({
    queryKey: queryKeys.tasks(targetTaskId ? "" : status),
    queryFn: () =>
      tasksService.list(targetTaskId ? undefined : status || undefined),
  });
  const targetTask = useQuery({
    queryKey: ["tasks", "target", targetTaskId],
    queryFn: () => tasksService.detail(targetTaskId!),
    enabled: Boolean(targetTaskId),
    retry: false,
  });
  const users = useQuery({
    queryKey: queryKeys.users,
    queryFn: organizationService.users,
  });
  const create = useMutation({
    mutationFn: () =>
      tasksService.create({
        title: title.trim(),
        priority,
        dueAt: dueAt?.toISOString() || null,
      }),
    onSuccess: async () => {
      setTitle("");
      setDueAt(null);
      setPriority("normal");
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      message.success("任务已创建");
    },
    onError: (error: Error) => message.error(error.message),
  });
  const update = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: Parameters<typeof tasksService.update>[1];
    }) => tasksService.update(id, payload),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (error: Error) => message.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => tasksService.remove(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      message.success("任务已删除");
    },
    onError: (error: Error) => message.error(error.message),
  });
  const items = useMemo(
    () => includeSearchTarget(tasks.data || [], targetTask.data),
    [tasks.data, targetTask.data],
  );

  // 搜索定位时显示全部状态，避免已完成任务被既有筛选隐藏。
  useEffect(() => {
    if (targetTaskId) setStatus("");
  }, [targetTaskId]);

  // 数据到达后将目标滚动到可见区域，卡片高亮由 URL 标识维持。
  useEffect(() => {
    if (targetTaskId)
      targetTaskRef.current?.scrollIntoView({ block: "center" });
  }, [targetTaskId, tasks.data, targetTask.data]);

  function openEdit(task: Task) {
    setEditing(task);
    setEditTitle(task.title);
    setEditAssigneeId(task.assigneeId);
    setEditPriority(task.priority);
    setEditDueAt(task.dueAt ? dayjs(task.dueAt) : null);
  }

  function saveEdit() {
    if (!editing || !editTitle.trim() || !editAssigneeId) return;
    update.mutate(
      {
        id: editing.id,
        payload: {
          title: editTitle.trim(),
          assigneeId: editAssigneeId,
          priority: editPriority,
          dueAt: editDueAt?.toISOString() || null,
        },
      },
      { onSuccess: () => setEditing(null) },
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--app-canvas)] px-[clamp(20px,4vw,64px)] py-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="m-0 flex items-center gap-2 text-2xl font-semibold text-[var(--app-text)]">
              <ListTodo size={24} />
              我的任务
            </h1>
            <p className="mb-0 mt-1 text-sm text-[var(--app-text-secondary)]">
              集中查看和推进分配给你的工作事项。
            </p>
          </div>
          <Select
            value={targetTaskId ? "" : status}
            onChange={(value) => {
              setStatus(value);
              if (targetTaskId) {
                const next = new URLSearchParams(searchParams);
                next.delete("taskId");
                setSearchParams(next, { replace: true });
              }
            }}
            options={[
              { value: "", label: "全部状态" },
              ...Object.entries(statusLabels).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
        </header>

        <section className="mb-6 rounded-xl border border-[var(--app-line)] bg-[var(--app-surface)] p-4 shadow-[var(--app-shadow-panel)]">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="min-w-[260px] flex-1"
              value={title}
              maxLength={200}
              placeholder="输入任务标题"
              onChange={(event) => setTitle(event.target.value)}
              onPressEnter={() => title.trim() && create.mutate()}
            />
            <Select
              value={priority}
              onChange={setPriority}
              options={Object.entries(priorityLabels).map(([value, label]) => ({
                value,
                label: `优先级：${label}`,
              }))}
            />
            <DatePicker
              showTime
              value={dueAt}
              placeholder="截止时间"
              onChange={setDueAt}
            />
            <Button
              type="primary"
              icon={<Plus size={16} />}
              loading={create.isPending}
              disabled={!title.trim()}
              onClick={() => create.mutate()}
            >
              新增任务
            </Button>
          </div>
        </section>

        <div className="grid gap-3">
          {targetTask.isError && (
            <Alert type="error" showIcon title={targetTask.error.message} />
          )}
          {items.map((task) => {
            const canEdit = [task.creatorId, task.assigneeId].includes(
              currentUserId || 0,
            );
            const done = task.status === "done" || task.status === "cancelled";
            const nextStatus: TaskStatus =
              task.status === "todo"
                ? "in_progress"
                : task.status === "in_progress"
                  ? "done"
                  : "todo";
            return (
              <article
                key={task.id}
                ref={task.id === targetTaskId ? targetTaskRef : undefined}
                data-search-highlighted={task.id === targetTaskId || undefined}
                className={`flex items-center gap-3 rounded-xl border border-[var(--app-line)] bg-[var(--app-surface)] p-4 shadow-sm ${task.id === targetTaskId ? "ring-2 ring-[var(--app-primary)]" : ""}`}
              >
                <button
                  type="button"
                  aria-label={done ? "重新打开任务" : "推进任务"}
                  disabled={!canEdit}
                  className="text-[var(--app-primary)]"
                  onClick={() =>
                    update.mutate({
                      id: task.id,
                      payload: { status: nextStatus },
                    })
                  }
                >
                  {done ? <CheckCircle2 size={21} /> : <Circle size={21} />}
                </button>
                <div className="min-w-0 flex-1">
                  <strong
                    className={`block truncate text-sm ${done ? "text-[var(--app-text-tertiary)] line-through" : "text-[var(--app-text)]"}`}
                  >
                    {task.title}
                  </strong>
                  <span
                    className={`mt-1 block text-xs ${task.dueAt && task.status !== "done" && new Date(task.dueAt).getTime() < Date.now() ? "text-[var(--app-danger)]" : "text-[var(--app-text-tertiary)]"}`}
                  >
                    负责人：{task.assignee.name} · {dueText(task.dueAt)}
                    {task.dueAt &&
                    task.status !== "done" &&
                    new Date(task.dueAt).getTime() < Date.now()
                      ? " · 已逾期"
                      : ""}
                  </span>
                </div>
                <Tag
                  color={
                    task.priority === "urgent"
                      ? "red"
                      : task.priority === "high"
                        ? "orange"
                        : "blue"
                  }
                >
                  {priorityLabels[task.priority]}
                </Tag>
                <Tag>{statusLabels[task.status]}</Tag>
                {!canEdit && <Tag>仅查看</Tag>}
                <Button
                  type="text"
                  aria-label="编辑任务"
                  disabled={!canEdit}
                  icon={<Pencil size={16} />}
                  onClick={() => openEdit(task)}
                />
                {task.creatorId === currentUserId && (
                  <Popconfirm
                    title="删除这个任务？"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => remove.mutate(task.id)}
                  >
                    <Button
                      type="text"
                      danger
                      aria-label="删除任务"
                      icon={<Trash2 size={16} />}
                    />
                  </Popconfirm>
                )}
              </article>
            );
          })}
          {!tasks.isLoading &&
            !targetTask.isLoading &&
            !targetTask.isError &&
            !items.length && <Empty description="暂无任务" />}
        </div>
      </div>
      <Modal
        open={Boolean(editing)}
        title="编辑任务"
        okText="保存"
        cancelText="取消"
        confirmLoading={update.isPending}
        okButtonProps={{ disabled: !editTitle.trim() || !editAssigneeId }}
        onCancel={() => setEditing(null)}
        onOk={saveEdit}
        destroyOnHidden
      >
        <Input.TextArea
          value={editTitle}
          maxLength={200}
          showCount
          rows={3}
          onChange={(event) => setEditTitle(event.target.value)}
        />
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Select
            value={editAssigneeId}
            className="w-full"
            disabled={editing ? editing.creatorId !== currentUserId : false}
            options={(users.data || [])
              .filter((user) => user.status === "active")
              .map((user) => ({
                value: user.id,
                label: `负责人：${user.name}`,
              }))}
            onChange={setEditAssigneeId}
          />
          <Select
            value={editPriority}
            className="w-full"
            options={Object.entries(priorityLabels).map(([value, label]) => ({
              value,
              label: `优先级：${label}`,
            }))}
            onChange={setEditPriority}
          />
          <DatePicker
            className="w-full"
            showTime
            value={editDueAt}
            placeholder="截止时间"
            onChange={setEditDueAt}
          />
        </div>
      </Modal>
    </div>
  );
}
