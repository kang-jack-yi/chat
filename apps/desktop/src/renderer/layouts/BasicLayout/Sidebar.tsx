import { Building2, ContactRound, FileText, MessageCircleMore, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Dropdown, Tooltip } from "antd";
import Avatar from "../../components/Avatar";
import { ROUTES } from "../../constants/routes";
import { authService } from "../../services/auth";
import { useAppStore } from "../../stores/app-store";
import { useSyncStore } from "../../stores/sync-store";
import { useUserStore } from "../../stores/user-store";

interface NavItemProps {
  to: string;
  icon: ReactNode;
  label: string;
}

const railItem = "flex h-[50px] w-[46px] flex-col items-center justify-center gap-0.5 rounded-xl text-[var(--chat-text-secondary)] no-underline transition-colors duration-150 hover:bg-[var(--chat-rail-hover)] hover:text-[var(--chat-primary)] max-md:h-[48px] max-md:w-[44px]";

function NavItem({ to, icon, label }: NavItemProps) {
  return (
    <Tooltip placement="right" title={label}>
      <NavLink
        to={to}
        className={({ isActive }) => `${railItem} ${isActive ? "bg-[var(--chat-rail-active)] !text-[var(--chat-primary)]" : ""}`}
      >
        {icon}<span className="text-[11px]">{label}</span>
      </NavLink>
    </Tooltip>
  );
}

export default function Sidebar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useUserStore((state) => state.session);
  const clearSession = useUserStore((state) => state.clearSession);
  const resetApp = useAppStore((state) => state.reset);
  const setServerSettingsOpen = useAppStore((state) => state.setServerSettingsOpen);
  const setSettingsCenterOpen = useAppStore((state) => state.setSettingsCenterOpen);
  const isAdmin = ["owner", "admin"].includes(session?.user.role || "");

  async function logout() {
    await authService.logout().catch(() => undefined);
    queryClient.clear();
    clearSession();
    resetApp();
    useSyncStore.getState().reset();
    navigate(ROUTES.login, { replace: true });
  }

  return (
    <aside className="flex flex-col items-center border-r border-[var(--chat-line)] bg-[var(--chat-rail)] pt-3 pb-2 max-md:pt-2">
      <Dropdown
        trigger={["click"]}
        placement="bottomLeft"
        menu={{ items: [
          { key: "settings", label: "个人设置", onClick: () => setSettingsCenterOpen(true) },
          { key: "server", label: "服务器设置", onClick: () => setServerSettingsOpen(true) },
          { type: "divider" },
          { key: "logout", label: "退出登录", danger: true, onClick: () => void logout() },
        ] }}
      >
        <button
          type="button"
          aria-label="打开个人设置"
          className="mb-4 rounded-xl border-0 bg-[var(--app-surface-soft)] p-0.5 ring-1 ring-[var(--chat-line)] transition-shadow hover:ring-[var(--chat-primary)] max-md:mb-3"
        >
          <Avatar text={session?.user.avatar || ""} src={session?.user.avatarUrl} />
        </button>
      </Dropdown>
      <nav className="mt-2 grid w-full justify-items-center gap-1">
        <NavItem to={ROUTES.chat} icon={<MessageCircleMore size={22} />} label="消息" />
        <NavItem to={ROUTES.contacts} icon={<ContactRound size={22} />} label="通讯录" />
        <NavItem to={ROUTES.documents} icon={<FileText size={22} />} label="文档" />
        {isAdmin && <NavItem to={ROUTES.organization} icon={<Building2 size={22} />} label="组织管理" />}
      </nav>
      <div className="mt-auto grid w-full justify-items-center gap-1">
        <Tooltip placement="right" title="服务器设置">
          <Button
            type="text"
            className={`${railItem} !h-[52px] !gap-0.5 !text-[var(--chat-text-secondary)] hover:!bg-[var(--chat-rail-hover)] hover:!text-[var(--chat-primary)]`}
            onClick={() => setSettingsCenterOpen(true)}
            icon={<Settings size={22} />}
          >
            <span className="text-[11px]">设置</span>
          </Button>
        </Tooltip>
      </div>
    </aside>
  );
}
