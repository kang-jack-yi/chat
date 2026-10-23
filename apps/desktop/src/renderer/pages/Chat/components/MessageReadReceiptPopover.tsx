import { useState } from "react";
import { Avatar, Empty, Popover, Skeleton } from "antd";
import { useQuery } from "@tanstack/react-query";
import type { ConversationType, Message, User } from "@chat/shared";
import { queryKeys } from "../../../constants/query-keys";
import { chatService } from "../../../services/chat";

export interface MessageReadReceiptPopoverProps {
  message: Message;
  conversationType: ConversationType;
}

function ReceiptList({ users }: { users: User[] }) {
  if (!users.length) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="暂无成员"
        className="!my-5"
      />
    );
  }
  return (
    <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
      {users.map((user) => (
        <div
          key={user.id}
          className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-[var(--app-surface-muted)]"
        >
          <Avatar
            size={28}
            shape="square"
            className="!rounded-lg !bg-[var(--app-primary-soft)] !text-[var(--app-primary)]"
          >
            {user.name.slice(0, 1)}
          </Avatar>
          <span className="min-w-0 truncate text-sm text-[var(--app-text)]">
            {user.name}
          </span>
        </div>
      ))}
    </div>
  );
}

export function messageReceiptLabel(
  message: Message,
  conversationType: ConversationType,
) {
  if (conversationType === "direct") return message.readCount ? "已读" : "未读";
  const readCount = Number(message.readCount ?? 0);
  const recipientCount = Number(message.recipientCount ?? 0);
  if (readCount === recipientCount && recipientCount > 0) return "全部已读";
  return readCount > 0 ? `${readCount}/${recipientCount} 已读` : "未读";
}

export function messageReceiptState(
  message: Message,
  conversationType: ConversationType,
) {
  const readCount = Number(message.readCount ?? 0);
  const recipientCount = Number(message.recipientCount ?? 0);
  const allRead =
    conversationType === "direct"
      ? readCount > 0
      : recipientCount > 0 && readCount === recipientCount;
  return allRead ? "all-read" : "pending";
}

export default function MessageReadReceiptPopover({
  message,
  conversationType,
}: MessageReadReceiptPopoverProps) {
  const isDirect = conversationType === "direct";
  const [open, setOpen] = useState(false);
  const receipts = useQuery({
    queryKey: queryKeys.messageReceipts(message.conversationId, message.id),
    queryFn: () =>
      chatService.messageReceipts(message.conversationId, message.id),
    enabled: open,
    staleTime: 0,
  });
  const unread = receipts.data?.unread ?? [];
  const read = receipts.data?.read ?? [];
  const content = (
    <div className="w-96 max-w-[calc(100vw-32px)]">
      <div className="border-b border-[var(--app-line)] px-4 py-3 text-sm font-semibold text-[var(--app-text)]">
        消息接收人列表
      </div>
      {receipts.isLoading ? (
        <div className="px-4 py-4">
          <Skeleton active avatar paragraph={{ rows: 3 }} />
        </div>
      ) : receipts.isError ? (
        <div className="px-4 py-8 text-center text-sm text-red-600">
          接收状态加载失败，请稍后重试
        </div>
      ) : (
        <div className="grid grid-cols-2 divide-x divide-[var(--app-line)]">
          <section className="min-w-0 p-3">
            <div className="mb-2 text-sm text-[var(--app-text)]">
              <strong className="mr-1 text-xl font-medium">
                {unread.length}
              </strong>
              人未读
            </div>
            <ReceiptList users={unread} />
          </section>
          <section className="min-w-0 p-3">
            <div className="mb-2 text-sm text-[var(--app-text)]">
              <strong className="mr-1 text-xl font-medium">
                {read.length}
              </strong>
              人已读
            </div>
            <ReceiptList users={read} />
          </section>
        </div>
      )}
    </div>
  );

  const receipt = (
    <span
      className={`message-read-receipt message-read-receipt--${messageReceiptState(message, conversationType)}`}
      aria-label={
        isDirect
          ? undefined
          : `查看${messageReceiptLabel(message, conversationType)}详情`
      }
    >
      {messageReceiptLabel(message, conversationType)}
    </span>
  );

  if (isDirect) return receipt;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="leftTop"
      arrow={false}
      content={content}
      styles={{ content: { padding: 0, overflow: "hidden", borderRadius: 8 } }}
    >
      <span role="button" tabIndex={0}>
        {receipt}
      </span>
    </Popover>
  );
}
