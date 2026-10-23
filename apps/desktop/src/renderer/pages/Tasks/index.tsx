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
  Skeleton,
  Tag,
  message,
} from "antd";
import {
  CheckCircle2,
  Circle,
  CircleDot,
  ListTodo,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import dayjs, { type Dayjs } from "dayjs";
import type { Task, TaskPriority, TaskStatus } from "@chat/shared";
import { queryKeys } from "../../constants/query-keys";
import { tasksService } from "../../services/tasks";
import { organizationService } from "../../services/organization";
import { useUserStore } from "../../stores/user-store";
import { includeSearchTarget, searchTargetId } from "../Search/helpers";
import "./index.less";

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

/** 将任务截止时间格式化为包含完整日期的提示。 */
function dueText(value: string | null) {
  return value
    ? `截止 ${dayjs(value).format("YYYY-MM-DD HH:mm")}`
    : "未设置截止时间";
}

/** 展示任务工作台，保留状态流转、编辑权限与深链接定位。 */
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

  /** 将选中任务载入编辑表单，不改变原有负责人权限。 */
  function openEdit(task: Task) {
    setEditing(task);
    setEditTitle(task.title);
    setEditAssigneeId(task.assigneeId);
    setEditPriority(task.priority);
    setEditDueAt(task.dueAt ? dayjs(task.dueAt) : null);
  }

  /** 校验编辑字段后保存任务，并在成功后关闭弹窗。 */
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
    <div className="workspace-page tasks-page">
      <div className="workspace-page-body tasks-page-content">
        <header className="workspace-page-header">
          <div className="workspace-page-heading">
            <span className="workspace-eyebrow">
              <ListTodo size={14} /> 工作事项
            </span>
            <h1 className="workspace-page-title">我的任务</h1>
            <p className="workspace-page-description">
              集中查看和推进分配给你的工作事项。
            </p>
          </div>
          <Button
            icon={<RefreshCw size={15} />}
            loading={tasks.isFetching || targetTask.isFetching}
            onClick={() => {
              void tasks.refetch();
              if (targetTaskId) void targetTask.refetch();
            }}
          >
            刷新
          </Button>
        </header>

        <section className="workspace-panel tasks-create" aria-label="新增任务">
          <div className="tasks-section-heading">
            <h2>快速新建</h2>
            <span>记录下一项待办，让协作有序推进</span>
          </div>
          <form
            className="tasks-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim() && !create.isPending) create.mutate();
            }}
          >
            <label className="tasks-field tasks-title-field">
              <span>任务标题</span>
              <Input
                aria-label="任务标题"
                value={title}
                maxLength={200}
                placeholder="输入任务标题"
                disabled={create.isPending}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="tasks-field">
              <span>优先级</span>
              <Select
                aria-label="任务优先级"
                value={priority}
                onChange={setPriority}
                disabled={create.isPending}
                options={Object.entries(priorityLabels).map(
                  ([value, label]) => ({ value, label: `优先级：${label}` }),
                )}
              />
            </label>
            <label className="tasks-field">
              <span>截止时间</span>
              <DatePicker
                aria-label="任务截止时间"
                showTime
                value={dueAt}
                placeholder="选择截止时间"
                disabled={create.isPending}
                onChange={setDueAt}
              />
            </label>
            <Button
              htmlType="submit"
              type="primary"
              icon={<Plus size={16} />}
              loading={create.isPending}
              disabled={!title.trim()}
            >
              新增任务
            </Button>
          </form>
        </section>

        <section
          className="workspace-toolbar tasks-toolbar"
          aria-label="任务筛选"
        >
          <div className="tasks-section-heading">
            <h2>任务列表</h2>
            <span aria-live="polite">当前视图 {items.length} 项</span>
          </div>
          <div className="tasks-status-filter">
            <span id="tasks-status-label">状态</span>
            <Select
              aria-labelledby="tasks-status-label"
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
          </div>
        </section>

        <div
          className="tasks-list"
          aria-busy={
            tasks.isLoading || Boolean(targetTaskId && targetTask.isLoading)
          }
        >
          {tasks.isError && (
            <Alert
              type="error"
              showIcon
              title={tasks.error.message || "任务加载失败"}
              action={
                <Button onClick={() => void tasks.refetch()}>重试</Button>
              }
            />
          )}
          {targetTask.isError && (
            <Alert
              type="error"
              showIcon
              title={targetTask.error.message}
              action={
                <Button onClick={() => void targetTask.refetch()}>重试</Button>
              }
            />
          )}
          {(tasks.isLoading ||
            Boolean(targetTaskId && targetTask.isLoading)) && (
            <div
              className="workspace-panel tasks-loading"
              role="status"
              aria-label="正在加载任务"
            >
              <Skeleton active paragraph={{ rows: 3 }} />
            </div>
          )}
          {items.map((task) => {
            const canEdit = [task.creatorId, task.assigneeId].includes(
              currentUserId || 0,
            );
            const done = task.status === "done" || task.status === "cancelled";
            const overdue = Boolean(
              task.dueAt &&
              !done &&
              new Date(task.dueAt).getTime() < Date.now(),
            );
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
                className={`workspace-panel tasks-card ${task.id === targetTaskId ? "ring-2 ring-[var(--app-primary)]" : ""}`}
              >
                <button
                  type="button"
                  aria-label={done ? "重新打开任务" : "推进任务"}
                  disabled={!canEdit || update.isPending}
                  className={`tasks-progress ${done ? "is-complete" : ""}`}
                  onClick={() =>
                    update.mutate({
                      id: task.id,
                      payload: { status: nextStatus },
                    })
                  }
                >
                  {done ? (
                    <CheckCircle2 size={21} />
                  ) : task.status === "in_progress" ? (
                    <CircleDot size={21} />
                  ) : (
                    <Circle size={21} />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <strong
                    className={`tasks-card-title ${done ? "is-complete" : ""}`}
                  >
                    {task.title}
                  </strong>
                  <span
                    className={`tasks-card-meta ${overdue ? "is-overdue" : ""}`}
                  >
                    负责人：{task.assignee.name} · {dueText(task.dueAt)}
                    {overdue ? " · 已逾期" : ""}
                  </span>
                </div>
                <div className="tasks-card-actions">
                  <Tag
                    className={`tasks-priority tasks-priority-${task.priority}`}
                  >
                    {priorityLabels[task.priority]}
                  </Tag>
                  <Tag>{statusLabels[task.status]}</Tag>
                  {!canEdit && <Tag>仅查看</Tag>}
                  <Button
                    type="text"
                    aria-label="编辑任务"
                    disabled={!canEdit || update.isPending}
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
                        loading={
                          remove.isPending && remove.variables === task.id
                        }
                        icon={<Trash2 size={16} />}
                      />
                    </Popconfirm>
                  )}
                </div>
              </article>
            );
          })}
          {!tasks.isLoading &&
            !tasks.isError &&
            !(targetTaskId && targetTask.isLoading) &&
            !targetTask.isError &&
            !items.length && (
              <div className="workspace-panel tasks-empty">
                <Empty
                  image={<ListTodo size={40} strokeWidth={1.4} />}
                  description={
                    <>
                      <strong>暂无任务</strong>
                      <p>
                        {status
                          ? "试试切换状态，查看其他工作事项。"
                          : "在上方新建任务，开始安排接下来的工作。"}
                      </p>
                    </>
                  }
                />
              </div>
            )}
        </div>
      </div>
      <Modal
        open={Boolean(editing)}
        className="tasks-edit-modal"
        title="编辑任务"
        okText="保存"
        cancelText="取消"
        confirmLoading={update.isPending}
        okButtonProps={{ disabled: !editTitle.trim() || !editAssigneeId }}
        onCancel={() => setEditing(null)}
        onOk={saveEdit}
        destroyOnHidden
      >
        <label className="tasks-field">
          <span>任务标题</span>
          <Input.TextArea
            aria-label="编辑任务标题"
            value={editTitle}
            maxLength={200}
            showCount
            rows={3}
            onChange={(event) => setEditTitle(event.target.value)}
          />
        </label>
        <div className="tasks-edit-fields">
          <Select
            aria-label="任务负责人"
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
            aria-label="编辑任务优先级"
            value={editPriority}
            className="w-full"
            options={Object.entries(priorityLabels).map(([value, label]) => ({
              value,
              label: `优先级：${label}`,
            }))}
            onChange={setEditPriority}
          />
          <DatePicker
            aria-label="编辑任务截止时间"
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
