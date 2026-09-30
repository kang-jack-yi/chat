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
  create: (input: CreateTaskInput) => post<Task>("/api/tasks", input),
  update: (id: number, input: Partial<CreateTaskInput> & { status?: TaskStatus }) => patch<Task>(`/api/tasks/${id}`, input),
  remove: (id: number) => remove<boolean>(`/api/tasks/${id}`),
};
