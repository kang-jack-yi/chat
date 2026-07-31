import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { useWorkspaceEvents } from "../../hooks/useWorkspaceEvents";
import { useOutbox } from "../../hooks/useOutbox";
import { useSyncStore } from "../../stores/sync-store";

export default function BasicLayout() {
  useWorkspaceEvents();
  useOutbox();
  const syncStatus = useSyncStore((state) => state.status);
  const visible = syncStatus.phase && !["idle", "offline"].includes(syncStatus.phase);
  return (
    <div className="relative grid h-full grid-cols-[58px_minmax(0,1fr)] bg-[var(--app-canvas)] max-md:grid-cols-[54px_minmax(0,1fr)]">
      <Sidebar />
      <main className="h-full min-h-0 min-w-0 overflow-hidden"><Outlet /></main>
      {visible && (
        <div className={`absolute right-6 bottom-5 z-50 rounded-full border px-3.5 py-2 text-xs shadow-[0_12px_30px_rgba(39,48,67,.18)] backdrop-blur-xl ${
          syncStatus.phase === "error" ? "border-[#ffd7de] bg-[#fff4f6]/95 text-[#cf3f59]" : "border-white/20 bg-[#283044]/92 text-white"
        }`}>
          {syncStatus.message || "正在同步"}
        </div>
      )}
    </div>
  );
}
