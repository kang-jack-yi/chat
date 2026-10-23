import {
  Bell,
  Building2,
  ChevronDown,
  ClipboardCheck,
  ContactRound,
  FileText,
  ListTodo,
  LogOut,
  MessageCircleMore,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dropdown, message, Tooltip } from "antd";
import Avatar from "../../components/Avatar";
import { ROUTES } from "../../constants/routes";
import { queryKeys } from "../../constants/query-keys";
import { authService } from "../../services/auth";
import { notificationsService } from "../../services/notifications";
import { useDesktopPreferences } from "../../hooks/useDesktopPreferences";
import { useAppStore } from "../../stores/app-store";
import { useSyncStore } from "../../stores/sync-store";
import { useUserStore } from "../../stores/user-store";

interface NavItemProps {
  to: string;
  icon: ReactNode;
  label: string;
  badge?: number;
}

/** 渲染包含当前页状态和未读数量的导航项。 */
function NavItem({ to, icon, label, badge = 0 }: NavItemProps) {
  return (
    <Tooltip placement="right" title={label}>
      <NavLink
        to={to}
        aria-label={label}
        className={({ isActive }) =>
          `workspace-nav-item${isActive ? " is-active" : ""}`
        }
      >
        <span className="workspace-nav-icon">{icon}</span>
        <span className="workspace-nav-label">{label}</span>
        {badge > 0 && (
          <span className="workspace-nav-badge">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </NavLink>
    </Tooltip>
  );
}

/** 提供可折叠工作台导航、主题快捷切换与账号操作。 */
export default function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useUserStore((state) => state.session);
  const clearSession = useUserStore((state) => state.clearSession);
  const resetApp = useAppStore((state) => state.reset);
  const setServerSettingsOpen = useAppStore(
    (state) => state.setServerSettingsOpen,
  );
  const setSettingsCenterOpen = useAppStore(
    (state) => state.setSettingsCenterOpen,
  );
  const { preferences, update } = useDesktopPreferences();
  const isAdmin = ["owner", "admin"].includes(session?.user.role || "");
  const notifications = useQuery({
    queryKey: queryKeys.notifications(),
    queryFn: () => notificationsService.list(),
    staleTime: 30_000,
  });
  const mode = preferences?.appearance.theme || "system";
  const ThemeIcon = mode === "dark" ? Moon : mode === "light" ? Sun : Monitor;

  /** 清理账号会话、查询缓存和同步状态后返回登录页。 */
  async function logout() {
    await authService.logout().catch(() => undefined);
    queryClient.clear();
    clearSession();
    resetApp();
    useSyncStore.getState().reset();
    navigate(ROUTES.login, { replace: true });
  }

  return (
    <aside
      id="workspace-sidebar"
      className="workspace-sidebar"
      aria-label="工作台导航"
    >
      <div className="workspace-brand">
        <span className="workspace-brand-mark">
          <MessageCircleMore size={23} />
        </span>
        <span className="workspace-brand-copy">
          <strong>同频</strong>
          <small>让协作，自然发生</small>
        </span>
        <Tooltip placement="right" title={collapsed ? "展开导航" : "折叠导航"}>
          <button
            type="button"
            className="workspace-sidebar-toggle"
            aria-label={collapsed ? "展开导航" : "折叠导航"}
            aria-expanded={!collapsed}
            aria-controls="workspace-sidebar"
            onClick={onToggle}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
        </Tooltip>
      </div>
      <div className="workspace-company" title={session?.company.name}>
        <span className="workspace-company-symbol">
          <Building2 size={16} />
        </span>
        <span className="workspace-company-copy">
          <strong>{session?.company.name || "企业空间"}</strong>
          <small>团队工作空间</small>
        </span>
      </div>
      <div className="workspace-nav-caption">工作空间</div>
      <nav className="workspace-nav">
        <NavItem
          to={ROUTES.chat}
          icon={<MessageCircleMore size={19} />}
          label="消息"
        />
        <NavItem to={ROUTES.search} icon={<Search size={19} />} label="搜索" />
        <NavItem
          to={ROUTES.contacts}
          icon={<ContactRound size={19} />}
          label="通讯录"
        />
        <NavItem
          to={ROUTES.documents}
          icon={<FileText size={19} />}
          label="文档"
        />
        <NavItem
          to={ROUTES.reviews}
          icon={<ClipboardCheck size={19} />}
          label="审批"
        />
        <NavItem to={ROUTES.tasks} icon={<ListTodo size={19} />} label="任务" />
        <NavItem
          to={ROUTES.notifications}
          icon={<Bell size={19} />}
          label="通知"
          badge={notifications.data?.unreadCount}
        />
        {isAdmin && (
          <NavItem
            to={ROUTES.organization}
            icon={<Building2 size={19} />}
            label="组织管理"
          />
        )}
      </nav>
      <div className="workspace-sidebar-footer">
        <div className="workspace-sidebar-tools">
          <button
            type="button"
            className="workspace-nav-item"
            aria-label="打开设置"
            title="设置"
            onClick={() => setSettingsCenterOpen(true)}
          >
            <span className="workspace-nav-icon">
              <Settings size={19} />
            </span>
            <span className="workspace-nav-label">设置</span>
          </button>
          <Dropdown
            trigger={["click"]}
            placement="topLeft"
            menu={{
              selectedKeys: [mode],
              items: [
                { key: "light", icon: <Sun size={15} />, label: "浅色模式" },
                { key: "dark", icon: <Moon size={15} />, label: "深色模式" },
                {
                  key: "system",
                  icon: <Monitor size={15} />,
                  label: "跟随系统",
                },
              ],
              onClick: ({ key }) => {
                void update({
                  appearance: { theme: key as "light" | "dark" | "system" },
                }).catch(() => message.error("主题保存失败，请重试"));
              },
            }}
          >
            <button
              type="button"
              aria-label="切换主题"
              title="切换主题"
              className="workspace-theme-button"
            >
              <ThemeIcon size={18} />
            </button>
          </Dropdown>
        </div>
        <Dropdown
          trigger={["click"]}
          placement="topLeft"
          menu={{
            items: [
              {
                key: "settings",
                icon: <Settings size={15} />,
                label: "个人设置",
                onClick: () => setSettingsCenterOpen(true),
              },
              {
                key: "server",
                icon: <Building2 size={15} />,
                label: "服务器设置",
                onClick: () => setServerSettingsOpen(true),
              },
              { type: "divider" },
              {
                key: "logout",
                icon: <LogOut size={15} />,
                label: "退出登录",
                danger: true,
                onClick: () => void logout(),
              },
            ],
          }}
        >
          <button
            type="button"
            aria-label="打开个人设置"
            className="workspace-account"
          >
            <Avatar
              text={session?.user.avatar || ""}
              src={session?.user.avatarUrl}
            />
            <span className="workspace-account-copy">
              <strong>{session?.user.name}</strong>
              <small>
                <i />
                在线 · 一起高效工作
              </small>
            </span>
            <ChevronDown size={14} className="workspace-account-chevron" />
          </button>
        </Dropdown>
      </div>
    </aside>
  );
}
