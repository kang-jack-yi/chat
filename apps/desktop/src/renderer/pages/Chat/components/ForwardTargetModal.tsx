import { Avatar, Button, Checkbox, Input, Modal, message } from "antd";
import { Search } from "lucide-react";
import type { Conversation } from "@chat/shared";
import { useEffect, useState } from "react";

export interface ForwardTargetModalProps {
  open: boolean;
  conversations: Conversation[];
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (conversationIds: number[]) => Promise<void>;
}

export default function ForwardTargetModal({
  open,
  conversations,
  submitting,
  onClose,
  onConfirm,
}: ForwardTargetModalProps) {
  const [keyword, setKeyword] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  useEffect(() => {
    if (!open) {
      setKeyword("");
      setSelectedIds([]);
    }
  }, [open]);

  const filtered = conversations.filter((conversation) => {
    const query = keyword.trim().toLowerCase();
    return (
      !query ||
      conversation.name.toLowerCase().includes(query) ||
      conversation.lastMessage.toLowerCase().includes(query)
    );
  });

  function toggle(id: number, checked: boolean) {
    if (checked && selectedIds.length >= 9) {
      message.warning("一次最多选择 9 个会话");
      return;
    }
    setSelectedIds((items) =>
      checked ? [...items, id] : items.filter((item) => item !== id),
    );
  }

  return (
    <Modal
      open={open}
      title="选择转发会话"
      width={560}
      centered
      destroyOnHidden
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="confirm"
          type="primary"
          loading={submitting}
          disabled={!selectedIds.length}
          onClick={() => void onConfirm(selectedIds)}
        >
          转发{selectedIds.length ? `（${selectedIds.length}）` : ""}
        </Button>,
      ]}
    >
      <Input
        allowClear
        value={keyword}
        prefix={<Search size={15} />}
        placeholder="搜索已有会话"
        onChange={(event) => setKeyword(event.target.value)}
      />
      <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-[var(--chat-line)]">
        {filtered.map((conversation) => {
          const checked = selectedIds.includes(conversation.id);
          return (
            <label
              key={conversation.id}
              className="flex cursor-pointer items-center gap-3 border-b border-[var(--chat-line)] px-3 py-2.5 last:border-0 hover:bg-[var(--chat-primary-soft)]"
            >
              <Checkbox
                checked={checked}
                onChange={(event) =>
                  toggle(conversation.id, event.target.checked)
                }
              />
              <Avatar size={36} className="!bg-[var(--chat-primary)]">
                {conversation.avatar || conversation.name.slice(0, 1)}
              </Avatar>
              <span className="grid min-w-0 flex-1">
                <strong className="truncate text-sm font-medium text-[var(--chat-text)]">
                  {conversation.name}
                </strong>
                <small className="truncate text-xs text-[var(--chat-text-tertiary)]">
                  {conversation.lastMessage || "暂无消息"}
                </small>
              </span>
            </label>
          );
        })}
        {!filtered.length && (
          <div className="py-12 text-center text-sm text-[var(--chat-text-tertiary)]">
            没有匹配的会话
          </div>
        )}
      </div>
    </Modal>
  );
}
