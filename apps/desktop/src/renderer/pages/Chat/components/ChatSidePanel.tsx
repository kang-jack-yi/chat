import type { Conversation, User } from "@chat/shared";
import GroupMembersPanel from "./GroupMembersPanel";

export interface ChatSidePanelProps {
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

export default function ChatSidePanel({
  conversation,
  currentUser,
  companyName,
  users,
  onOpenHistory,
  onInvite,
  onOpenSettings,
  onStartDirectChat,
  onViewMember,
}: ChatSidePanelProps) {
  return (
    <GroupMembersPanel
      conversation={conversation}
      currentUser={currentUser}
      companyName={companyName}
      users={users}
      onOpenHistory={onOpenHistory}
      onInvite={onInvite}
      onOpenSettings={onOpenSettings}
      onStartDirectChat={onStartDirectChat}
      onViewMember={onViewMember}
    />
  );
}
