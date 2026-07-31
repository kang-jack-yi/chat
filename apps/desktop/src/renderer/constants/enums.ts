import type { UserRole } from "@chat/shared";

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "企业所有者",
  admin: "管理员",
  member: "成员",
};
