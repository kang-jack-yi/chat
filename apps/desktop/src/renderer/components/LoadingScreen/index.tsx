import { Spin } from "antd";
import { MessageCircleMore } from "lucide-react";

export default function LoadingScreen() {
  return (
    <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_50%_42%,var(--app-surface)_0%,var(--app-canvas)_68%)]">
      <div className="flex flex-col items-center gap-3 text-[var(--app-text-secondary)]">
        <div className="grid size-14 place-items-center rounded-2xl bg-[linear-gradient(145deg,#4192ff,#1677ff)] text-white shadow-[0_14px_30px_rgba(22,119,255,.24)]">
          <MessageCircleMore size={30} />
        </div>
        <strong className="text-base text-[var(--app-text)]">同频</strong>
        <Spin size="small" />
        <span className="text-xs">正在连接企业工作空间...</span>
      </div>
    </div>
  );
}
