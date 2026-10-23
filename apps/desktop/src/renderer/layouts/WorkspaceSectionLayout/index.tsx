import { useEffect, useRef } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BriefcaseBusiness, UsersRound } from "lucide-react";
import {
  matchesWorkspaceRoute,
  workspaceSections,
  type WorkspaceSection,
} from "../../constants/workspace-sections";
import { ROUTES } from "../../constants/routes";
import { queryKeys } from "../../constants/query-keys";
import { notificationsService } from "../../services/notifications";
import { useUserStore } from "../../stores/user-store";
import "./style.less";

/** 聚合同一业务区域的导航，保留原页面路由、定位参数和权限边界。 */
export default function WorkspaceSectionLayout({
  section,
}: {
  section: WorkspaceSection;
}) {
  const { pathname, search, hash } = useLocation();
  const role = useUserStore((state) => state.session?.user.role);
  const isAdmin = role === "owner" || role === "admin";
  const config = workspaceSections[section];
  const items = config.items.filter((item) => !item.adminOnly || isAdmin);
  const destinations = useRef<Record<string, string>>({});
  const current = items.find((item) =>
    matchesWorkspaceRoute(pathname, item.to),
  );
  const notifications = useQuery({
    queryKey: queryKeys.notifications(),
    queryFn: () => notificationsService.list(),
    staleTime: 30_000,
    enabled: section === "work",
  });
  const unreadCount = notifications.data?.unreadCount || 0;
  const Icon = section === "work" ? BriefcaseBusiness : UsersRound;

  // 在区域内来回切换时保留上次打开的联系人、任务和评审定位。
  useEffect(() => {
    if (current)
      destinations.current[current.to] = `${pathname}${search}${hash}`;
  }, [current, pathname, search, hash]);

  return (
    <section className={`workspace-section workspace-section-${section}`}>
      <header className="workspace-section-header">
        <div className="workspace-section-heading">
          <span className="workspace-section-symbol" aria-hidden="true">
            <Icon size={19} />
          </span>
          <div>
            <strong>{config.title}</strong>
            <p>
              {section === "team" && !isAdmin
                ? "查看同事资料，快速开始沟通"
                : config.description}
            </p>
          </div>
        </div>
        <nav
          className="workspace-section-nav"
          aria-label={`${config.title}视图`}
        >
          {items.map((item) => {
            const active = item === current;
            return (
              <Link
                key={item.to}
                to={
                  active
                    ? `${pathname}${search}${hash}`
                    : destinations.current[item.to] || item.to
                }
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={`workspace-section-link${active ? " is-active" : ""}`}
              >
                {item.label}
                {item.to === ROUTES.notifications && unreadCount > 0 && (
                  <span
                    className="workspace-section-badge"
                    aria-label={`${unreadCount} 条未读通知`}
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </header>
      <div className="workspace-section-content">
        <Outlet />
      </div>
    </section>
  );
}
