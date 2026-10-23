import { Tag } from "antd";
import { ChevronRight, ContactRound, UsersRound } from "lucide-react";
import type { Company, User } from "@chat/shared";
import Avatar from "../../../components/Avatar";
import EmptyState from "../../../components/EmptyState";
import SearchBox from "../../../components/SearchBox";

export interface ContactsListProps {
  company: Company;
  users: User[];
  query: string;
  selectedId?: number;
  onQueryChange: (value: string) => void;
  onSelect: (id: number) => void;
}

/** 展示可搜索的企业成员目录与清晰的当前选中状态。 */
export default function ContactsList({
  company,
  users,
  query,
  selectedId,
  onQueryChange,
  onSelect,
}: ContactsListProps) {
  return (
    <>
      <header className="contacts-directory-heading">
        <div>
          <span className="workspace-eyebrow">团队连接</span>
          <h1>通讯录</h1>
        </div>
        <Tag bordered={false} color="blue">
          {users.length} 人
        </Tag>
      </header>
      <SearchBox
        value={query}
        onChange={onQueryChange}
        placeholder="搜索姓名、职位或手机号"
      />
      <div className="flex items-center justify-between px-5 pt-1 pb-2 text-xs text-[var(--app-text-secondary)]">
        <span className="flex min-w-0 items-center gap-1.5">
          <UsersRound size={14} />
          <span className="truncate">{company.name}</span>
        </span>
        <span>{users.length} 位成员</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        {!users.length && (
          <EmptyState compact icon={<ContactRound />} title="暂无匹配成员" />
        )}
        <div className="grid gap-1">
          {users.map((user) => {
            const active = selectedId === user.id;
            return (
              <button
                key={user.id}
                type="button"
                aria-pressed={active}
                className="contacts-member"
                onClick={() => onSelect(user.id)}
              >
                <Avatar
                  text={user.avatar}
                  src={user.avatarUrl}
                  online={user.online}
                />
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="flex items-center gap-2">
                    <strong className="truncate text-sm text-[var(--app-text)]">
                      {user.name}
                    </strong>
                    {user.online && (
                      <span className="contacts-online" aria-label="在线" />
                    )}
                  </span>
                  <small className="truncate text-xs text-[var(--app-text-secondary)]">
                    {user.departmentName || "未分配部门"} ·{" "}
                    {user.title || "成员"}
                  </small>
                </span>
                <ChevronRight size={16} className="contacts-member-chevron" />
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
