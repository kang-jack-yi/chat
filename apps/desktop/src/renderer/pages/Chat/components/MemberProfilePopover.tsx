import { useState, type ReactNode } from "react";
import { Button, Divider, Popover, Tag, Typography } from "antd";
import { BadgeCheck, ContactRound, MessageCircleMore, Monitor } from "lucide-react";
import type { User } from "@chat/shared";
import Avatar from "../../../components/Avatar";
import { roleText } from "../../../utils/format";

export interface MemberProfilePopoverProps {
  user: User | null | undefined;
  currentUser: User;
  companyName: string;
  children: ReactNode;
  placement?: "leftTop" | "rightTop" | "bottomLeft";
  onSendMessage: (userId: number) => Promise<void>;
  onViewProfile: (userId: number) => void;
}

export default function MemberProfilePopover({
  user,
  currentUser,
  companyName,
  children,
  placement = "rightTop",
  onSendMessage,
  onViewProfile,
}: MemberProfilePopoverProps) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  if (!user) return children;
  const userId = user.id;

  async function sendMessage() {
    setSending(true);
    try {
      await onSendMessage(userId);
      setOpen(false);
    } finally {
      setSending(false);
    }
  }

  const isSelf = user.id === currentUser.id;
  const disabled = user.status === "disabled";

  return (
    <Popover
      open={open}
      trigger="click"
      placement={placement}
      arrow={false}
      onOpenChange={setOpen}
      styles={{ content: { padding: 0 } }}
      content={(
        <div className="w-[304px] p-4">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar text={user.avatar || user.name} online={user.online} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <strong className="truncate text-[15px] font-semibold text-[var(--app-text)]">
                  {user.name}
                </strong>
                <Monitor
                  size={14}
                  className={user.online
                    ? "shrink-0 text-[var(--chat-primary)]"
                    : "shrink-0 text-[var(--chat-text-tertiary)]"}
                />
                {disabled && <Tag bordered={false} color="default">已停用</Tag>}
              </div>
              <p className="mt-1 mb-0 truncate text-xs text-[#7d8995]">
                {user.title || "企业成员"}
              </p>
              <p className="mt-1 mb-0 truncate text-xs text-[#7d8995]">
                {user.departmentName || "未分配部门"}
              </p>
            </div>
          </div>

          <Divider className="!my-4" />

          <dl className="m-0 grid grid-cols-[56px_minmax(0,1fr)] gap-y-3 text-xs leading-5">
            <dt className="text-[#8a949f]">部门</dt>
            <dd className="m-0 truncate text-[var(--app-text)]">{user.departmentName || "未分配部门"}</dd>
            <dt className="text-[#8a949f]">企业</dt>
            <dd className="m-0 flex min-w-0 items-center gap-1 text-[var(--app-text)]">
              <span className="truncate">{companyName}</span>
              <BadgeCheck size={14} className="shrink-0 text-[#22a06b]" />
            </dd>
            <dt className="text-[#8a949f]">手机号</dt>
            <dd className="m-0 min-w-0">
              <Typography.Text copyable={{ text: user.phone }} className="!text-xs !text-[var(--app-text)]">
                {user.phone}
              </Typography.Text>
            </dd>
            <dt className="text-[#8a949f]">角色</dt>
            <dd className="m-0 text-[var(--app-text)]">{roleText(user.role)}</dd>
          </dl>

          <div className="mt-4 flex gap-2">
            {!isSelf && (
              <Button
                type="primary"
                block
                icon={<MessageCircleMore size={15} />}
                loading={sending}
                disabled={disabled}
                onClick={() => void sendMessage()}
              >
                发消息
              </Button>
            )}
            <Button
              block
              icon={<ContactRound size={15} />}
              onClick={() => {
                setOpen(false);
                onViewProfile(user.id);
              }}
            >
              查看资料
            </Button>
          </div>
        </div>
      )}
    >
      <span className="inline-flex min-w-0 cursor-pointer">{children}</span>
    </Popover>
  );
}
