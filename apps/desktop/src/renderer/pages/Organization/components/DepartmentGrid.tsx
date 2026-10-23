import { useEffect, useMemo, useState } from "react";
import { Button, Empty, Tag, Tree } from "antd";
import type { TreeDataNode } from "antd";
import { Building2, Pencil, Plus, Users } from "lucide-react";
import type { Department, User } from "@chat/shared";
import Avatar from "../../../components/Avatar";

export interface DepartmentGridProps {
  departments: Department[];
  users: User[];
  onEdit: (department: Department) => void;
  onAddChild: (department: Department) => void;
}

/** 展示部门树与所选部门资料，保留编辑、添加下级和成员分区。 */
export default function DepartmentGrid({
  departments,
  users,
  onEdit,
  onAddChild,
}: DepartmentGridProps) {
  const [selectedId, setSelectedId] = useState<number>();
  const departmentIds = useMemo(
    () => new Set(departments.map((department) => department.id)),
    [departments],
  );

  useEffect(() => {
    if (selectedId && departmentIds.has(selectedId)) return;
    setSelectedId(
      departments.find((department) => department.parentId === null)?.id ??
        departments[0]?.id,
    );
  }, [departmentIds, departments, selectedId]);

  /** 按上级部门递归构建可选择的组织树节点。 */
  function buildNodes(parentId: number | null): TreeDataNode[] {
    return departments
      .filter((department) => department.parentId === parentId)
      .map((department) => ({
        key: department.id,
        title: (
          <div className="flex min-h-10 min-w-0 items-center gap-2.5 pr-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--app-primary-soft)] text-[var(--app-primary)]">
              <Building2 size={14} />
            </span>
            <strong className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--app-text)]">
              {department.name}
            </strong>
            <span className="shrink-0 text-xs text-[var(--app-text-tertiary)]">
              {department.memberCount || 0}
            </span>
          </div>
        ),
        children: buildNodes(department.id),
      }));
  }

  const rootNodes = buildNodes(null);
  const orphanNodes = departments
    .filter(
      (department) =>
        department.parentId !== null && !departmentIds.has(department.parentId),
    )
    .map((department) => ({
      key: department.id,
      title: department.name,
      children: buildNodes(department.id),
    }));
  const treeData = [...rootNodes, ...orphanNodes];
  const selected = departments.find(
    (department) => department.id === selectedId,
  );
  const parent = selected?.parentId
    ? departments.find((department) => department.id === selected.parentId)
    : undefined;
  const children = selected
    ? departments.filter((department) => department.parentId === selected.id)
    : [];
  const directMembers = selected
    ? users.filter((user) => user.departmentId === selected.id)
    : [];

  if (!departments.length) {
    return (
      <div className="grid min-h-96 place-items-center">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无部门" />
      </div>
    );
  }

  return (
    <div className="organization-departments">
      <section className="organization-department-tree">
        <div className="mb-3 flex items-center justify-between px-1">
          <strong className="text-sm text-[var(--app-text)]">部门列表</strong>
          <span className="text-xs text-[var(--app-text-tertiary)]">
            {departments.length} 个部门
          </span>
        </div>
        <Tree
          blockNode
          defaultExpandAll
          selectedKeys={selectedId ? [selectedId] : []}
          showLine={{ showLeafIcon: false }}
          treeData={treeData}
          onSelect={(keys) => setSelectedId(Number(keys[0]) || selectedId)}
          className="bg-transparent [&_.ant-tree-node-content-wrapper]:!min-h-10 [&_.ant-tree-node-content-wrapper]:!py-0 [&_.ant-tree-node-selected]:!bg-[var(--app-primary-soft)] [&_.ant-tree-title]:!block [&_.ant-tree-title]:!w-full"
        />
      </section>

      <section className="organization-department-detail">
        {selected && (
          <>
            <div className="organization-department-heading">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--app-primary-soft)] text-[var(--app-primary)]">
                  <Building2 size={21} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="m-0 truncate text-lg font-semibold text-[var(--app-text)]">
                      {selected.name}
                    </h2>
                    <Tag
                      bordered={false}
                      color={selected.parentId === null ? "blue" : "default"}
                    >
                      {selected.parentId === null ? "根部门" : "子部门"}
                    </Tag>
                  </div>
                  <p className="mt-1 mb-0 text-xs text-[var(--app-text-tertiary)]">
                    {parent ? `上级部门：${parent.name}` : "企业组织的顶级部门"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  icon={<Pencil size={14} />}
                  onClick={() => onEdit(selected)}
                >
                  编辑
                </Button>
                <Button
                  type="primary"
                  icon={<Plus size={14} />}
                  onClick={() => onAddChild(selected)}
                >
                  添加子部门
                </Button>
              </div>
            </div>

            <div className="my-4 grid grid-cols-3 overflow-hidden rounded-xl border border-[var(--app-line)] bg-[var(--app-surface)]">
              <div className="px-4 py-3">
                <span className="block text-xs text-[var(--app-text-tertiary)]">
                  直属成员
                </span>
                <strong className="mt-1 block text-lg text-[var(--app-text)]">
                  {directMembers.length}
                </strong>
              </div>
              <div className="border-l border-[var(--app-line)] px-4 py-3">
                <span className="block text-xs text-[var(--app-text-tertiary)]">
                  下级部门
                </span>
                <strong className="mt-1 block text-lg text-[var(--app-text)]">
                  {children.length}
                </strong>
              </div>
              <div className="border-l border-[var(--app-line)] px-4 py-3">
                <span className="block text-xs text-[var(--app-text-tertiary)]">
                  上级部门
                </span>
                <strong className="mt-1 block truncate text-sm leading-7 text-[var(--app-text)]">
                  {parent?.name || "无"}
                </strong>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-xl border border-[var(--app-line)] bg-[var(--app-surface)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <strong className="flex items-center gap-2 text-sm text-[var(--app-text)]">
                    <Users size={15} className="text-[var(--app-primary)]" />
                    直属成员
                  </strong>
                  <span className="text-xs text-[var(--app-text-tertiary)]">
                    {directMembers.length} 人
                  </span>
                </div>
                {directMembers.length ? (
                  <div className="grid grid-cols-2 gap-2 max-lg:grid-cols-1">
                    {directMembers.map((user) => (
                      <div
                        key={user.id}
                        className="flex min-w-0 items-center gap-2.5 rounded-lg bg-[var(--app-surface-soft)] px-3 py-2"
                      >
                        <Avatar
                          text={user.avatar}
                          src={user.avatarUrl}
                          online={user.online}
                        />
                        <span className="min-w-0">
                          <strong className="block truncate text-xs font-medium text-[var(--app-text)]">
                            {user.name}
                          </strong>
                          <small className="block truncate text-xs text-[var(--app-text-tertiary)]">
                            {user.title || "未设置职位"}
                          </small>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="m-0 py-3 text-center text-xs text-[var(--app-text-tertiary)]">
                    该部门暂无直属成员
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-[var(--app-line)] bg-[var(--app-surface)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <strong className="text-sm text-[var(--app-text)]">
                    下级部门
                  </strong>
                  <span className="text-xs text-[var(--app-text-tertiary)]">
                    {children.length} 个
                  </span>
                </div>
                {children.length ? (
                  <div className="flex flex-wrap gap-2">
                    {children.map((department) => (
                      <button
                        key={department.id}
                        type="button"
                        onClick={() => setSelectedId(department.id)}
                        className="flex items-center gap-2 rounded-lg border border-[var(--app-line)] bg-[var(--app-surface)] px-3 py-2 text-xs text-[var(--app-text-secondary)] hover:border-[var(--app-primary)] hover:bg-[var(--app-primary-soft)] hover:text-[var(--app-primary)]"
                      >
                        <Building2 size={14} />
                        {department.name}
                        <span className="text-[var(--app-text-tertiary)]">
                          {department.memberCount || 0} 人
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="m-0 py-2 text-xs text-[var(--app-text-tertiary)]">
                    暂无下级部门，可点击右上角添加。
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
