import type { Department, User } from "@chat/shared";
import { get, patch, post } from "./request";

export const organizationService = {
  users: () => get<User[]>("/api/users"),
  departments: () => get<Department[]>("/api/departments"),
  createUser: (payload: Record<string, unknown>) => post<User>("/api/users", payload),
  setUserStatus: (userId: number, status: User["status"]) =>
    post<User>(`/api/users/${userId}/status`, { status }),
  createDepartment: (payload: { name: string; parentId: number | null }) =>
    post<Department>("/api/departments", payload),
  updateDepartment: (id: number, payload: { name: string; parentId: number | null }) =>
    patch<Department>(`/api/departments/${id}`, payload),
};
