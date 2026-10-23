import { useMemo, useState } from "react";
import { Alert, Button, Card } from "antd";
import {
  Building2,
  CircleOff,
  Plus,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useUserStore } from "../../stores/user-store";
import AdminMenu from "./components/AdminMenu";
import DepartmentGrid from "./components/DepartmentGrid";
import MemberTable from "./components/MemberTable";
import MemberToolbar from "./components/MemberToolbar";
import OrganizationModal from "./components/OrganizationModal";
import { filterMembers, type MemberFilterValue } from "./member-filter";
import { useOrganization } from "./hooks";
import "./page.less";

/** 分区展示企业成员统计、账号管理与部门架构，并保留全部管理操作。 */
export default function OrganizationPage() {
  const session = useUserStore((state) => state.session)!;
  const organization = useOrganization();
  const users = organization.users.data ?? [];
  const departments = organization.departments.data ?? [];
  const activeUsers = users.filter((user) => user.status === "active").length;
  const disabledUsers = users.length - activeUsers;
  const managerUsers = users.filter(
    (user) => user.role === "owner" || user.role === "admin",
  ).length;
  const unassignedUsers = users.filter((user) => !user.departmentId).length;
  const [filters, setFilters] = useState<MemberFilterValue>({ keyword: "" });
  const filteredUsers = useMemo(
    () => filterMembers(users, filters),
    [filters, users],
  );

  return (
    <div className="organization-page">
      <main className="workspace-page organization-main">
        <div className="organization-content">
          <header className="workspace-page-header organization-header">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--app-surface)] text-[var(--app-primary)] shadow-sm ring-1 ring-[var(--app-line)]">
                <Building2 size={20} />
              </span>
              <div className="min-w-0">
                <h1 className="workspace-page-title organization-company-title">
                  {session.company.name}
                </h1>
                <p className="workspace-page-description">
                  企业编号 {session.company.code} · {users.length} 名成员 ·{" "}
                  {departments.length} 个部门 · 账号启用{" "}
                  {users.length
                    ? Math.round((activeUsers / users.length) * 100)
                    : 0}
                  %
                </p>
              </div>
            </div>
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={organization.openCreateModal}
            >
              {organization.mode === "members" ? "添加成员" : "新建部门"}
            </Button>
          </header>

          <AdminMenu
            mode={organization.mode}
            onModeChange={organization.setMode}
          />

          {(organization.users.isError || organization.departments.isError) && (
            <Alert
              type="error"
              title="组织信息加载失败"
              showIcon
              action={
                <Button
                  size="small"
                  onClick={() => {
                    void organization.users.refetch();
                    void organization.departments.refetch();
                  }}
                >
                  重试
                </Button>
              }
            />
          )}

          {organization.mode === "members" && (
            <div className="organization-stats">
              {[
                {
                  label: "在职成员",
                  value: activeUsers,
                  icon: <UsersRound size={18} />,
                  tone: "bg-[var(--app-primary-soft)] text-[var(--app-primary)]",
                },
                {
                  label: "管理角色",
                  value: managerUsers,
                  icon: <ShieldCheck size={18} />,
                  tone: "bg-[var(--app-surface-muted)] text-[var(--app-text-secondary)]",
                },
                {
                  label: "停用账号",
                  value: disabledUsers,
                  icon: <CircleOff size={18} />,
                  tone: "bg-[color-mix(in_srgb,var(--app-danger)_14%,transparent)] text-[var(--app-danger)]",
                },
                {
                  label: "未分配部门",
                  value: unassignedUsers,
                  icon: <Building2 size={18} />,
                  tone: "bg-[var(--app-surface-muted)] text-[var(--app-text-secondary)]",
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="workspace-stat organization-stat"
                >
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-lg ${item.tone}`}
                  >
                    {item.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs text-[var(--app-text-secondary)]">
                      {item.label}
                    </span>
                    <strong className="mt-0.5 block text-xl font-semibold text-[var(--app-text)]">
                      {item.value}
                      <small className="ml-1 text-xs font-normal text-[var(--app-text-tertiary)]">
                        人
                      </small>
                    </strong>
                  </span>
                </div>
              ))}
            </div>
          )}

          <Card
            className="workspace-panel organization-panel"
            styles={{ body: { padding: 0 } }}
          >
            <div className="organization-panel-heading">
              <div className="flex items-center gap-2">
                <strong className="text-sm text-[var(--app-text)]">
                  {organization.mode === "members" ? "成员与账号" : "部门架构"}
                </strong>
                <span className="text-xs text-[var(--app-primary)]">
                  {organization.mode === "members"
                    ? users.length
                    : departments.length}
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
                  loading={organization.users.isLoading}
                  onToggleStatus={(user) =>
                    organization.setStatus.mutate({
                      userId: user.id,
                      status: user.status === "active" ? "disabled" : "active",
                    })
                  }
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
