import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Checkbox, Empty, Spin } from "antd";
import { RefreshCw } from "lucide-react";
import type { Attachment, InviteHistoryTask, Message } from "@chat/shared";
import MessageView from "../../renderer/pages/Chat/components/MessageView";
import { initialInviteHistorySelection } from "../invite-history-selection";
import "./invite-history.less";

export interface InviteHistoryWindowProps {
  task: InviteHistoryTask;
}

/** 同日消息简写时间，跨日时补充日期以保留阅读上下文。 */
function messageTime(value: string, previous?: string) {
  const current = new Date(value);
  const previousDate = previous ? new Date(previous) : null;
  const sameDay =
    previousDate &&
    current.getFullYear() === previousDate.getFullYear() &&
    current.getMonth() === previousDate.getMonth() &&
    current.getDate() === previousDate.getDate();
  return current.toLocaleString("zh-CN", {
    ...(sameDay ? {} : { month: "numeric", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 选择随群聊邀请附带的本地历史，保留辅助窗口的完成与取消协议。 */
export default function InviteHistoryWindow({
  task,
}: InviteHistoryWindowProps) {
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
    setMessages([]);
    setSelectedIds([]);
    void bridge?.messages
      .getRecent({
        taskId: task.taskId,
        conversationId: task.conversationId,
        limit: 30,
      })
      .then((items) => {
        if (!active) return;
        setMessages(items);
        setSelectedIds(
          initialInviteHistorySelection(
            items.map((message) => message.id),
            task.selectedMessageIds,
            task.defaultSelectAll,
          ),
        );
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message || "读取本地聊天记录失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bridge, reloadKey, task]);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const resolveAttachmentUrl = useCallback(
    (attachment: Attachment) =>
      bridge!.attachments
        .resolve({
          taskId: task.taskId,
          attachmentId: attachment.id,
        })
        .then((result) => result.url),
    [bridge, task.taskId],
  );

  /** 更新单条消息的选择，确保同一消息不会重复进入完成结果。 */
  function toggleMessage(messageId: number, checked: boolean) {
    setSelectedIds((current) =>
      checked
        ? [...new Set([...current, messageId])]
        : current.filter((id) => id !== messageId),
    );
  }

  /** 只有本次读取成功且有选择时，才按原协议完成当前任务。 */
  function confirmSelection() {
    if (loading || error || !selectedIds.length) return;
    void bridge?.task.complete(task.taskId, {
      confirmed: true,
      selectedMessageIds: selectedIds,
      selectedCount: selectedIds.length,
    });
  }

  return (
    <main
      data-chat-root
      className="invite-history"
      aria-labelledby="invite-history-title"
    >
      <header className="invite-history__header">
        <h1 id="invite-history-title">附带聊天记录</h1>
        <p id="invite-history-description">
          选择要随邀请分享给新成员的聊天记录，仅展示最近 30 条普通消息。
        </p>
      </header>

      <section
        className="invite-history__body"
        aria-label="可附带的聊天记录"
        aria-describedby="invite-history-description"
        aria-busy={loading}
      >
        {loading && (
          <div className="invite-history__state" role="status">
            <Spin />
            <p>正在读取本地聊天记录…</p>
          </div>
        )}

        {!loading && error && (
          <div className="invite-history__state">
            <div className="invite-history__error">
              <Alert type="error" showIcon title={error} />
              <Button
                className="invite-history__retry"
                icon={<RefreshCw size={14} />}
                onClick={() => setReloadKey((value) => value + 1)}
              >
                重新读取
              </Button>
            </div>
          </div>
        )}

        {!loading && !error && !messages.length && (
          <div className="invite-history__state">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span className="invite-history__empty">
                  <strong>当前群聊暂无可附带的普通消息</strong>
                  <small>入群、退群、撤回等系统通知不会作为聊天附录</small>
                </span>
              }
            />
          </div>
        )}

        {!loading && !error && (
          <div className="invite-history__list">
            {messages.map((message, index) => {
              const checked = selected.has(message.id);
              return (
                <article
                  key={message.clientId}
                  className={`invite-history__item${checked ? " invite-history__item--selected" : ""}`}
                >
                  <Checkbox
                    id={`invite-history-message-${message.id}`}
                    className="invite-history__checkbox"
                    aria-label={`选择${message.senderName}的第 ${index + 1} 条消息`}
                    checked={checked}
                    onChange={(event) =>
                      toggleMessage(message.id, event.target.checked)
                    }
                  />
                  <div className="invite-history__content">
                    <label
                      className="invite-history__metadata"
                      htmlFor={`invite-history-message-${message.id}`}
                    >
                      <strong>{message.senderName}</strong>
                      <time dateTime={message.createdAt}>
                        {messageTime(
                          message.createdAt,
                          messages[index - 1]?.createdAt,
                        )}
                      </time>
                    </label>
                    <div className="invite-history__message">
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
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <footer className="invite-history__footer">
        <div className="invite-history__summary">
          <span role="status" aria-live="polite" aria-atomic="true">
            已选择 <strong>{selectedIds.length}</strong> 条
          </span>
          <Button
            type="link"
            className="invite-history__clear"
            disabled={loading || Boolean(error) || !selectedIds.length}
            onClick={() => setSelectedIds([])}
          >
            取消选中
          </Button>
        </div>
        <div className="invite-history__actions">
          <Button onClick={() => void bridge?.task.cancel(task.taskId)}>
            取消
          </Button>
          <Button
            type="primary"
            disabled={loading || Boolean(error) || !selectedIds.length}
            onClick={confirmSelection}
          >
            确定
          </Button>
        </div>
      </footer>
    </main>
  );
}
