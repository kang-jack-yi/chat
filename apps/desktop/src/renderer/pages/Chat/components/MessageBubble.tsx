import { Dropdown } from "antd";
import { Megaphone } from "lucide-react";
import type {
  Attachment,
  ImagePart,
  LocalMessage,
  Message,
} from "@chat/shared";
import { writeClipboardText } from "../../../services/clipboard";
import MessageContent, {
  attachmentTarget,
  displayMessageText,
  messageStatus,
  openAttachment,
  popupContainer,
  saveAttachment,
  stateItems,
  useAttachmentUrl,
} from "./MessageContent";

export interface MessageBubbleProps {
  message: Message;
  own?: boolean;
  onRetry?: (clientId: string) => void;
  onCancel?: (clientId: string) => void;
  onRemoveFailed?: (clientId: string) => void;
  onQuote?: (message: Message) => void;
  onRecall?: (message: Message) => void;
  onForward?: (message: Message) => void;
  onCreateTask?: (message: Message) => void;
  onSelect?: (message: Message) => void;
  onOpenForwardRecord?: (message: Message) => void;
  contextMenuEnabled?: boolean;
  quotedMessage?: Message;
  onLocateMessage?: (messageId: number) => void;
  resolveAttachmentUrl?: (attachment: Attachment) => Promise<string>;
  onPreviewImage?: (message: Message, part: ImagePart) => void;
}

export function canRecallMessage(
  message: Message,
  own: boolean,
  now = Date.now(),
) {
  return (
    own &&
    message.kind === "user" &&
    message.id > 0 &&
    messageStatus(message) === "sent" &&
    !message.deletedAt &&
    now - new Date(message.createdAt).getTime() <= 2 * 60 * 1000
  );
}

