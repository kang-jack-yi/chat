import { Tag } from "antd";
import { ChevronRight, ContactRound, UsersRound } from "lucide-react";
import type { Company, User } from "@chat/shared";
import Avatar from "../../../components/Avatar";
import EmptyState from "../../../components/EmptyState";
import PanelTitle from "../../../components/PanelTitle";
import SearchBox from "../../../components/SearchBox";

export interface ContactsListProps {
  company: Company;
  users: User[];
  query: string;
  selectedId?: number;
  onQueryChange: (value: string) => void;
  onSelect: (id: number) => void;
}

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
      <PanelTitle
        title="通讯录"
        action={<Tag bordered={false} color="blue">{users.length} 人</Tag>}
      />
      <SearchBox value={query} onChange={onQueryChange} placeholder="搜索姓名、职位或手机号" />
      <div className="flex items-center justify-between px-5 pt-1 pb-2 text-xs text-[var(--app-text-secondary)]">
        <span className="flex min-w-0 items-center gap-1.5"><UsersRound size={14} /><span className="truncate">{company.name}</span></span>
        <span>{users.length} 位成员</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        {!users.length && <EmptyState compact icon={<ContactRound />} title="暂无匹配成员" />}
        <div className="grid gap-1">
          {users.map((user) => {
            const active = selectedId === user.id;
            return (
              <button
                key={user.id}
                className={`group flex w-full items-center gap-3 rounded-[14px] border px-3 py-3 text-left transition-all duration-200 ${
                  active
                    ? "border-[#cfe2fa] bg-[var(--app-primary-soft)] shadow-[0_7px_20px_rgba(22,119,255,.07)]"
                    : "border-transparent bg-transparent hover:bg-white/75 hover:shadow-[0_4px_14px_rgba(53,63,94,.04)]"
                }`}
                onClick={() => onSelect(user.id)}
              >
                <Avatar text={user.avatar} online={user.online} />
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="flex items-center gap-2">
                    <strong className="truncate text-sm text-[var(--app-text)]">{user.name}</strong>
                    {user.online && <i className="size-1.5 rounded-full bg-[#1ca777]" />}
                  </span>
                  <small className="truncate text-xs text-[var(--app-text-secondary)]">
                    {user.departmentName || "未分配部门"} · {user.title || "成员"}
                  </small>
                </span>
                <ChevronRight size={16} className={`shrink-0 transition-transform ${active ? "translate-x-0 text-[var(--app-primary)]" : "-translate-x-1 text-[#c0c5ce] opacity-0 group-hover:translate-x-0 group-hover:opacity-100"}`} />
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
