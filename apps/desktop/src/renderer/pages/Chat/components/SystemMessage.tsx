import type {
  Message,
  SystemActor,
  SystemMessageEvent,
} from "@chat/shared";

function actorName(actor: SystemActor, currentUserId?: number) {
  return actor.userId === currentUserId ? "你" : actor.name;
}

function memberNames(members: SystemActor[], currentUserId?: number) {
  const names = members
    .slice(0, 5)
    .map((member) => actorName(member, currentUserId))
    .join("、");
  return members.length > 5 ? `${names} 等 ${members.length} 人` : names;
}

export function systemMessageText(
  event: SystemMessageEvent,
  currentUserId?: number,
) {
  const actor = actorName(event.actor, currentUserId);
  if (event.type === "group_announcement_updated") {
    return `${actor}更新了群公告`;
  }
  if (event.type === "owner_transferred") {
    return `${actor}将群主转让给${actorName(event.newOwner, currentUserId)}`;
  }
  if (event.type === "group_created") {
    const invited = memberNames(event.invitedMembers, currentUserId);
    return invited
      ? `${actor}创建了群聊，并邀请${invited}加入群聊`
      : `${actor}创建了群聊`;
  }
  if (event.type === "members_invited") {
    return `${actor}邀请${memberNames(event.members, currentUserId)}加入群聊`;
  }
  if (event.type === "member_left") return `${actor}退出了群聊`;
  if (event.type === "member_removed") {
    return `${actor}将${actorName(event.member, currentUserId)}移出了群聊`;
  }
  if (event.type === "group_renamed") {
    return `${actor}将群名修改为“${event.newName}”`;
  }
  return `${actor}撤回了一条消息`;
}

export function messageSystemEvent(message: Message) {
  const part = message.parts.find((item) => item.type === "system_event");
  return part?.type === "system_event" ? part.event : undefined;
}

export interface SystemMessageProps {
  message: Message;
  currentUserId?: number;
  compact?: boolean;
}

export default function SystemMessage({
  message,
  currentUserId,
  compact = false,
}: SystemMessageProps) {
  const event = messageSystemEvent(message);
  const text = event ? systemMessageText(event, currentUserId) : message.summary;
  return (
    <span
      className={
        compact
          ? "block break-words text-[11px] leading-5 text-[var(--chat-text-secondary)]"
          : "inline-block px-1 text-[10px] leading-5 text-[var(--chat-text-tertiary)]"
      }
    >
      {text}
    </span>
  );
}
