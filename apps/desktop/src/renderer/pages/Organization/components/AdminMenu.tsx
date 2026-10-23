import {
  Building2,
  ChevronRight,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { Company, Department, User } from "@chat/shared";

export interface AdminMenuProps {
  company: Company;
  users: User[];
  departments: Department[];
  mode: "members" | "departments";
  onModeChange: (mode: "members" | "departments") => void;
}

/** 展示企业概览与管理目录，使用语义主题颜色区分当前分区。 */
export default function AdminMenu({
  company,
  users,
  departments,
  mode,
  onModeChange,
}: AdminMenuProps) {
  const activeCount = users.filter((user) => user.status === "active").length;
  const activeRate = users.length
    ? Math.round((activeCount / users.length) * 100)
    : 0;

  return (
    <>
      <header className="organization-directory-heading">
        <span className="workspace-eyebrow">企业工作台</span>
        <h2>组织管理</h2>
      </header>
      <div className="organization-company-card">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--app-primary-soft)] text-lg font-bold text-[var(--app-primary)]">
            {company.name.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <strong className="block truncate text-base">{company.name}</strong>
            <span className="mt-1 block text-xs text-[var(--app-text-secondary)]">
              企业编号 {company.code}
            </span>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--app-line)] pt-3">
          <div>
            <strong className="block text-xl">{activeCount}</strong>
            <span className="text-xs text-[var(--app-text-secondary)]">
              在职成员
            </span>
          </div>
          <div>
            <strong className="block text-xl">{departments.length}</strong>
            <span className="text-xs text-[var(--app-text-secondary)]">
              组织部门
            </span>
          </div>
          <div>
            <strong className="block text-xl">{activeRate}%</strong>
            <span className="text-xs text-[var(--app-text-secondary)]">
              账号启用
            </span>
          </div>
        </div>
      </div>

      <nav className="organization-menu" aria-label="组织管理分区">
        <button
          type="button"
          aria-current={mode === "members" ? "page" : undefined}
          onClick={() => onModeChange("members")}
          className="organization-menu-item"
        >
          <span
            className={`grid size-8 place-items-center rounded-lg ${mode === "members" ? "bg-[var(--app-primary-soft)] text-[var(--app-primary)]" : "bg-[var(--app-surface-muted)] text-[var(--app-text-secondary)]"}`}
          >
            <Users size={16} />
          </span>
          <span className="flex-1">成员与账号</span>
          {mode === "members" && (
            <ChevronRight size={15} className="text-[var(--app-primary)]" />
          )}
        </button>
        <button
          type="button"
          aria-current={mode === "departments" ? "page" : undefined}
          onClick={() => onModeChange("departments")}
          className="organization-menu-item"
        >
          <span
            className={`grid size-8 place-items-center rounded-lg ${mode === "departments" ? "bg-[var(--app-primary-soft)] text-[var(--app-primary)]" : "bg-[var(--app-surface-muted)] text-[var(--app-text-secondary)]"}`}
          >
            <Building2 size={16} />
          </span>
          <span className="flex-1">部门架构</span>
          {mode === "departments" && (
            <ChevronRight size={15} className="text-[var(--app-primary)]" />
          )}
        </button>
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[var(--app-text-secondary)]">
          <span className="grid size-8 place-items-center rounded-lg bg-[var(--app-surface-muted)] text-[var(--app-text-secondary)]">
            <ShieldCheck size={16} />
          </span>
          <span className="flex-1">权限与安全</span>
        </div>
      </nav>

      <div className="organization-security-note">
        <Settings
          size={17}
          className="shrink-0 text-[var(--app-text-secondary)]"
        />
        <span>成员停用后将立即失去登录和实时连接权限</span>
      </div>
    </>
  );
}
