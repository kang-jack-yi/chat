import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Checkbox, Empty, Spin } from "antd";
import { RefreshCw } from "lucide-react";
import type {
  Attachment,
  InviteHistoryTask,
  Message,
} from "@chat/shared";
import MessageView from "../../renderer/pages/Chat/components/MessageView";
import { initialInviteHistorySelection } from "../invite-history-selection";

export interface InviteHistoryWindowProps {
  task: InviteHistoryTask;
}

function messageTime(value: string, previous?: string) {
  const current = new Date(value);
  const previousDate = previous ? new Date(previous) : null;
  const sameDay = previousDate
    && current.getFullYear() === previousDate.getFullYear()
    && current.getMonth() === previousDate.getMonth()
    && current.getDate() === previousDate.getDate();
  return current.toLocaleString("zh-CN", {
    ...(sameDay ? {} : { month: "numeric", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function InviteHistoryWindow({ task }: InviteHistoryWindowProps) {
  const bridge = window.auxiliary;
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void bridge?.messages.getRecent({
      taskId: task.taskId,
      conversationId: task.conversationId,
      limit: 30,
    }).then((items) => {
      if (!active) return;
      setMessages(items);
      setSelectedIds(initialInviteHistorySelection(
        items.map((message) => message.id),
        task.selectedMessageIds,
        task.defaultSelectAll,
      ));
    }).catch((reason: Error) => {
      if (active) setError(reason.message || "读取本地聊天记录失败");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [bridge, reloadKey, task]);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const resolveAttachmentUrl = useCallback(
    (attachment: Attachment) => bridge!.attachments.resolve({
      taskId: task.taskId,
      attachmentId: attachment.id,
    }).then((result) => result.url),
    [bridge, task.taskId],
  );

  function toggleMessage(messageId: number, checked: boolean) {
    setSelectedIds((current) => checked
      ? [...new Set([...current, messageId])]
      : current.filter((id) => id !== messageId));
  }

  return (
    <main
      data-chat-root
      className="fixed inset-0 grid min-h-0 grid-rows-[minmax(0,1fr)_70px] border border-[var(--app-line)] bg-white"
    >
      <section className="min-h-0 overflow-y-auto bg-white px-5 py-3">
        {loading && (
          <div className="grid h-full place-items-center">
            <Spin tip="正在读取本地聊天记录…" />
          </div>
        )}

        {!loading && error && (
          <div className="grid h-full place-items-center">
            <div className="w-full max-w-[460px] text-center">
              <Alert type="error" showIcon message={error} />
              <Button
                className="!mt-3"
                icon={<RefreshCw size={14} />}
                onClick={() => setReloadKey((value) => value + 1)}
              >
                重新读取
              </Button>
            </div>
          </div>
        )}

        {!loading && !error && !messages.length && (
          <div className="grid h-full place-items-center">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={(
                <span className="grid gap-1 text-center">
                  <strong className="font-medium text-[#647284]">
                    当前群聊暂无可附带的普通消息
                  </strong>
                  <small className="text-[11px] text-[#9aa5b1]">
                    入群、退群、撤回等系统通知不会作为聊天附录
                  </small>
                </span>
              )}
            />
          </div>
        )}

        {!loading && !error && messages.map((message, index) => {
          const checked = selected.has(message.id);
          return (
            <div
              key={message.clientId}
              className="group rounded-xl px-1 py-2 transition-colors hover:bg-[var(--app-surface-soft)]"
            >
              <time className="mb-2 block text-center text-[10px] text-[var(--app-text-tertiary)]">
                {messageTime(message.createdAt, messages[index - 1]?.createdAt)}
              </time>
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  className="mt-[22px]"
                  checked={checked}
                  onChange={(event) => toggleMessage(message.id, event.target.checked)}
                />
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="text-[11px] text-[var(--app-text-secondary)]">{message.senderName}</span>
                  <span className="w-fit max-w-[460px] min-w-0 text-xs leading-5 text-[var(--app-text)]">
                    <MessageView
                      message={message}
                      contextMenuEnabled={false}
                      resolveAttachmentUrl={resolveAttachmentUrl}
                      onPreviewImage={(targetMessage, part) => {
                        void bridge?.images.openViewer({
                          taskId: task.taskId,
                          conversationId: task.conversationId,
                          messageId: targetMessage.id,
                          attachmentId: part.attachment.id,
                        });
                      }}
                    />
                  </span>
                </span>
              </label>
            </div>
          );
        })}
      </section>

      <footer className="flex items-center justify-between gap-4 border-t border-[var(--app-line)] bg-[var(--app-surface-soft)] px-5">
        <span className="flex min-w-0 items-center gap-4 text-xs">
          <Button
            type="link"
            size="small"
            className="!h-8 !rounded-lg !px-2 !text-[var(--app-primary)] hover:!bg-[var(--app-primary-soft)] disabled:!text-[#a9b5c1]"
            disabled={!selectedIds.length}
            onClick={() => setSelectedIds([])}
          >
            取消选中
          </Button>
          <span className="text-[var(--app-text-secondary)]">已选择 {selectedIds.length} 条聊天记录</span>
        </span>
        <span className="flex shrink-0 gap-2">
          <Button
            type="primary"
            className="!min-w-[112px]"
            disabled={!selectedIds.length}
            onClick={() => void bridge?.task.complete(task.taskId, {
              confirmed: true,
              selectedMessageIds: selectedIds,
              selectedCount: selectedIds.length,
            })}
          >
            确定
          </Button>
          <Button
            className="!min-w-[96px]"
            onClick={() => void bridge?.task.cancel(task.taskId)}
          >
            取消
          </Button>
        </span>
      </footer>
    </main>
  );
}
