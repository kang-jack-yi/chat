import type { Task, TaskPriority, TaskStatus } from "@chat/shared";
import { get, patch, post, remove } from "./request";

export interface CreateTaskInput {
  title: string;
  assigneeId?: number;
  conversationId?: number;
  messageId?: number;
  priority?: TaskPriority;
  dueAt?: string | null;
}

export const tasksService = {
  list: (status?: TaskStatus) => get<Task[]>("/api/tasks", { params: status ? { status } : undefined }),
  /** 补查通知、搜索或审批关联的指定任务，不扩大“我的任务”列表。 */
  detail: (id: number) => get<Task>(`/api/tasks/${id}`),
  create: (input: CreateTaskInput) => post<Task>("/api/tasks", input),
  update: (id: number, input: Partial<CreateTaskInput> & { status?: TaskStatus }) => patch<Task>(`/api/tasks/${id}`, input),
  remove: (id: number) => remove<boolean>(`/api/tasks/${id}`),
};
