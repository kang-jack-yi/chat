import { Button, Dropdown, Empty, Table, Tag } from "antd";
import type { TableProps } from "antd";
import type { User } from "@chat/shared";
import Avatar from "../../../components/Avatar";
import { roleText } from "../../../utils/format";

export interface MemberTableProps {
  currentUser: User;
  users: User[];
  loading?: boolean;
  onToggleStatus: (user: User) => void;
}

/** 展示成员身份、角色与账号状态，并保持现有账号操作权限。 */
export default function MemberTable({
  currentUser,
  users,
  loading = false,
  onToggleStatus,
}: MemberTableProps) {
  const columns: TableProps<User>["columns"] = [
    {
      title: "成员",
      key: "member",
      width: 190,
      render: (_, user) => (
        <div className="flex items-center gap-3">
          <Avatar
            text={user.avatar}
            src={user.avatarUrl}
            online={user.online}
          />
          <span className="grid min-w-0 gap-0.5">
            <strong className="truncate text-sm text-[var(--app-text)]">
              {user.name}
            </strong>
            <small className="text-xs text-[var(--app-text-tertiary)]">
              {user.phone}
            </small>
          </span>
        </div>
      ),
    },
    {
      title: "部门 / 职位",
      key: "department",
      width: 180,
      render: (_, user) => (
        <span className="text-sm text-[var(--app-text)]">
          {user.departmentName || "未分配"}
          <small className="mt-1 block text-xs text-[var(--app-text-tertiary)]">
            {user.title || "未设置职位"}
          </small>
        </span>
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 105,
      render: (role: User["role"]) => (
        <Tag
          bordered={false}
          color={
            role === "owner" ? "gold" : role === "admin" ? "blue" : "default"
          }
        >
          {roleText(role)}
        </Tag>
      ),
    },
    {
      title: "账号状态",
      dataIndex: "status",
      width: 105,
      render: (status: User["status"]) => (
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium ${status === "active" ? "text-[var(--app-success)]" : "text-[var(--app-text-tertiary)]"}`}
        >
          <i
            className={`size-1.5 rounded-full ${status === "active" ? "bg-[var(--app-success)]" : "bg-[var(--app-text-tertiary)]"}`}
          />
          {status === "active" ? "正常" : "已停用"}
        </span>
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 76,
      align: "right",
      render: (_, user) =>
        user.role !== "owner" && user.id !== currentUser.id ? (
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "status",
                  danger: user.status === "active",
                  label: user.status === "active" ? "停用账号" : "重新启用",
                  onClick: () => onToggleStatus(user),
                },
              ],
            }}
          >
            <Button type="text" size="small">
              更多
            </Button>
          </Dropdown>
        ) : (
          <span className="text-xs text-[var(--app-text-tertiary)]">—</span>
        ),
    },
  ];

  return (
    <Table
      rowKey="id"
      tableLayout="fixed"
      columns={columns}
      dataSource={users}
      loading={loading}
      pagination={false}
      locale={{
        emptyText: (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="没有符合条件的成员"
          />
        ),
      }}
      scroll={{ x: 680 }}
      rowClassName="group"
      className="[&_.ant-table]:!bg-transparent [&_.ant-table-thead>tr>th]:!border-b-[var(--app-line)] [&_.ant-table-thead>tr>th]:!bg-[var(--app-surface-soft)] [&_.ant-table-thead>tr>th]:!py-2.5 [&_.ant-table-tbody>tr>td]:!border-b-[var(--app-line)] [&_.ant-table-tbody>tr>td]:!py-3 [&_.ant-table-tbody>tr:hover>td]:!bg-[var(--app-primary-soft)]"
    />
  );
}
