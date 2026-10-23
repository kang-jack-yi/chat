import { Building2, ShieldCheck, Users } from "lucide-react";

export interface AdminMenuProps {
  mode: "members" | "departments";
  onModeChange: (mode: "members" | "departments") => void;
}

/** 将成员和部门操作收进页内切换，避免重复显示企业概览和侧栏。 */
export default function AdminMenu({ mode, onModeChange }: AdminMenuProps) {
  return (
    <div className="organization-controls">
      <nav className="organization-menu" aria-label="组织管理分区">
        <button
          type="button"
          aria-current={mode === "members" ? "page" : undefined}
          onClick={() => onModeChange("members")}
          className="organization-menu-item"
        >
          <Users size={16} />
          成员与账号
        </button>
        <button
          type="button"
          aria-current={mode === "departments" ? "page" : undefined}
          onClick={() => onModeChange("departments")}
          className="organization-menu-item"
        >
          <Building2 size={16} />
          部门架构
        </button>
      </nav>

      <div className="organization-security-note">
        <ShieldCheck
          size={17}
          className="shrink-0 text-[var(--app-text-secondary)]"
        />
        <span>成员停用后将立即失去登录和实时连接权限</span>
      </div>
    </div>
  );
}
