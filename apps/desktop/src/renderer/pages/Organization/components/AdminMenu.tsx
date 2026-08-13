import { Building2, ChevronRight, Settings, ShieldCheck, Users } from "lucide-react";
import type { Company, Department, User } from "@chat/shared";
import PanelTitle from "../../../components/PanelTitle";

export interface AdminMenuProps {
  company: Company;
  users: User[];
  departments: Department[];
  mode: "members" | "departments";
  onModeChange: (mode: "members" | "departments") => void;
}

export default function AdminMenu({
  company,
  users,
  departments,
  mode,
  onModeChange,
}: AdminMenuProps) {
  const activeCount = users.filter((user) => user.status === "active").length;
  const activeRate = users.length ? Math.round((activeCount / users.length) * 100) : 0;

  return (
    <>
      <PanelTitle title="组织管理" />
      <div className="mx-4 overflow-hidden rounded-xl bg-[linear-gradient(145deg,#294fad_0%,#3d70eb_64%,#7899eb_100%)] p-4 text-white shadow-[0_10px_24px_rgba(47,107,255,.13)]">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-white/18 text-lg font-bold shadow-inner ring-1 ring-white/22">{company.name.slice(0, 1)}</div>
          <div className="min-w-0">
            <strong className="block truncate text-base">{company.name}</strong>
            <span className="mt-1 block text-xs text-white/65">企业编号 {company.code}</span>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/15 pt-3">
          <div><strong className="block text-xl">{activeCount}</strong><span className="text-xs text-white/65">在职成员</span></div>
          <div><strong className="block text-xl">{departments.length}</strong><span className="text-xs text-white/65">组织部门</span></div>
          <div><strong className="block text-xl">{activeRate}%</strong><span className="text-xs text-white/65">账号启用</span></div>
        </div>
      </div>

      <div className="mx-3 mt-4 grid gap-1">
        <button
          type="button"
          onClick={() => onModeChange("members")}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${mode === "members" ? "bg-[var(--app-surface)] text-[var(--app-text)] shadow-[var(--app-shadow-panel)] ring-1 ring-[var(--app-line)]" : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-muted)]"}`}
        >
          <span className={`grid size-8 place-items-center rounded-lg ${mode === "members" ? "bg-[var(--app-primary-soft)] text-[var(--app-primary)]" : "bg-[var(--app-surface-muted)] text-slate-500"}`}><Users size={16} /></span>
          <span className="flex-1">成员与账号</span>
          {mode === "members" && <ChevronRight size={15} className="text-slate-300" />}
        </button>
        <button
          type="button"
          onClick={() => onModeChange("departments")}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${mode === "departments" ? "bg-[var(--app-surface)] text-[var(--app-text)] shadow-[var(--app-shadow-panel)] ring-1 ring-[var(--app-line)]" : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-muted)]"}`}
        >
          <span className={`grid size-8 place-items-center rounded-lg ${mode === "departments" ? "bg-[var(--app-primary-soft)] text-[var(--app-primary)]" : "bg-[var(--app-surface-muted)] text-slate-500"}`}><Building2 size={16} /></span>
          <span className="flex-1">部门架构</span>
          {mode === "departments" && <ChevronRight size={15} className="text-slate-300" />}
        </button>
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[var(--app-text-secondary)]">
          <span className="grid size-8 place-items-center rounded-lg bg-[var(--app-surface-muted)] text-slate-500"><ShieldCheck size={16} /></span>
          <span className="flex-1">权限与安全</span>
        </div>
      </div>

      <div className="mx-4 mt-auto mb-4 flex gap-2 rounded-xl border border-[var(--app-line)] bg-[var(--app-surface-soft)] px-3 py-2.5 text-xs leading-relaxed text-[var(--app-text-secondary)]">
        <Settings size={17} className="shrink-0 text-slate-500" /><span>成员停用后将立即失去登录和实时连接权限</span>
      </div>
    </>
  );
}
