import { Button, Card, Statistic } from "antd";
import { Building2, CircleOff, Plus, UsersRound } from "lucide-react";
import { useUserStore } from "../../stores/user-store";
import AdminMenu from "./components/AdminMenu";
import DepartmentGrid from "./components/DepartmentGrid";
import MemberTable from "./components/MemberTable";
import OrganizationModal from "./components/OrganizationModal";
import { useOrganization } from "./hooks";

export default function OrganizationPage() {
  const session = useUserStore((state) => state.session)!;
  const organization = useOrganization();
  const users = organization.users.data ?? [];
  const departments = organization.departments.data ?? [];
  const activeUsers = users.filter((user) => user.status === "active").length;
  const disabledUsers = users.length - activeUsers;

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
      <main className="h-full overflow-y-auto bg-[radial-gradient(circle_at_85%_2%,#e8f2ff_0%,#f8fafc_28%,#f2f5fa_64%)] px-[clamp(24px,4vw,56px)] py-9 max-md:px-4 max-md:py-7">
        <div className="mx-auto w-full max-w-[1180px]">
          <header className="mb-7 flex items-end justify-between gap-7 max-sm:items-start">
            <div className="flex items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-[16px] bg-white text-[var(--app-primary)] shadow-[0_8px_22px_rgba(57,66,94,.10)] ring-1 ring-black/[.03]">
                <Building2 size={23} />
              </span>
              <div>
                <span className="text-xs font-bold tracking-[2px] text-[var(--app-primary)]">ORGANIZATION</span>
                <h1 className="my-1 text-[28px] font-semibold tracking-[-0.6px] text-[var(--app-text)] max-md:text-[22px]">{session.company.name}</h1>
                <p className="m-0 text-[13px] text-[var(--app-text-secondary)]">统一维护企业成员、部门架构与账号状态</p>
              </div>
            </div>
            <Button type="primary" icon={<Plus size={17} />} onClick={organization.openCreateModal} className="!shadow-[0_9px_22px_rgba(22,119,255,.20)]">
              {organization.mode === "members" ? "添加成员" : "新建部门"}
            </Button>
          </header>

          <div className="mb-5 grid grid-cols-3 gap-4 max-sm:grid-cols-1">
            <Card className="!rounded-[18px] !border-white/80 !bg-white/90">
              <Statistic title="在职成员" value={activeUsers} prefix={<UsersRound size={19} className="mr-2 text-[var(--app-primary)]" />} suffix={<span className="text-xs text-[var(--app-text-tertiary)]">人</span>} />
            </Card>
            <Card className="!rounded-[18px] !border-white/80 !bg-white/90">
              <Statistic title="组织部门" value={departments.length} prefix={<Building2 size={19} className="mr-2 text-[var(--app-primary)]" />} suffix={<span className="text-xs text-[var(--app-text-tertiary)]">个</span>} />
            </Card>
            <Card className="!rounded-[18px] !border-white/80 !bg-white/90">
              <Statistic title="停用账号" value={disabledUsers} prefix={<CircleOff size={19} className="mr-2 text-[#e85d75]" />} suffix={<span className="text-xs text-[var(--app-text-tertiary)]">个</span>} />
            </Card>
          </div>

          <Card className="overflow-hidden !rounded-[20px] !border-white/80 !bg-white/95 shadow-[0_14px_38px_rgba(39,48,67,.07)]" styles={{ body: { padding: 0 } }}>
            <div className="flex min-h-14 items-center justify-between border-b border-[var(--app-line)] px-6 max-sm:px-4">
              <div className="flex items-center gap-2">
                <strong className="text-sm text-[var(--app-text)]">
                  {organization.mode === "members" ? "成员与账号" : "部门架构"}
                </strong>
                <span className="text-xs text-[var(--app-primary)]">
                  {organization.mode === "members" ? users.length : departments.length}
                </span>
              </div>
              <span className="text-xs text-[var(--app-text-tertiary)] max-sm:hidden">数据与当前企业实时同步</span>
            </div>
            {organization.mode === "members" ? (
              <MemberTable
                currentUser={session.user}
                users={users}
                onToggleStatus={(user) => organization.setStatus.mutate({
                  userId: user.id,
                  status: user.status === "active" ? "disabled" : "active",
                })}
              />
            ) : (
              <DepartmentGrid
                departments={departments}
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
