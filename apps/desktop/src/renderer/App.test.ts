import { describe, expect, it } from "vitest";
import type { SessionData } from "@chat/shared";
import { canAccessOrganization, defaultRoute } from "./App";
import { ROUTES } from "./constants/routes";

function makeSession(role: SessionData["user"]["role"]): SessionData {
  return {
    company: { id: 1, name: "测试企业", code: "TEST", ownerId: 1 },
    user: {
      id: 1,
      companyId: 1,
      departmentId: 1,
      phone: "13800000001",
      name: "测试用户",
      title: "",
      avatar: "测",
      role,
      status: "active",
    },
  };
}

describe("route guards", () => {
  it("sends unauthenticated users to login", () => {
    expect(defaultRoute(null)).toBe(ROUTES.login);
  });

  it("sends authenticated users to chat", () => {
    expect(defaultRoute(makeSession("member"))).toBe(ROUTES.chat);
  });

  it("only allows owners and admins into organization routes", () => {
    expect(canAccessOrganization(makeSession("owner"))).toBe(true);
    expect(canAccessOrganization(makeSession("admin"))).toBe(true);
    expect(canAccessOrganization(makeSession("member"))).toBe(false);
  });

  it("keeps selected conversation and contact in route params", () => {
    expect(ROUTES.chatDetail(42)).toBe("/chat/42");
    expect(ROUTES.contactDetail(7)).toBe("/contacts/7");
  });
});
