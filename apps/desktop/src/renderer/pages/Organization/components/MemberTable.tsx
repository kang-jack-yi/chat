import { Button, Table, Tag } from "antd";
import type { TableProps } from "antd";
import { MoreHorizontal } from "lucide-react";
import type { User } from "@chat/shared";
import Avatar from "../../../components/Avatar";
import { roleText } from "../../../utils/format";

export interface MemberTableProps {
  currentUser: User;
  users: User[];
  onToggleStatus: (user: User) => void;
}

export default function MemberTable({ currentUser, users, onToggleStatus }: MemberTableProps) {
  const columns: TableProps<User>["columns"] = [
    {
      title: "成员",
      key: "member",
      width: 230,
      render: (_, user) => (
        <div className="flex items-center gap-3">
          <Avatar text={user.avatar} online={user.online} />
          <span className="grid min-w-0 gap-0.5">
            <strong className="truncate text-sm text-[#252a34]">{user.name}</strong>
            <small className="text-xs text-[#979eaa]">{user.phone}</small>
          </span>
        </div>
      ),
    },
    {
      title: "部门 / 职位",
      key: "department",
      width: 220,
      render: (_, user) => (
        <span className="text-sm text-[#3f4650]">
          {user.departmentName || "未分配"}
          <small className="mt-1 block text-xs text-[#979eaa]">{user.title || "未设置职位"}</small>
        </span>
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 130,
      render: (role: User["role"]) => (
        <Tag bordered={false} color={role === "owner" ? "gold" : role === "admin" ? "blue" : "default"}>
          {roleText(role)}
        </Tag>
      ),
    },
    {
      title: "账号状态",
      dataIndex: "status",
      width: 130,
      render: (status: User["status"]) => (
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${status === "active" ? "text-[#178761]" : "text-[#8f959e]"}`}>
          <i className={`size-1.5 rounded-full ${status === "active" ? "bg-[#1ca777]" : "bg-[#a8afb9]"}`} />
          {status === "active" ? "正常" : "已停用"}
        </span>
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 120,
      align: "right",
      render: (_, user) => user.role !== "owner" && user.id !== currentUser.id
        ? (
          <Button danger={user.status === "active"} type="text" size="small" onClick={() => onToggleStatus(user)}>
            {user.status === "active" ? "停用账号" : "重新启用"}
          </Button>
        )
        : <Button type="text" size="small" disabled icon={<MoreHorizontal size={16} />} />,
    },
  ];

  return (
    <Table
      rowKey="id"
      columns={columns}
      dataSource={users}
      pagination={false}
      scroll={{ x: 860 }}
      rowClassName="group"
      className="[&_.ant-table]:!bg-transparent [&_.ant-table-thead>tr>th]:!border-b-[var(--app-line)] [&_.ant-table-thead>tr>th]:!bg-[var(--app-surface-soft)] [&_.ant-table-thead>tr>th]:!py-3 [&_.ant-table-tbody>tr>td]:!border-b-[var(--app-line)] [&_.ant-table-tbody>tr>td]:!py-4 [&_.ant-table-tbody>tr:hover>td]:!bg-[var(--app-primary-soft)]"
    />
  );
}
