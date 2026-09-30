import { useMemo, useState } from "react";
import { Avatar, Button, Input, Tooltip } from "antd";
import {
  Crown,
  History,
  Megaphone,
  Search,
  Settings,
  UserPlus,
} from "lucide-react";
import type { Conversation, User } from "@chat/shared";
import MemberProfilePopover from "./MemberProfilePopover";

export interface GroupMembersPanelProps {
  conversation: Conversation;
  currentUser: User;
  companyName: string;
  users: User[];
  onOpenHistory: () => void;
  onInvite: () => void;
  onOpenSettings: () => void;
  onStartDirectChat: (userId: number) => Promise<void>;
  onViewMember: (userId: number) => void;
}

export default function GroupMembersPanel({
  conversation,
  currentUser,
  companyName,
  users,
  onOpenHistory,
  onInvite,
  onOpenSettings,
  onStartDirectChat,
  onViewMember,
}: GroupMembersPanelProps) {
  const [keyword, setKeyword] = useState("");
  const announcementSummary = (
    conversation.announcement ||
    conversation.announcementMessage?.summary ||
    ""
  )
    .replace(/^\[群公告\]\s*/, "")
    .trim();
  const members = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase();
    const directoryUsers = new Map(users.map((user) => [user.id, user]));
    return [...(conversation.members ?? [])]
      .map((member) => ({
        ...member,
        ...directoryUsers.get(member.id),
        online: member.online,
      }))
      .filter(
        (member) =>
          !normalized ||
          member.name.toLocaleLowerCase().includes(normalized) ||
          member.title.toLocaleLowerCase().includes(normalized),
      )
      .sort((left, right) => {
        if (left.id === conversation.createdBy) return -1;
        if (right.id === conversation.createdBy) return 1;
        if (Boolean(left.online) !== Boolean(right.online))
          return left.online ? -1 : 1;
        return left.name.localeCompare(right.name, "zh-CN");
      });
  }, [conversation.createdBy, conversation.members, keyword, users]);

  return (
    <aside className="grid h-full w-full min-h-0 min-w-0 max-w-full grid-rows-[48px_auto_minmax(0,1fr)] overflow-hidden bg-[var(--chat-list)]">
      <header className="grid w-full min-w-0 max-w-full grid-cols-[repeat(3,32px)] items-center justify-end overflow-hidden border-b border-l border-[var(--chat-line)] bg-[var(--chat-header)] px-2">
        <Button
          type="text"
          size="small"
          icon={<History size={17} />}
          title="聊天记录"
          aria-label="打开聊天记录"
          onClick={onOpenHistory}
          className="!h-8 !w-8 !min-w-8 !rounded-md !p-0 !text-[var(--chat-text-secondary)] hover:!bg-[var(--chat-rail-hover)] hover:!text-[var(--chat-primary)]"
        />
        <Button
          type="text"
          size="small"
          icon={<UserPlus size={17} />}
          title="邀请群成员"
          onClick={onInvite}
          className="!h-8 !w-8 !min-w-8 !rounded-md !p-0 !text-[var(--chat-text-secondary)] hover:!bg-[var(--chat-rail-hover)] hover:!text-[var(--chat-primary)]"
        />
        <Button
          type="text"
          size="small"
          icon={<Settings size={17} />}
          title="聊天设置"
          aria-label="打开聊天设置"
          onClick={onOpenSettings}
          className="!h-8 !w-8 !min-w-8 !rounded-md !p-0 !text-[var(--chat-text-secondary)] hover:!bg-[var(--chat-rail-hover)] hover:!text-[var(--chat-primary)]"
        />
      </header>
      <div className="w-full min-w-0 max-w-full overflow-hidden border-l border-[var(--chat-line)]">
        <div className="w-full min-w-0 max-w-full overflow-hidden px-2 py-2">
          <Input
            allowClear
            size="small"
            value={keyword}
            prefix={<Search size={13} />}
            placeholder="搜索成员"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        {announcementSummary && (
          <button
            type="button"
            className="flex min-h-40 w-full min-w-0 max-w-full gap-2 overflow-hidden border-y border-[var(--chat-line)] bg-[var(--chat-list)] px-2.5 py-3 text-left transition-colors hover:bg-[var(--app-surface-muted)]"
            onClick={onOpenSettings}
          >
            <Megaphone
              size={14}
              className="mt-0.5 shrink-0 text-[var(--chat-primary)]"
            />
            <span className="min-w-0 flex-1 overflow-hidden">
              <strong className="block text-xs leading-4 font-medium text-[var(--chat-text)]">
                群公告
              </strong>
              <span className="mt-1 line-clamp-7 block break-words text-xs leading-4 text-[var(--chat-text-tertiary)] [overflow-wrap:anywhere]">
                {announcementSummary}
              </span>
            </span>
          </button>
        )}
      </div>
      <div className="min-h-0 min-w-0 max-w-full overflow-x-hidden overflow-y-auto border-l border-[var(--chat-line)] px-1.5 pb-2">
        {members.map((member) => (
          <Tooltip
            key={member.id}
            placement="left"
            title={member.title || member.departmentName || "暂无职位"}
          >
            <div className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-[var(--app-surface-muted)]">
              <MemberProfilePopover
                user={member}
                currentUser={currentUser}
                companyName={companyName}
                placement="leftTop"
                onSendMessage={onStartDirectChat}
                onViewProfile={onViewMember}
              >
                <span className="relative shrink-0">
                  <Avatar
                    shape="square"
                    size={28}
                    className="!rounded-lg !bg-[var(--chat-primary)] !text-xs"
                  >
                    {member.avatar || member.name.slice(0, 1)}
                  </Avatar>
                  <i
                    className={`absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full border border-white ${
                      member.online ? "bg-[#22b07d]" : "bg-[#b8bec8]"
                    }`}
                  />
                </span>
              </MemberProfilePopover>
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--chat-text)]">
                {member.name}
              </span>
              {member.id === conversation.createdBy && (
                <Crown size={12} className="shrink-0 text-amber-500" />
              )}
            </div>
          </Tooltip>
        ))}
        {!members.length && (
          <div className="px-2 py-8 text-center text-xs text-[var(--chat-text-tertiary)]">
            没有匹配的成员
          </div>
        )}
      </div>
    </aside>
  );
}
