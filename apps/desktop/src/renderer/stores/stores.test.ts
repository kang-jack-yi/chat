import { beforeEach, describe, expect, it } from "vitest";
import type { SessionData } from "@chat/shared";
import { useAppStore } from "./app-store";
import { useUserStore } from "./user-store";
import { useServerStore } from "./server-store";
import { useChatDraftStore } from "./chat-draft-store";

const session: SessionData = {
  company: { id: 1, name: "示例企业", code: "DEMO", ownerId: 1 },
  user: {
    id: 1,
    companyId: 1,
    departmentId: 1,
    phone: "13800000001",
    name: "林默",
    title: "负责人",
    avatar: "林",
    email: "",
    bio: "",
    presenceStatus: "available",
    statusText: "",
    statusExpiresAt: null,
    role: "owner",
    status: "active",
  },
};

describe("Zustand stores", () => {
  beforeEach(() => {
    useUserStore.setState({ session: null, bootstrapped: false });
    useAppStore.getState().reset();
    useServerStore.getState().reset();
    useChatDraftStore.getState().reset();
  });

  it("tracks server health independently from the signed-in user", () => {
    const server = {
      url: "https://chat.example.com",
      serverId: "server-1",
      name: "Enterprise Chat",
      apiVersion: "1",
      socketPath: "/socket.io",
    };
    const health = {
      serviceId: "enterprise-chat" as const,
      serverId: "server-1",
      name: "Enterprise Chat",
      apiVersion: "1" as const,
      socketPath: "/socket.io" as const,
      minDesktopVersion: "1.0.0",
      features: { companyRegistration: true, fileUpload: true },
      serverTime: new Date().toISOString(),
    };
    useServerStore.getState().setOnline(server, health);
    expect(useServerStore.getState()).toMatchObject({ server, health, status: "online" });
    useServerStore.getState().setOffline("network error");
    expect(useServerStore.getState()).toMatchObject({ status: "offline", error: "network error" });
  });

  it("stores the bootstrapped session", () => {
    useUserStore.getState().setSession(session);
    expect(useUserStore.getState()).toMatchObject({ session, bootstrapped: true });
  });

  it("clears session on logout", () => {
    useUserStore.getState().setSession(session);
    useChatDraftStore.getState().updateDraft(9, (draft) => ({
      ...draft,
      text: "未发送内容",
    }));
    useUserStore.getState().clearSession();
    expect(useUserStore.getState().session).toBeNull();
    expect(useUserStore.getState().bootstrapped).toBe(true);
    expect(useChatDraftStore.getState().drafts).toEqual({});
  });

  it("resets cross-page UI state while preserving the sidebar preference", () => {
    const app = useAppStore.getState();
    app.setMobileDetailOpen(true);
    app.setGroupDialogOpen(true);
    app.setSidebarCollapsed(true);
    useAppStore.getState().reset();
    expect(useAppStore.getState()).toMatchObject({
      mobileDetailOpen: false,
      groupDialogOpen: false,
      sidebarCollapsed: true,
    });
  });
});
