import { useEffect, useState, type ReactNode } from "react";
import { Dropdown, Image, Progress, Spin } from "antd";
import {
  Download,
  FileText,
  RotateCcw,
  XCircle,
} from "lucide-react";
import type {
  Attachment,
  ImagePart,
  LocalMessage,
  MentionAllPart,
  MentionPart,
  MarkdownPart,
  Message,
  MessagePart,
  QuotePart,
  TextPart,
} from "@chat/shared";
import { formatFileSize } from "../../../utils/format";

export type MessageContentGroup =
  | { type: "text"; parts: Array<TextPart | MentionPart | MentionAllPart> }
  | { type: "markdown"; parts: MarkdownPart[] }
  | { type: "images"; parts: ImagePart[] };

export interface MessageActions {
  onRetry?: (clientId: string) => void;
  onCancel?: (clientId: string) => void;
  onRemoveFailed?: (clientId: string) => void;
  onQuote?: (message: Message) => void;
  onForward?: (message: Message) => void;
  onSelect?: (message: Message) => void;
  onRecall?: (message: Message) => void;
  canRecall?: boolean;
}

export interface MessageContentProps extends MessageActions {
  message: Message;
  contextMenuEnabled?: boolean;
  quotedMessage?: Message;
  onLocateMessage?: (messageId: number) => void;
  resolveAttachmentUrl?: (attachment: Attachment) => Promise<string>;
  onPreviewImage?: (message: Message, part: ImagePart) => void;
  onOpenForwardRecord?: (message: Message) => void;
}

export const messageContentClassNames = {
  file: "w-64 max-w-full overflow-hidden text-left",
  fileIcon: "grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--chat-attachment-icon)] text-[var(--chat-primary)]",
  image: "relative cursor-zoom-in overflow-hidden rounded-xl border border-[var(--chat-attachment-border)] bg-[var(--chat-attachment)]",
  imageElement: "block max-h-80 max-w-full object-contain",
  text: "min-w-0 break-words whitespace-pre-wrap [overflow-wrap:anywhere]",
} as const;

export const popupContainer = (trigger: HTMLElement) =>
  trigger.closest("[data-chat-root]") as HTMLElement || document.body;

export function messageStatus(message: Message) {
  return (message as Partial<LocalMessage>).status || "sent";
}

export function displayMessageText(value: string) {
  if (!/[<>]/.test(value)) return value;
  const richTextTags = new Set([
    "b",
    "strong",
    "i",
    "em",
    "u",
    "p",
    "div",
    "br",
    "ul",
    "ol",
    "li",
    "span",
  ]);
  const tags = [...value.matchAll(/<\/?([a-z][\w-]*)\b[^>]*>/gi)];
  if (tags.some((match) => !richTextTags.has(match[1].toLowerCase()))) {
    return value;
  }
  const container = document.createElement("div");
  container.innerHTML = value;
  return container.textContent || "";
}

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "quote"; text: string }
  | { type: "unordered"; items: string[] }
  | { type: "ordered"; items: string[] }
  | { type: "paragraph"; text: string };

const markdownLineBreaks = (value: string) => value.replace(/\\n/g, "\n").replace(/\r\n?/g, "\n");

const httpUrlPattern = /https?:\/\/[^\s<>"'`]+/gi;
const trailingUrlPunctuation = /[.,!?;:，。！？；：)）\]}】}>]+$/;

export type MessageTextSegment =
  | { type: "text"; value: string }
  | { type: "url"; value: string };

export function messageTextSegments(value: string): MessageTextSegment[] {
  const segments: MessageTextSegment[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(httpUrlPattern)) {
    const start = match.index ?? 0;
    const rawUrl = match[0];
    const url = rawUrl.replace(trailingUrlPunctuation, "");
    if (!url) continue;
    if (start > lastIndex) segments.push({ type: "text", value: value.slice(lastIndex, start) });
    segments.push({ type: "url", value: url });
    if (url.length < rawUrl.length) {
      segments.push({ type: "text", value: rawUrl.slice(url.length) });
    }
    lastIndex = start + rawUrl.length;
  }
  if (lastIndex < value.length) segments.push({ type: "text", value: value.slice(lastIndex) });
  return segments;
}

