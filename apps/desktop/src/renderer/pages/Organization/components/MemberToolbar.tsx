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

/** 提供成员搜索和部门、角色、账号状态筛选，保持筛选条件可清除。 */
export default function MemberToolbar({
  departments,
  filters,
  resultCount,
  totalCount,
  onChange,
}: MemberToolbarProps) {
  const filtered = Boolean(
    filters.keyword ||
    filters.departmentId !== undefined ||
    filters.role ||
    filters.status,
  );

  return (
    <div className="organization-member-toolbar">
      <div className="organization-member-filters">
        <Input
          allowClear
          prefix={
            <Search size={15} className="text-[var(--app-text-tertiary)]" />
          }
          placeholder="搜索姓名、手机号或职位"
          aria-label="搜索成员"
          value={filters.keyword}
          onChange={(event) =>
            onChange({ ...filters, keyword: event.target.value })
          }
          className="organization-member-search"
        />
        <Select
          allowClear
          placeholder="全部部门"
          aria-label="按部门筛选"
          value={filters.departmentId}
          options={departments.map((department) => ({
            label: department.name,
            value: department.id,
          }))}
          onChange={(departmentId) => onChange({ ...filters, departmentId })}
        />
        <Select
          allowClear
          placeholder="全部角色"
          aria-label="按角色筛选"
          value={filters.role}
          options={[
            { label: "企业所有者", value: "owner" },
            { label: "管理员", value: "admin" },
            { label: "成员", value: "member" },
          ]}
          onChange={(role: User["role"] | undefined) =>
            onChange({ ...filters, role })
          }
        />
        <Select
          allowClear
          placeholder="全部状态"
          aria-label="按账号状态筛选"
          value={filters.status}
          options={[
            { label: "正常", value: "active" },
            { label: "已停用", value: "disabled" },
          ]}
          onChange={(status: User["status"] | undefined) =>
            onChange({ ...filters, status })
          }
        />
        {filtered && (
          <Button type="link" onClick={() => onChange({ keyword: "" })}>
            清除筛选
          </Button>
        )}
        <span className="organization-result-count" role="status">
          {filtered ? `找到 ${resultCount} 位成员` : `共 ${totalCount} 位成员`}
        </span>
      </div>
    </div>
  );
}
