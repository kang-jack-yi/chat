import { Button, Input, Select } from "antd";
import { Search } from "lucide-react";
import type { Department, User } from "@chat/shared";
import type { MemberFilterValue } from "../member-filter";

export interface MemberToolbarProps {
  departments: Department[];
  filters: MemberFilterValue;
  resultCount: number;
  totalCount: number;
  onChange: (filters: MemberFilterValue) => void;
}

export default function MemberToolbar({
  departments,
  filters,
  resultCount,
  totalCount,
  onChange,
}: MemberToolbarProps) {
  const filtered = Boolean(
    filters.keyword
    || filters.departmentId !== undefined
    || filters.role
    || filters.status,
  );

  return (
    <div className="border-b border-[var(--app-line)] bg-[var(--app-surface)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          allowClear
          prefix={<Search size={15} className="text-[var(--app-text-tertiary)]" />}
          placeholder="搜索姓名、手机号或职位"
          value={filters.keyword}
          onChange={(event) => onChange({ ...filters, keyword: event.target.value })}
          className="!w-56"
        />
        <Select
          allowClear
          placeholder="全部部门"
          value={filters.departmentId}
          options={departments.map((department) => ({ label: department.name, value: department.id }))}
          onChange={(departmentId) => onChange({ ...filters, departmentId })}
          className="!w-30"
        />
        <Select
          allowClear
          placeholder="全部角色"
          value={filters.role}
          options={[
            { label: "企业所有者", value: "owner" },
            { label: "管理员", value: "admin" },
            { label: "成员", value: "member" },
          ]}
          onChange={(role: User["role"] | undefined) => onChange({ ...filters, role })}
          className="!w-28"
        />
        <Select
          allowClear
          placeholder="全部状态"
          value={filters.status}
          options={[
            { label: "正常", value: "active" },
            { label: "已停用", value: "disabled" },
          ]}
          onChange={(status: User["status"] | undefined) => onChange({ ...filters, status })}
          className="!w-26"
        />
        {filtered && <Button type="link" onClick={() => onChange({ keyword: "" })}>清除筛选</Button>}
        <span className="ml-auto shrink-0 text-xs text-[var(--app-text-tertiary)]">
          {filtered ? `找到 ${resultCount} 位成员` : `共 ${totalCount} 位成员`}
        </span>
      </div>
    </div>
  );
}
