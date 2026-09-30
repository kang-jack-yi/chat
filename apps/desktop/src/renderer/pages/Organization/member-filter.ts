import type { User } from "@chat/shared";

export interface MemberFilterValue {
  keyword: string;
  departmentId?: number;
  role?: User["role"];
  status?: User["status"];
}

export function filterMembers(users: User[], filters: MemberFilterValue) {
  const keyword = filters.keyword.trim().toLocaleLowerCase();

  return users.filter((user) => {
    const matchesKeyword =
      !keyword ||
      [user.name, user.phone, user.title, user.departmentName].some((value) =>
        String(value || "")
          .toLocaleLowerCase()
          .includes(keyword),
      );
    const matchesDepartment =
      filters.departmentId === undefined ||
      user.departmentId === filters.departmentId;
    const matchesRole =
      filters.role === undefined || user.role === filters.role;
    const matchesStatus =
      filters.status === undefined || user.status === filters.status;

    return matchesKeyword && matchesDepartment && matchesRole && matchesStatus;
  });
}
