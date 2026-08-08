import { describe, expect, it } from "vitest";
import type { User } from "@chat/shared";
import { filterMembers } from "./member-filter";

const users: User[] = [
  {
    id: 1,
    companyId: 1,
    departmentId: 10,
    phone: "13800000001",
    name: "林远",
    title: "产品负责人",
    avatar: "林",
    role: "owner",
    status: "active",
    departmentName: "产品中心",
  },
  {
    id: 2,
    companyId: 1,
    departmentId: 20,
    phone: "13800000002",
    name: "周琪",
    title: "后端工程师",
    avatar: "周",
    role: "member",
    status: "disabled",
    departmentName: "技术中心",
  },
];

describe("filterMembers", () => {
  it("支持按姓名、手机号、职位和部门名称搜索", () => {
    expect(filterMembers(users, { keyword: "后端" }).map((user) => user.id)).toEqual([2]);
    expect(filterMembers(users, { keyword: "13800000001" }).map((user) => user.id)).toEqual([1]);
    expect(filterMembers(users, { keyword: "产品中心" }).map((user) => user.id)).toEqual([1]);
  });

  it("支持组合部门、角色和状态筛选", () => {
    expect(filterMembers(users, {
      keyword: "",
      departmentId: 20,
      role: "member",
      status: "disabled",
    }).map((user) => user.id)).toEqual([2]);
    expect(filterMembers(users, {
      keyword: "",
      departmentId: 10,
      status: "disabled",
    })).toEqual([]);
  });
});
