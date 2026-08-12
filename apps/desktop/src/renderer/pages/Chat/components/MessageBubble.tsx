import { Dropdown } from "antd";
import { Megaphone } from "lucide-react";
import type { Attachment, ImagePart, LocalMessage, Message } from "@chat/shared";
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
  return own
    && message.kind === "user"
    && message.id > 0
    && messageStatus(message) === "sent"
    && !message.deletedAt
    && now - new Date(message.createdAt).getTime() <= 2 * 60 * 1000;
}

export default function MessageBubble({
  message,
  own,
  onRetry,
  onCancel,
  onRemoveFailed,
  onQuote,
  onRecall,
  onForward,
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
  const textParts = message.parts.filter((part) =>
    part.type === "text" || part.type === "mention" || part.type === "mention_all");
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
  const canUseMessageActions = message.id > 0 && status === "sent" && !message.deletedAt;
  const recallMenuItems = canRecall
    ? [{
        key: "recall",
        label: "撤回",
        onClick: () => onRecall?.(message),
      }]
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
        onClick: () => void writeClipboardText(filePart.attachment.originalName),
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
          className={`w-[290px] max-w-full cursor-default overflow-hidden rounded-[14px] border p-3.5 text-left shadow-[0_4px_14px_rgba(24,34,48,.045)] ${
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
              className="mt-2 text-xs text-[#e5484d]"
              onClick={() => onRetry?.(message.clientId)}
            >
              {(message as Partial<LocalMessage>).error?.message || "发送失败"}，点击重试
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
        onClick: () => void writeClipboardText(textParts.map((part) =>
          part.type === "text"
            ? displayMessageText(part.text)
            : `@${part.label}`).join("")),
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
        <div className="w-[min(420px,54vw)] min-w-0 max-w-full overflow-hidden rounded-[14px] border border-[var(--chat-attachment-border)] bg-white text-left shadow-[0_8px_24px_rgba(24,34,48,.06)]">
          <div className="flex items-center gap-2 border-b border-[var(--chat-line)] bg-[var(--chat-primary-soft)] px-3.5 py-2.5 text-xs font-medium text-[var(--chat-primary)]">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-white/75 text-[var(--chat-primary)]">
              <Megaphone size={14} />
            </span>
            群公告
          </div>
          <div className="px-3.5 py-3 text-sm leading-[1.65] text-[var(--chat-text)]">
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
        className={`min-w-0 max-w-[min(520px,58vw)] overflow-hidden break-words border px-3.5 py-2.5 text-left text-sm leading-[1.6] [overflow-wrap:anywhere] shadow-[0_5px_16px_rgba(24,34,48,.045)] max-md:max-w-[70vw] ${
          own
            ? "rounded-[15px_5px_15px_15px] border-[#cfe0ff] bg-[var(--chat-own-bubble)] text-[var(--chat-text)]"
            : "rounded-[5px_15px_15px_15px] border-[var(--chat-attachment-border)] bg-[var(--chat-other-bubble)] text-[var(--chat-text)]"
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
          <div className="mt-1 text-right text-[10px] text-[#7b84a0]">正在确认…</div>
        )}
        {status === "failed" && (
          <button
            type="button"
            className="mt-1 text-xs text-[#e5484d]"
            onClick={() => onRetry?.(message.clientId)}
          >
            {(message as Partial<LocalMessage>).error?.message || "发送失败"}，点击重试
          </button>
        )}
      </div>
    </Dropdown>
  );
}
