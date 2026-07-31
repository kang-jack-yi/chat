import { Button, Empty, Tag, Tree } from "antd";
import type { TreeDataNode } from "antd";
import { Building2, Pencil, Plus, Users } from "lucide-react";
import type { Department } from "@chat/shared";

export interface DepartmentGridProps {
  departments: Department[];
  onEdit: (department: Department) => void;
  onAddChild: (department: Department) => void;
}

export default function DepartmentGrid({ departments, onEdit, onAddChild }: DepartmentGridProps) {
  const departmentIds = new Set(departments.map((department) => department.id));

  function buildNodes(parentId: number | null): TreeDataNode[] {
    return departments
      .filter((department) => department.parentId === parentId)
      .map((department) => ({
        key: department.id,
        title: (
          <div className="group flex min-h-12 min-w-0 flex-1 items-center gap-3 pr-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--app-primary-soft)] text-[var(--app-primary)]">
              <Building2 size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-sm font-medium text-[var(--app-text)]">{department.name}</strong>
              <span className="mt-0.5 flex items-center gap-1 text-xs text-[var(--app-text-tertiary)]">
                <Users size={12} />{department.memberCount || 0} 位成员
              </span>
            </span>
            <Tag bordered={false}>{department.parentId === null ? "根部门" : "子部门"}</Tag>
            <span className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <Button
                type="text"
                size="small"
                icon={<Pencil size={14} />}
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(department);
                }}
              >
                编辑
              </Button>
              <Button
                type="text"
                size="small"
                icon={<Plus size={14} />}
                onClick={(event) => {
                  event.stopPropagation();
                  onAddChild(department);
                }}
              >
                添加子部门
              </Button>
            </span>
          </div>
        ),
        children: buildNodes(department.id),
      }));
  }

  const rootNodes = buildNodes(null);
  const orphanNodes = departments
    .filter((department) => department.parentId !== null && !departmentIds.has(department.parentId))
    .map((department) => ({
      key: department.id,
      title: department.name,
      children: buildNodes(department.id),
    }));
  const treeData = [...rootNodes, ...orphanNodes];

  return (
    <div className="min-h-[420px] p-5">
      {treeData.length ? (
        <Tree
          key={departments.map((department) => department.id).join("-")}
          blockNode
          defaultExpandAll
          showLine={{ showLeafIcon: false }}
          treeData={treeData}
          className="rounded-[14px] border border-[var(--app-line)] bg-white px-3 py-2 [&_.ant-tree-node-content-wrapper]:!min-h-12 [&_.ant-tree-node-content-wrapper]:!py-0 [&_.ant-tree-title]:!block [&_.ant-tree-title]:!w-full"
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无部门" />
      )}
    </div>
  );
}