/** 按消息类型展示内容，并统一发送状态与上下文操作。 */
export default function MessageBubble({
  message,
  own,
  onRetry,
  onCancel,
  onRemoveFailed,
  onQuote,
  onRecall,
  onForward,
  onCreateTask,
  onSelect,
  onOpenForwardRecord,
  contextMenuEnabled = true,
  quotedMessage,
  onLocateMessage,
  resolveAttachmentUrl,
  onPreviewImage,
}: MessageBubbleProps) {
  const status = messageStatus(message);
  const filePart = message.parts.find((part) => part.type === "file");
  const textParts = message.parts.filter(
    (part) =>
      part.type === "text" ||
      part.type === "markdown" ||
      part.type === "mention" ||
      part.type === "mention_all",
  );
  const fileUrl = useAttachmentUrl(
    filePart?.type === "file" ? filePart.attachment : undefined,
  );

  const statusMenuItems = stateItems(
    message,
    onRetry,
    onCancel,
    onRemoveFailed,
  );
  const canRecall = canRecallMessage(message, Boolean(own));
  const canUseMessageActions =
    message.id > 0 && status === "sent" && !message.deletedAt;
  const recallMenuItems = canRecall
    ? [
        {
          key: "recall",
          label: "撤回",
          onClick: () => onRecall?.(message),
        },
      ]
    : [];

  if (filePart?.type === "file") {
    const target = attachmentTarget(filePart.attachment);
    const normalFileItems = [
      {
        key: "open",
        label: fileUrl ? "打开" : "下载并打开",
        disabled: !fileUrl,
        onClick: () => void openAttachment(filePart.attachment),
      },
      {
        key: "save",
        label: "另存为",
        disabled: !fileUrl,
        onClick: () => void saveAttachment(filePart.attachment),
      },
      {
        key: "show",
        label: "打开所在文件夹",
        disabled: !fileUrl,
        onClick: () => void window.desktop?.attachment.showInFolder(target),
      },
      {
        key: "copy-name",
        label: "复制文件名",
        onClick: () =>
          void writeClipboardText(filePart.attachment.originalName),
      },
      {
        key: "forward",
        label: "转发",
        disabled: !canUseMessageActions,
        onClick: () => onForward?.(message),
      },
      {
        key: "quote",
        label: "回复",
        disabled: message.id < 0,
        onClick: () => onQuote?.(message),
      },
      {
        key: "task",
        label: "创建任务",
        disabled: !canUseMessageActions,
        onClick: () => onCreateTask?.(message),
      },
      {
        key: "select",
        label: "多选",
        disabled: !canUseMessageActions,
        onClick: () => onSelect?.(message),
      },
      ...recallMenuItems,
    ];
    const menu = {
      items: statusMenuItems.length ? statusMenuItems : normalFileItems,
    };
    return (
      <Dropdown
        trigger={contextMenuEnabled ? ["contextMenu"] : []}
        menu={menu}
        getPopupContainer={popupContainer}
      >
        <div
          data-message-content
          className={`w-72 max-w-full cursor-default overflow-hidden rounded-xl border p-3.5 text-left shadow-sm ${
            own
              ? "border-[var(--chat-file-own-border)] bg-[var(--chat-file-own)]"
              : "border-[var(--chat-file-other-border)] bg-[var(--chat-file-other)]"
          }`}
          onContextMenu={(event) => event.stopPropagation()}
          onDoubleClick={() => {
            if (fileUrl) void openAttachment(filePart.attachment);
          }}
        >
          <MessageContent
            message={message}
            contextMenuEnabled={contextMenuEnabled}
            quotedMessage={quotedMessage}
            onLocateMessage={onLocateMessage}
            onForward={onForward}
            onSelect={onSelect}
            onRecall={onRecall}
            canRecall={canRecall}
            onOpenForwardRecord={onOpenForwardRecord}
            resolveAttachmentUrl={resolveAttachmentUrl}
            onPreviewImage={onPreviewImage}
          />
          {status === "failed" && (
            <button
              type="button"
              className="mt-2 text-xs text-red-500"
              onClick={() => onRetry?.(message.clientId)}
            >
              {(message as Partial<LocalMessage>).error?.message || "发送失败"}
              ，点击重试
            </button>
          )}
        </div>
      </Dropdown>
    );
  }

  const normalBubbleItems = [
    {
      key: "copy",
      label: "复制文本",
      disabled: !textParts.length,
      onClick: () =>
        void writeClipboardText(
          textParts
            .map((part) =>
              part.type === "text"
                ? displayMessageText(part.text)
                : part.type === "markdown"
                  ? displayMessageText(part.content)
                  : `@${part.label}`,
            )
            .join(""),
        ),
    },
    {
      key: "forward",
      label: "转发",
      disabled: !canUseMessageActions,
      onClick: () => onForward?.(message),
    },
    {
      key: "quote",
      label: "回复",
      disabled: message.id < 0,
      onClick: () => onQuote?.(message),
    },
    {
      key: "task",
      label: "创建任务",
      disabled: !canUseMessageActions,
      onClick: () => onCreateTask?.(message),
    },
    {
      key: "select",
      label: "多选",
      disabled: !canUseMessageActions,
      onClick: () => onSelect?.(message),
    },
    ...recallMenuItems,
  ];
  const bubbleMenu = {
    items: statusMenuItems.length ? statusMenuItems : normalBubbleItems,
  };

  if (message.kind === "announcement") {
    return (
      <Dropdown
        trigger={contextMenuEnabled ? ["contextMenu"] : []}
        menu={bubbleMenu}
        getPopupContainer={popupContainer}
      >
        <div
          data-message-content
          className="w-full min-w-0 max-w-md overflow-hidden rounded-xl border border-[var(--chat-attachment-border)] bg-[var(--app-surface)] text-left shadow-[var(--app-shadow-panel)]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--chat-line)] bg-[var(--chat-primary-soft)] px-3.5 py-2.5 text-xs font-medium text-[var(--chat-primary)]">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--app-surface-soft)] text-[var(--chat-primary)]">
              <Megaphone size={14} />
            </span>
            群公告
          </div>
          <div className="px-3.5 py-3 text-sm leading-relaxed text-[var(--chat-text)]">
            <MessageContent
              message={message}
              contextMenuEnabled={contextMenuEnabled}
              quotedMessage={quotedMessage}
              onLocateMessage={onLocateMessage}
              onQuote={onQuote}
              onForward={onForward}
              onSelect={onSelect}
              onRecall={onRecall}
              canRecall={canRecall}
              onOpenForwardRecord={onOpenForwardRecord}
              resolveAttachmentUrl={resolveAttachmentUrl}
              onPreviewImage={onPreviewImage}
            />
          </div>
        </div>
      </Dropdown>
    );
  }

  return (
    <Dropdown
      trigger={contextMenuEnabled ? ["contextMenu"] : []}
      menu={bubbleMenu}
      getPopupContainer={popupContainer}
    >
      <div
        data-message-content
        className={`min-w-0 max-w-xl overflow-hidden break-words border px-3.5 py-2.5 text-left text-sm leading-relaxed [overflow-wrap:anywhere] max-md:max-w-xs ${
          own
            ? "rounded-xl border-[var(--chat-own-bubble-border)] bg-[var(--chat-own-bubble)] text-[var(--chat-text)]"
            : "rounded-xl border-[var(--chat-attachment-border)] bg-[var(--chat-other-bubble)] text-[var(--chat-text)]"
        }`}
      >
        <MessageContent
          message={message}
          contextMenuEnabled={contextMenuEnabled}
          quotedMessage={quotedMessage}
          onLocateMessage={onLocateMessage}
          onRetry={onRetry}
          onCancel={onCancel}
          onRemoveFailed={onRemoveFailed}
          onQuote={onQuote}
          onForward={onForward}
          onSelect={onSelect}
          onRecall={onRecall}
          canRecall={canRecall}
          onOpenForwardRecord={onOpenForwardRecord}
          resolveAttachmentUrl={resolveAttachmentUrl}
          onPreviewImage={onPreviewImage}
        />
        {status === "sending" && (
          <div className="mt-1 text-right text-xs text-slate-400">
            正在确认…
          </div>
        )}
        {status === "failed" && (
          <button
            type="button"
            className="mt-1 text-xs text-red-500"
            onClick={() => onRetry?.(message.clientId)}
          >
            {(message as Partial<LocalMessage>).error?.message || "发送失败"}
            ，点击重试
          </button>
        )}
      </div>
    </Dropdown>
  );
}