function LinkifiedText({ value }: { value: string }) {
  return <>
    {messageTextSegments(value).map((segment, index) => segment.type === "url" ? (
      <a
        key={`${segment.value}-${index}`}
        href={segment.value}
        className="text-blue-600 underline decoration-blue-600/40 underline-offset-2 hover:text-blue-700"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void window.desktop?.external.open(segment.value);
        }}
      >
        {segment.value}
      </a>
    ) : <span key={index}>{segment.value}</span>)}
  </>;
}

/** Converts the Webhook Markdown subset into safe, renderable blocks without injecting HTML. */
export function markdownBlocks(value: string): MarkdownBlock[] {
  const lines = markdownLineBreaks(value).split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    const text = paragraph.join("\n").trim();
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "quote", text: quoteLines.join("\n") });
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*+]\s+/, ""));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "unordered", items });
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+[.)]\s+/, ""));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "ordered", items });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

function MarkdownInline({ value }: { value: string }) {
  const tokens = markdownLineBreaks(value).split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_)/g);
  return <>
    {tokens.map((token, index) => {
      if (!token) return null;
      if (/^`[^`]+`$/.test(token)) return <code key={index} className="rounded bg-black/[.06] px-1 py-0.5 font-mono text-sm">{token.slice(1, -1)}</code>;
      if (/^(\*\*[^*]+\*\*|__[^_]+__)$/.test(token)) return <strong key={index} className="font-semibold">{token.slice(2, -2)}</strong>;
      if (/^~~[^~]+~~$/.test(token)) return <del key={index}>{token.slice(2, -2)}</del>;
      if (/^(\*[^*]+\*|_[^_]+_)$/.test(token)) return <em key={index}>{token.slice(1, -1)}</em>;
      return <span key={index}><LinkifiedText value={token} /></span>;
    })}
  </>;
}

export function MarkdownContent({ content }: { content: string }) {
  return <div className="grid gap-2 break-words [overflow-wrap:anywhere]">
    {markdownBlocks(content).map((block, index) => {
      if (block.type === "heading") {
        const className = block.level === 1 ? "text-base font-semibold" : "text-sm font-semibold";
        return <div key={index} className={className}><MarkdownInline value={block.text} /></div>;
      }
      if (block.type === "quote") return <blockquote key={index} className="border-l-2 border-[var(--chat-primary)] bg-[var(--chat-primary-soft)]/60 px-2.5 py-1.5 text-[var(--chat-text-secondary)]"><MarkdownInline value={block.text} /></blockquote>;
      if (block.type === "unordered") return <ul key={index} className="list-disc space-y-0.5 pl-5">{block.items.map((item, itemIndex) => <li key={itemIndex}><MarkdownInline value={item} /></li>)}</ul>;
      if (block.type === "ordered") return <ol key={index} className="list-decimal space-y-0.5 pl-5">{block.items.map((item, itemIndex) => <li key={itemIndex}><MarkdownInline value={item} /></li>)}</ol>;
      return <p key={index} className="whitespace-pre-wrap"><MarkdownInline value={block.text} /></p>;
    })}
  </div>;
}

export function groupMessageContent(parts: MessagePart[]) {
  return parts.reduce<MessageContentGroup[]>((groups, part) => {
    if (part.type === "text" || part.type === "mention" || part.type === "mention_all") {
      const last = groups.at(-1);
      if (last?.type === "text") last.parts.push(part);
      else groups.push({ type: "text", parts: [part] });
    }
    if (part.type === "image") {
      const last = groups.at(-1);
      if (last?.type === "images") last.parts.push(part);
      else groups.push({ type: "images", parts: [part] });
    }
    if (part.type === "markdown") {
      const last = groups.at(-1);
      if (last?.type === "markdown") last.parts.push(part);
      else groups.push({ type: "markdown", parts: [part] });
    }
    return groups;
  }, []);
}

export function attachmentTarget(attachment: Attachment) {
  return attachment.draftId
    ? { draftId: attachment.draftId }
    : { attachmentId: attachment.id };
}

export async function openAttachment(attachment: Attachment) {
  await window.desktop?.attachment.open(attachmentTarget(attachment));
}

export async function saveAttachment(attachment: Attachment) {
  await window.desktop?.attachment.saveAs({
    ...attachmentTarget(attachment),
    name: attachment.originalName,
  });
}

export function useAttachmentUrl(
  attachment?: Attachment,
  resolver?: (attachment: Attachment) => Promise<string>,
) {
  const [objectUrl, setObjectUrl] = useState("");
  useEffect(() => {
    if (!attachment) return;
    if (/^(blob:|data:|chat:)/.test(attachment.url)) {
      setObjectUrl(attachment.url);
      return;
    }
    if (resolver) {
      let active = true;
      resolver(attachment)
        .then((url) => {
          if (active) setObjectUrl(url);
        })
        .catch(() => {
          if (active) setObjectUrl("");
        });
      return () => {
        active = false;
      };
    }
    let active = true;
    let nextUrl = "";
    void import("../../../services/upload")
      .then(({ uploadService }) => uploadService.blob(attachment))
      .then((blob) => {
        if (!active) return;
        nextUrl = URL.createObjectURL(blob);
        setObjectUrl(nextUrl);
      })
      .catch(() => setObjectUrl(""));
    return () => {
      active = false;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [attachment, resolver]);
  return objectUrl;
}

export function stateItems(
  message: Message,
  onRetry?: (clientId: string) => void,
  onCancel?: (clientId: string) => void,
  onRemoveFailed?: (clientId: string) => void,
) {
  const status = messageStatus(message);
  if (status === "uploading" || status === "queued") {
    return [{
      key: "cancel",
      label: "取消发送",
      danger: true,
      icon: <XCircle size={14} />,
      onClick: () => onCancel?.(message.clientId),
    }];
  }
  if (status === "failed") {
    return [
      {
        key: "retry",
        label: "重新发送",
        icon: <RotateCcw size={14} />,
        onClick: () => onRetry?.(message.clientId),
      },
      {
        key: "remove-failed",
        label: "删除失败消息",
        danger: true,
        onClick: () => onRemoveFailed?.(message.clientId),
      },
    ];
  }
  return [];
}

function WithContextMenu({
  enabled,
  menu,
  children,
}: {
  enabled: boolean;
  menu: Parameters<typeof Dropdown>[0]["menu"];
  children: ReactNode;
}) {
  if (!enabled) return children;
  return (
    <Dropdown trigger={["contextMenu"]} menu={menu} getPopupContainer={popupContainer}>
      {children}
    </Dropdown>
  );
}

function MessageImage({
  part,
  message,
  contextMenuEnabled,
  onRetry,
  onCancel,
  onRemoveFailed,
  onQuote,
  onForward,
  onSelect,
  onRecall,
  canRecall,
  resolveAttachmentUrl,
  onPreviewImage,
}: {
  part: ImagePart;
  message: Message;
  contextMenuEnabled: boolean;
  resolveAttachmentUrl?: (attachment: Attachment) => Promise<string>;
  onPreviewImage?: (message: Message, part: ImagePart) => void;
} & MessageActions) {
  const url = useAttachmentUrl(part.attachment, resolveAttachmentUrl);
  const status = messageStatus(message);
  const progress = (message as Partial<LocalMessage>).progress || 0;

  async function copyImage() {
    if (!url) return;
    const blob = await fetch(url).then((response) => response.blob());
    const { writeClipboardImage } = await import("../../../services/clipboard");
    await writeClipboardImage(blob);
  }

  function previewImage() {
    if (onPreviewImage) {
      onPreviewImage(message, part);
      return;
    }
    void window.desktop?.windows.openImageViewer({
      conversationId: message.conversationId,
      messageId: message.id > 0 ? message.id : undefined,
      attachmentId: part.attachment.id > 0 ? part.attachment.id : undefined,
      draftId: part.attachment.draftId,
    });
  }

  const statusMenuItems = stateItems(message, onRetry, onCancel, onRemoveFailed);
  const normalMenuItems = [
      {
        key: "preview",
        label: "查看图片",
        disabled: !url,
        onClick: previewImage,
      },
      {
        key: "copy",
        label: "复制图片",
        disabled: !url,
        onClick: () => void copyImage(),
      },
      {
        key: "save",
        label: "另存为",
        disabled: !url,
        onClick: () => void saveAttachment(part.attachment),
      },
      {
        key: "forward",
        label: "转发",
        disabled: message.id < 0 || status !== "sent",
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
        disabled: message.id < 0 || status !== "sent",
        onClick: () => onSelect?.(message),
      },
      ...(canRecall ? [{
        key: "recall",
        label: "撤回",
        onClick: () => onRecall?.(message),
      }] : []),
    ];
  const menu = {
    items: statusMenuItems.length ? statusMenuItems : normalMenuItems,
  };
  const content = (
    <div
      className={messageContentClassNames.image}
      onClick={(event) => {
        event.stopPropagation();
        if (url) previewImage();
      }}
      onContextMenu={(event) => {
        if (contextMenuEnabled) event.stopPropagation();
      }}
    >
      {url ? (
        <Image
          src={url}
          alt={part.attachment.originalName}
          className={messageContentClassNames.imageElement}
          fallback=""
          preview={false}
        />
      ) : (
        <div className="grid h-24 w-36 place-items-center text-xs text-[var(--chat-text-tertiary)]">
          图片加载失败
        </div>
      )}
      {status === "uploading" && (
        <div className="absolute inset-0 grid place-items-center bg-black/45 text-white">
          <Progress
            type="circle"
            size={52}
            percent={progress}
            strokeColor="#fff"
            trailColor="rgba(255,255,255,.25)"
          />
        </div>
      )}
      {status === "queued" && (
        <span className="absolute right-2 bottom-2 rounded-full bg-black/55 px-2 py-1 text-xs text-white">
          等待发送
        </span>
      )}
    </div>
  );
  return (
    <WithContextMenu enabled={contextMenuEnabled} menu={menu}>
      {content}
    </WithContextMenu>
  );
}

function MessageFile({
  part,
  message,
}: {
  part: Extract<MessagePart, { type: "file" }>;
  message: Message;
}) {
  const status = messageStatus(message);
  const progress = (message as Partial<LocalMessage>).progress || 0;
  return (
    <div className={messageContentClassNames.file}>
      <div className="flex items-center gap-3">
        <span className={messageContentClassNames.fileIcon}>
          <FileText size={24} />
        </span>
        <span className="grid min-w-0 flex-1 gap-1">
          <strong className="overflow-hidden text-xs text-ellipsis whitespace-nowrap">
            {part.attachment.originalName}
          </strong>
          <small className="text-xs text-[var(--chat-text-tertiary)]">
            {formatFileSize(part.attachment.size)}
          </small>
        </span>
        {(
          status === "sending" ? <Spin size="small" /> : <Download size={18} />
        )}
      </div>
      {status === "uploading" && (
        <Progress className="!mb-0 !mt-2" percent={progress} size="small" />
      )}
      {status === "queued" && (
        <div className="mt-1 text-xs text-[var(--chat-text-secondary)]">等待上传</div>
      )}
    </div>
  );
}

function ReplyPreview({
  quote,
  source,
  onLocateMessage,
  resolveAttachmentUrl,
}: {
  quote: QuotePart;
  source?: Message;
  onLocateMessage?: (messageId: number) => void;
  resolveAttachmentUrl?: (attachment: Attachment) => Promise<string>;
}) {
  const imagePart = source?.parts.find((part): part is ImagePart => part.type === "image");
  const filePart = source?.parts.find((part) => part.type === "file");
  const imageUrl = useAttachmentUrl(imagePart?.attachment, resolveAttachmentUrl);
  const content = (
    <>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <strong className="truncate font-medium">{quote.senderName}</strong>
        <span className="line-clamp-2 break-all">{quote.summary}</span>
      </span>
      {imagePart && imageUrl && (
        <img
          src={imageUrl}
          alt={imagePart.attachment.originalName}
          className="h-10 w-12 shrink-0 rounded object-cover"
        />
      )}
      {filePart?.type === "file" && (
        <span className="max-w-28 shrink-0 truncate rounded bg-[var(--app-surface-soft)] px-2 py-1 text-xs">
          {filePart.attachment.originalName}
        </span>
      )}
    </>
  );
  const className =
    "mb-2 flex w-full items-center gap-2 rounded-r-lg border-l-2 border-[var(--chat-primary)] bg-[var(--chat-attachment)] px-2 py-1.5 text-left text-xs text-[var(--chat-text-secondary)]";
  return onLocateMessage ? (
    <button
      type="button"
      className={`${className} hover:bg-black/[.055]`}
      onClick={() => onLocateMessage?.(quote.messageId)}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

export default function MessageContent({
  message,
  contextMenuEnabled = true,
  quotedMessage,
  onLocateMessage,
  onRetry,
  onCancel,
  onRemoveFailed,
  onQuote,
  onForward,
  onSelect,
  onRecall,
  canRecall,
  resolveAttachmentUrl,
  onPreviewImage,
  onOpenForwardRecord,
}: MessageContentProps) {
  const forwarded = message.parts.find((part) => part.type === "forwarded_message");
  const chatRecord = message.parts.find((part) => part.type === "chat_record");
  const contentParts = forwarded?.type === "forwarded_message"
    ? forwarded.snapshot.parts
    : message.parts;
  const quote = contentParts.find((part) => part.type === "quote");
  const quoteSnapshot = contentParts.find((part) => part.type === "quote_snapshot");
  const filePart = contentParts.find((part) => part.type === "file");
  const groups = groupMessageContent(contentParts as MessagePart[]);
  if (chatRecord?.type === "chat_record") {
    return (
      <button
        type="button"
        className="grid w-72 min-w-0 max-w-full gap-2 overflow-hidden rounded-xl border border-[var(--chat-attachment-border)] bg-[var(--chat-attachment)] p-3 text-left transition-colors hover:bg-[var(--app-surface-muted)]"
        onClick={() => onOpenForwardRecord?.(message)}
      >
        <strong className="truncate text-sm font-medium text-[var(--chat-text)]">
          {chatRecord.title}
        </strong>
        <span className="grid gap-0.5 text-xs leading-5 text-[var(--chat-text-secondary)]">
          {chatRecord.items.slice(0, 4).map((item, index) => (
            <span
              key={`${item.originalMessageId}:${index}`}
              className="block truncate"
            >
              {item.senderName}: {item.summary}
            </span>
          ))}
        </span>
        <span className="border-t border-[var(--chat-line)] pt-2 text-xs text-[var(--chat-text-tertiary)]">
          共 {chatRecord.items.length} 条聊天记录
        </span>
      </button>
    );
  }
  return (
    <div data-message-content className="grid min-w-0 max-w-full gap-2 overflow-hidden">
      {quote?.type === "quote" && (
        <ReplyPreview
          quote={quote}
          source={quotedMessage}
          onLocateMessage={onLocateMessage}
          resolveAttachmentUrl={resolveAttachmentUrl}
        />
      )}
      {quoteSnapshot?.type === "quote_snapshot" && (
        <div className="min-w-0 break-words border-l-2 border-[var(--chat-primary)] bg-black/[.035] px-2 py-1.5 text-xs text-[var(--chat-text-secondary)] [overflow-wrap:anywhere]">
          <strong className="mr-1 font-medium">{quoteSnapshot.senderName}</strong>
          {quoteSnapshot.summary}
        </div>
      )}
      {filePart?.type === "file" ? (
        <MessageFile part={filePart} message={message} />
      ) : (
        <div className="grid min-w-0 max-w-full gap-2 overflow-hidden">
            {groups.map((group, groupIndex) => group.type === "text" ? (
              <div
                key={`text-${groupIndex}`}
                className={messageContentClassNames.text}
              >
                {group.parts.map((part, partIndex) => part.type === "text" ? (
                  <span key={partIndex}><LinkifiedText value={displayMessageText(part.text)} /></span>
                ) : (
                  <span key={partIndex} className="text-[var(--chat-primary)]">@{part.label}</span>
                ))}
              </div>
            ) : group.type === "markdown" ? (
              <div key={`markdown-${groupIndex}`} className={`${messageContentClassNames.text} leading-6`}>
                {group.parts.map((part, partIndex) => (
                  <MarkdownContent key={partIndex} content={part.content} />
                ))}
              </div>
            ) : (
              <div
                key={`images-${groupIndex}`}
                className={`grid min-w-0 max-w-full gap-1.5 overflow-hidden ${
                  group.parts.length === 1 ? "grid-cols-1" : "grid-cols-2"
                }`}
              >
                {group.parts.map((part) => (
                  <MessageImage
                    key={`${part.attachment.id}-${part.attachment.originalName}`}
                    part={part}
                    message={message}
                    contextMenuEnabled={contextMenuEnabled}
                    onRetry={onRetry}
                    onCancel={onCancel}
                    onRemoveFailed={onRemoveFailed}
                    onQuote={onQuote}
                    onForward={onForward}
                    onSelect={onSelect}
                    onRecall={onRecall}
                    canRecall={canRecall}
                    resolveAttachmentUrl={resolveAttachmentUrl}
                    onPreviewImage={onPreviewImage}
                  />
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
