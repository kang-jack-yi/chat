import { useId, useMemo, useState } from "react";
import { Avatar, Button, Input } from "antd";
import { Megaphone, Search, UserPlus, X } from "lucide-react";
import type { Conversation, User } from "@chat/shared";
import MemberProfilePopover from "./MemberProfilePopover";

export interface ChatSidePanelProps {
  conversation: Conversation;
  currentUser: User;
  companyName: string;
  users: User[];
  onInvite: () => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onStartDirectChat: (userId: number) => Promise<void>;
  onViewMember: (userId: number) => void;
}

/** 为宽屏侧栏和窄屏抽屉提供同一份可搜索成员列表及现有资料操作。 */
export default function ChatSidePanel({
  conversation,
  currentUser,
  companyName,
  users,
  onInvite,
  onClose,
  onOpenSettings,
  onStartDirectChat,
  onViewMember,
}: ChatSidePanelProps) {
  const searchId = useId();
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
    <aside className="chat-members-panel" aria-label="群成员列表">
      <header className="chat-members-heading">
        <h2>
          群成员 <span>{conversation.memberCount} 人</span>
        </h2>
        <Button
          type="text"
          icon={<X size={18} />}
          aria-label="关闭群成员"
          title="关闭群成员"
          onClick={onClose}
          className="chat-members-close"
        />
      </header>
      <div className="chat-members-tools">
        <Button
          icon={<UserPlus size={16} />}
          aria-label="邀请群成员"
          onClick={onInvite}
          block
        >
          邀请成员
        </Button>
        {announcementSummary && (
          <button
            type="button"
            className="chat-members-announcement"
            aria-label="查看群公告"
            onClick={onOpenSettings}
          >
            <Megaphone size={16} aria-hidden="true" />
            <span>
              <strong>群公告</strong>
              <small>{announcementSummary}</small>
            </span>
          </button>
        )}
        <label htmlFor={searchId}>搜索成员</label>
        <Input
          id={searchId}
          aria-label="搜索群成员"
          value={keyword}
          allowClear
          prefix={<Search size={15} aria-hidden="true" />}
          placeholder="搜索姓名或职位"
          onChange={(event) => setKeyword(event.target.value)}
        />
        {keyword.trim() && (
          <small role="status">找到 {members.length} 位成员</small>
        )}
      </div>
      <div className="chat-members-list">
        {members.map((member) => (
          <MemberProfilePopover
            key={member.id}
            user={member}
            currentUser={currentUser}
            companyName={companyName}
            placement="leftTop"
            onSendMessage={onStartDirectChat}
            onViewProfile={onViewMember}
          >
            <button
              type="button"
              className="chat-members-row"
              aria-label={`查看${member.name}的成员资料`}
            >
              <Avatar shape="square" size={32} src={member.avatarUrl}>
                {member.avatar || member.name.slice(0, 1)}
              </Avatar>
              <span className="chat-members-identity">
                <strong title={member.name}>{member.name}</strong>
                <small title={member.title || member.departmentName}>
                  {member.title || member.departmentName || "企业成员"}
                </small>
              </span>
              {member.id === conversation.createdBy && (
                <span className="chat-members-owner">群主</span>
              )}
              <span
                role="img"
                aria-label={member.online ? "在线" : "离线"}
                className={`chat-members-presence ${member.online ? "chat-members-online" : ""}`}
              />
            </button>
          </MemberProfilePopover>
        ))}
        {!members.length && (
          <div className="chat-members-empty" role="status">
            <p>{keyword.trim() ? "没有匹配的成员" : "暂无群成员"}</p>
            {keyword.trim() && (
              <Button
                type="link"
                aria-label="清除成员搜索"
                onClick={() => setKeyword("")}
              >
                清除搜索
              </Button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
