import { useMemo, useState } from "react";
import { Button, Card } from "antd";
import { Building2, CircleOff, Plus, ShieldCheck, UsersRound } from "lucide-react";
import { useUserStore } from "../../stores/user-store";
import AdminMenu from "./components/AdminMenu";
import DepartmentGrid from "./components/DepartmentGrid";
import MemberTable from "./components/MemberTable";
import MemberToolbar from "./components/MemberToolbar";
import OrganizationModal from "./components/OrganizationModal";
import { filterMembers, type MemberFilterValue } from "./member-filter";
import { useOrganization } from "./hooks";

export default function OrganizationPage() {
  const session = useUserStore((state) => state.session)!;
  const organization = useOrganization();
  const users = organization.users.data ?? [];
  const departments = organization.departments.data ?? [];
  const activeUsers = users.filter((user) => user.status === "active").length;
  const disabledUsers = users.length - activeUsers;
  const managerUsers = users.filter((user) => user.role === "owner" || user.role === "admin").length;
  const unassignedUsers = users.filter((user) => !user.departmentId).length;
  const [filters, setFilters] = useState<MemberFilterValue>({ keyword: "" });
  const filteredUsers = useMemo(() => filterMembers(users, filters), [filters, users]);

  return (
    <div className="grid h-full grid-cols-[300px_minmax(0,1fr)] bg-[var(--app-canvas)] max-lg:grid-cols-[280px_minmax(0,1fr)] max-md:block">
      <section className="flex min-w-0 flex-col overflow-hidden border-r border-[var(--app-line)] bg-[var(--app-surface-soft)] max-md:hidden">
        <AdminMenu
          company={session.company}
          users={users}
          departments={departments}
          mode={organization.mode}
          onModeChange={organization.setMode}
        />
      </section>
      <main className="h-full overflow-y-auto bg-[radial-gradient(circle_at_85%_2%,#e8f2ff_0%,#f8fafc_28%,#f2f5fa_64%)] px-[clamp(20px,3vw,40px)] py-6 max-md:px-4 max-md:py-5">
        <div className="mx-auto w-full max-w-[1180px]">
          <header className="mb-4 flex items-center justify-between gap-6">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--app-primary-soft)] text-[var(--app-primary)] ring-1 ring-[#1677ff]/10">
                <Building2 size={20} />
              </span>
              <div className="min-w-0">
                <h1 className="m-0 truncate text-[22px] font-semibold tracking-[-0.3px] text-[var(--app-text)]">{session.company.name}</h1>
                <p className="mt-1 mb-0 text-xs text-[var(--app-text-secondary)]">
                  企业编号 {session.company.code} · {users.length} 名成员 · {departments.length} 个部门
                </p>
              </div>
            </div>
            <Button type="primary" icon={<Plus size={16} />} onClick={organization.openCreateModal}>
              {organization.mode === "members" ? "添加成员" : "新建部门"}
            </Button>
          </header>

          {organization.mode === "members" && <div className="mb-4 grid grid-cols-4 overflow-hidden rounded-[14px] border border-white/80 bg-white/90 shadow-[0_8px_24px_rgba(39,48,67,.045)] max-sm:grid-cols-2">
            {[
              { label: "在职成员", value: activeUsers, icon: <UsersRound size={18} />, tone: "bg-[#e8f2ff] text-[#1677ff]" },
              { label: "管理角色", value: managerUsers, icon: <ShieldCheck size={18} />, tone: "bg-[#eef0ff] text-[#6658d3]" },
              { label: "停用账号", value: disabledUsers, icon: <CircleOff size={18} />, tone: "bg-[#fff0f1] text-[#df586b]" },
              { label: "未分配部门", value: unassignedUsers, icon: <Building2 size={18} />, tone: "bg-[#fff6e7] text-[#d68a16]" },
            ].map((item, index) => (
              <div key={item.label} className={`flex items-center gap-3 px-4 py-3.5 ${index ? "border-l border-[var(--app-line)]" : ""}`}>
                <span className={`grid size-9 shrink-0 place-items-center rounded-[10px] ${item.tone}`}>{item.icon}</span>
                <span className="min-w-0">
                  <span className="block truncate text-xs text-[var(--app-text-tertiary)]">{item.label}</span>
                  <strong className="mt-0.5 block text-xl font-semibold text-[var(--app-text)]">
                    {item.value}<small className="ml-1 text-xs font-normal text-[var(--app-text-tertiary)]">人</small>
                  </strong>
                </span>
              </div>
            ))}
          </div>}

          <Card className="overflow-hidden !rounded-[14px] !border-white/80 !bg-white/95 shadow-[0_10px_30px_rgba(39,48,67,.06)]" styles={{ body: { padding: 0 } }}>
            <div className="flex min-h-12 items-center justify-between border-b border-[var(--app-line)] px-4">
              <div className="flex items-center gap-2">
                <strong className="text-sm text-[var(--app-text)]">
                  {organization.mode === "members" ? "成员与账号" : "部门架构"}
                </strong>
                <span className="text-xs text-[var(--app-primary)]">
                  {organization.mode === "members" ? users.length : departments.length}
                </span>
              </div>
            </div>
            {organization.mode === "members" ? (
              <>
                <MemberToolbar
                  departments={departments}
                  filters={filters}
                  resultCount={filteredUsers.length}
                  totalCount={users.length}
                  onChange={setFilters}
                />
                <MemberTable
                  currentUser={session.user}
                  users={filteredUsers}
                  onToggleStatus={(user) => organization.setStatus.mutate({
                    userId: user.id,
                    status: user.status === "active" ? "disabled" : "active",
                  })}
                />
              </>
            ) : (
              <DepartmentGrid
                departments={departments}
                users={users}
                onEdit={organization.openEditDepartment}
                onAddChild={organization.openChildDepartment}
              />
            )}
          </Card>
        </div>
      </main>
      <OrganizationModal
        modal={organization.modal}
        departments={departments}
        currentUser={session.user}
        error={organization.error}
        pending={organization.pending}
        onClose={organization.closeModal}
        onSubmit={organization.submit}
      />
    </div>
  );
}
