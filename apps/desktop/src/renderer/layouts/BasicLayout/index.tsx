import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { useWorkspaceEvents } from "../../hooks/useWorkspaceEvents";
import { useOutbox } from "../../hooks/useOutbox";
import { useSyncStore } from "../../stores/sync-store";
import { useAppStore } from "../../stores/app-store";

/** 承载自适应导航和业务页面，保留后台同步进度反馈。 */
export default function BasicLayout() {
  useWorkspaceEvents();
  useOutbox();
  const sidebarPreference = useAppStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const [compactViewport, setCompactViewport] = useState(
    () => window.matchMedia("(max-width: 1180px)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1180px)");
    /** 窗口改变时更新自动布局，不覆盖手动折叠选择。 */
    function updateCompactViewport() {
      setCompactViewport(media.matches);
    }
    updateCompactViewport();
    media.addEventListener("change", updateCompactViewport);
    return () => media.removeEventListener("change", updateCompactViewport);
  }, []);

  const sidebarCollapsed = sidebarPreference ?? compactViewport;
  const syncStatus = useSyncStore((state) => state.status);
  const visible =
    syncStatus.phase && !["idle", "offline"].includes(syncStatus.phase);
  return (
    <div
      className={`workspace-shell${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
    >
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <main className="workspace-main">
        <Outlet />
      </main>
      {visible && (
        <div
          role="status"
          className={`workspace-sync-status${syncStatus.phase === "error" ? " is-error" : ""}`}
        >
          {syncStatus.message || "正在同步"}
        </div>
      )}
    </div>
  );
}
