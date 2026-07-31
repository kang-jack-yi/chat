import { useEffect, useState } from "react";
import { Button, Checkbox, Modal, message as toast } from "antd";
import {
  Check,
  Copy,
  Download,
  Forward,
  History,
  MessageCircleMore,
  Minus,
  Monitor,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type { Conversation, Message, MessagePart, User } from "@chat/shared";
import { useQueryClient } from "@tanstack/react-query";
import Avatar from "../../../components/Avatar";
import EmptyState from "../../../components/EmptyState";
import { queryKeys } from "../../../constants/query-keys";
import { chatService } from "../../../services/chat";
import { writeClipboardText } from "../../../services/clipboard";
import { useChat } from "../hooks";
import ComposerQuote from "./ComposerQuote";
import ForwardTargetModal from "./ForwardTargetModal";
import MemberProfilePopover from "./MemberProfilePopover";
import MessageBubble from "./MessageBubble";
import {
  getSelectableRange,
  isSelectableMessage,
  toggleRangeSelection,
} from "./message-selection";
import {
  displayMessageText,
  saveAttachment,
} from "./MessageContent";
import RichTextEditor from "./RichTextEditor";
import SystemMessage from "./SystemMessage";

export interface ChatPanelProps {
  conversation: Conversation | null;
  currentUser: User;
  companyName: string;
  users: User[];
  conversations: Conversation[];
  showHeaderAction: boolean;
  focusedMessageId?: number;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onFocusMessage: (messageId: number) => void;
  onClearFocusedMessage: () => void;
  onStartDirectChat: (userId: number) => Promise<void>;
  onViewMember: (userId: number) => void;
}

function plainMessageText(message: Message) {
  const partText = (part: MessagePart): string => {
    if (part.type === "text") return displayMessageText(part.text);
    if (part.type === "mention" || part.type === "mention_all") return `@${part.label}`;
    if (part.type === "image") return `[图片] ${part.attachment.originalName}`;
    if (part.type === "file") return `[文件] ${part.attachment.originalName}`;
    if (part.type === "quote") return `[回复 ${part.senderName}: ${part.summary}]`;
    if (part.type === "forwarded_message") return part.snapshot.summary;
    if (part.type === "chat_record") return `[聊天记录] ${part.title}`;
    return "";
  };
  return message.parts.map(partText).filter(Boolean).join(" ").trim() || message.summary;
}

function messageImages(message: Message) {
  const images: Array<Extract<MessagePart, { type: "image" }>> = [];
  for (const part of message.parts) {
    if (part.type === "image") images.push(part);
    if (part.type === "forwarded_message") {
      images.push(...part.snapshot.parts.filter(
        (item): item is Extract<MessagePart, { type: "image" }> => item.type === "image",
      ));
    }
    if (part.type === "chat_record") {
      for (const item of part.items) {
        images.push(...item.parts.filter(
          (entry): entry is Extract<MessagePart, { type: "image" }> => entry.type === "image",
        ));
      }
    }
  }
  return images;
}

export default function ChatPanel({
  conversation,
  currentUser,
  companyName,
  users,
  conversations,
  showHeaderAction,
  focusedMessageId,
  onOpenSettings,
  onOpenHistory,
  onFocusMessage,
  onClearFocusedMessage,
  onStartDirectChat,
  onViewMember,
}: ChatPanelProps) {
  const queryClient = useQueryClient();
  const chat = useChat(conversation?.id, currentUser, focusedMessageId);
  const [selectionAnchorId, setSelectionAnchorId] = useState<number>();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [forwardInput, setForwardInput] = useState<{
    messageIds: number[];
    mode: "individual" | "merged";
  }>();
  const [forwarding, setForwarding] = useState(false);
  const selectionMode = Boolean(selectionAnchorId);

  useEffect(() => {
    setSelectionAnchorId(undefined);
    setSelectedIds(new Set());
    setForwardInput(undefined);
  }, [conversation?.id]);

  useEffect(() => {
    if (!selectionMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectionAnchorId(undefined);
        setSelectedIds(new Set());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectionMode]);

  const selectableRange = getSelectableRange(chat.messageItems, selectionAnchorId);
  const rangeMessages = selectableRange.messages;
  const rangeIds = rangeMessages.map((item) => item.id);
  const rangeSelectedCount = rangeIds.filter((id) => selectedIds.has(id)).length;
  const rangeAllSelected = Boolean(rangeIds.length) && rangeSelectedCount === rangeIds.length;
  const rangePartiallySelected = rangeSelectedCount > 0 && !rangeAllSelected;
  const selectedMessages = chat.messageItems.filter((item) => selectedIds.has(item.id));

  function stopSelecting() {
    setSelectionAnchorId(undefined);
    setSelectedIds(new Set());
  }

  function startSelecting(message: Message) {
    if (!isSelectableMessage(message)) return;
    setSelectionAnchorId(message.id);
    setSelectedIds(new Set([message.id]));
  }

  function toggleMessage(message: Message, checked: boolean) {
    if (!isSelectableMessage(message)) return;
    setSelectedIds((current) => {
      if (checked && !current.has(message.id) && current.size >= 30) {
        toast.warning("最多选择 30 条消息");
        return current;
      }
      const next = new Set(current);
      if (checked) next.add(message.id);
      else next.delete(message.id);
      return next;
    });
  }

  function toggleRange() {
    setSelectedIds((current) => {
      const result = toggleRangeSelection(current, rangeIds);
      if (!result.cleared && (result.truncated || selectableRange.hasMore)) {
        window.setTimeout(() => toast.warning("最多选择 30 条消息"), 0);
      }
      return result.selected;
    });
  }

  function openForward(message: Message) {
    if (!isSelectableMessage(message)) return;
    setForwardInput({ messageIds: [message.id], mode: "individual" });
  }

  async function confirmForward(targetConversationIds: number[]) {
    if (!conversation || !forwardInput) return;
    setForwarding(true);
    try {
      await chatService.forward(conversation.id, {
        requestId: crypto.randomUUID(),
        messageIds: forwardInput.messageIds,
        targetConversationIds,
        mode: forwardInput.mode,
      });
      toast.success(forwardInput.mode === "merged" ? "聊天记录已转发" : "消息已转发");
      setForwardInput(undefined);
      stopSelecting();
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "消息转发失败");
    } finally {
      setForwarding(false);
    }
  }

  async function copySelected() {
    if (!selectedMessages.length) return;
    const text = selectedMessages.map((item) => {
      const time = new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false });
      return `${item.senderName} ${time}\n${plainMessageText(item)}`;
    }).join("\n\n");
    await writeClipboardText(text);
    toast.success("已复制所选消息");
  }

  async function saveSelectedImages() {
    const images = selectedMessages.flatMap(messageImages);
    if (!images.length) return;
    if (images.length > 1 && window.desktop?.attachment.saveMany) {
      await window.desktop.attachment.saveMany(images.map((part) => ({
        attachmentId: part.attachment.id,
        name: part.attachment.originalName,
      })));
    } else {
      for (const part of images) await saveAttachment(part.attachment);
    }
  }

  function deleteSelected() {
    if (!conversation || !selectedIds.size) return;
    Modal.confirm({
      title: "删除所选消息",
      content: `将从当前账号删除所选的 ${selectedIds.size} 条消息，不影响其他聊天成员。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      async onOk() {
        await chatService.deleteForMe(conversation.id, [...selectedIds]);
        stopSelecting();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversation.id) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.conversations }),
        ]);
      },
    });
  }

  function memberProfile(userId: number) {
    const conversationMember = conversation?.members?.find((member) => member.id === userId);
    const directoryUser = users.find((user) => user.id === userId);
    if (!conversationMember && !directoryUser) return null;
    return {
      ...conversationMember,
      ...directoryUser,
      online: conversationMember?.online ?? directoryUser?.online,
    } as User;
  }

  function locateMessage(messageId: number) {
    const element = document.getElementById(`message-${messageId}`);
    if (!element) {
      onFocusMessage(messageId);
      return;
    }
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.animate(
      [
        { backgroundColor: "rgba(22,119,255,.14)" },
        { backgroundColor: "transparent" },
      ],
      { duration: 1200, easing: "ease-out" },
    );
  }

  useEffect(() => {
    if (!focusedMessageId || !chat.messageItems.some((item) => item.id === focusedMessageId)) return;
    const frame = window.requestAnimationFrame(() => locateMessage(focusedMessageId));
    return () => window.cancelAnimationFrame(frame);
  }, [chat.messageItems, focusedMessageId]);

  if (!conversation) {
    return (
      <EmptyState
        icon={<MessageCircleMore size={34} />}
        title="选择一个会话"
        text="从左侧选择联系人或群聊开始沟通"
      />
    );
  }

  return (
    <div
      data-chat-root
      className="grid h-full w-full min-h-0 min-w-0 max-w-full overflow-hidden grid-rows-[60px_minmax(0,1fr)_auto]"
    >
      <header className="flex w-full min-w-0 max-w-full items-center justify-between gap-2 overflow-hidden border-b border-[var(--chat-line)] bg-[var(--chat-header)] px-4 max-md:pl-12">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {conversation.type === "direct" ? (
            <MemberProfilePopover
              user={memberProfile(
                conversation.members?.find((member) => member.id !== currentUser.id)?.id ?? 0,
              )}
              currentUser={currentUser}
              companyName={companyName}
              placement="bottomLeft"
              onSendMessage={onStartDirectChat}
              onViewProfile={onViewMember}
            >
              <h2 className="m-0 min-w-0 truncate text-[15px] leading-4 font-semibold text-[var(--chat-text)] hover:text-[var(--chat-primary)]">
                {conversation.name}
              </h2>
            </MemberProfilePopover>
          ) : (
            <h2 className="m-0 min-w-0 truncate text-[15px] leading-4 font-semibold text-[var(--chat-text)]">
              {conversation.name}
            </h2>
          )}
          {conversation.type === "direct" && (
            <Monitor
              size={14}
              className={`-translate-y-px shrink-0 ${
                conversation.online ? "text-[var(--chat-primary)]" : "text-[var(--chat-text-tertiary)]"
              }`}
            />
          )}
          {conversation.type === "direct" && chat.typingName && (
            <>
              <span className="h-3 w-px shrink-0 bg-[var(--chat-line)]" />
              <span className="truncate text-[11px] text-[var(--chat-text-secondary)]">
                {chat.typingName} 正在输入...
              </span>
            </>
          )}
        </div>
        {showHeaderAction && (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="text"
              icon={<History size={17} />}
              title="聊天记录"
              aria-label="打开聊天记录"
              onClick={onOpenHistory}
              className="!rounded-md !text-[var(--chat-text-secondary)] hover:!bg-[#edf3fa] hover:!text-[var(--chat-primary)]"
            />
            <Button
              type="text"
              icon={<Settings size={17} />}
              title="聊天设置"
              aria-label="打开聊天设置"
              onClick={onOpenSettings}
              className="!rounded-md !text-[var(--chat-text-secondary)] hover:!bg-[#edf3fa] hover:!text-[var(--chat-primary)]"
            />
          </div>
        )}
      </header>

      <section
        ref={chat.messageListRef}
        className="min-w-0 max-w-full overflow-x-hidden overflow-y-auto bg-[var(--chat-canvas)] px-5 py-5 max-md:px-3.5 max-md:py-[18px]"
      >
        {focusedMessageId && (
          <div className="sticky top-0 z-10 mb-3 text-center">
            <Button size="small" onClick={onClearFocusedMessage}>
              返回最新消息
            </Button>
          </div>
        )}
        {chat.messageQuery.isLoading && (
          <div className="my-4 text-center text-[10px] text-[var(--chat-text-tertiary)]">正在加载消息...</div>
        )}
        {!focusedMessageId && !chat.messageQuery.isLoading && (
          <div className="mb-3 text-center">
            {chat.messages.hasNextPage ? (
              <Button
                type="link"
                size="small"
                loading={chat.messages.isFetchingNextPage}
                onClick={chat.loadEarlier}
              >
                加载更早消息
              </Button>
            ) : (
              <span className="px-2.5 py-1 text-[10px] text-[var(--chat-text-tertiary)]">
                没有更早的消息了
              </span>
            )}
          </div>
        )}
        {chat.messageItems.map((message, index, items) => {
          const own = message.senderId === currentUser.id;
          const quotePart = message.parts.find((part) => part.type === "quote");
          const quotedMessage = quotePart?.type === "quote"
            ? items.find((item) => item.id === quotePart.messageId)
            : undefined;
          const showTime = index === 0 ||
            new Date(message.createdAt).getTime() -
              new Date(items[index - 1].createdAt).getTime() >
              300000;
          if (message.kind === "system") {
            return (
              <div key={message.clientId} id={`message-${message.id}`} className="rounded-xl">
                {showTime && (
                  <div className="my-4 text-center text-[10px] text-[var(--chat-text-tertiary)]">
                    {new Date(message.createdAt).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </div>
                )}
                <div className="my-3 text-center">
                  <SystemMessage message={message} currentUserId={currentUser.id} />
                </div>
              </div>
            );
          }
          return (
            <div key={message.clientId} id={`message-${message.id}`} className="min-w-0 max-w-full rounded-xl">
              {showTime && (
                <div className="my-4 text-center text-[10px] text-[var(--chat-text-tertiary)]">
                  {new Date(message.createdAt).toLocaleString("zh-CN", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </div>
              )}
              {selectionAnchorId === message.id && (
                <div className="relative my-3 flex min-h-7 items-center gap-2">
                  <span className="absolute inset-x-0 h-px bg-[var(--chat-primary)]" />
                  <button
                    type="button"
                    aria-label={rangeAllSelected ? "取消选择以下信息" : "选择以下信息"}
                    aria-pressed={rangeAllSelected}
                    onClick={toggleRange}
                    className={`relative ml-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-white shadow-sm transition-colors ${
                      rangeSelectedCount
                        ? "border-[var(--chat-primary)] bg-[var(--chat-primary)]"
                        : "border-[var(--chat-primary)] bg-white"
                    }`}
                  >
                    {rangeAllSelected
                      ? <Check size={13} strokeWidth={3} />
                      : rangePartiallySelected
                        ? <Minus size={13} strokeWidth={3} />
                        : null}
                  </button>
                  <button
                    type="button"
                    onClick={toggleRange}
                    className="relative rounded-full border border-[var(--chat-primary)] bg-white px-4 py-1 text-xs text-[var(--chat-primary)] shadow-sm transition-colors hover:bg-[var(--chat-primary-soft)]"
                  >
                    {rangeAllSelected ? "取消选择以下信息" : "选择以下信息"}
                  </button>
                </div>
              )}
              <div className="my-3 flex min-w-0 max-w-full items-start gap-2 overflow-hidden">
                {selectionMode && (
                  <Checkbox
                    className="!mt-3 shrink-0"
                    checked={selectedIds.has(message.id)}
                    disabled={!isSelectableMessage(message)}
                    onChange={(event) => toggleMessage(message, event.target.checked)}
                  />
                )}
                <article className={`flex min-w-0 max-w-full flex-1 items-start gap-2 overflow-hidden ${own ? "flex-row-reverse" : ""}`}>
                {conversation.type === "group" ? (
                  <MemberProfilePopover
                    user={memberProfile(message.senderId)}
                    currentUser={currentUser}
                    companyName={companyName}
                    placement={own ? "leftTop" : "rightTop"}
                    onSendMessage={onStartDirectChat}
                    onViewProfile={onViewMember}
                  >
                    <Avatar text={message.senderAvatar} />
                  </MemberProfilePopover>
                ) : (
                  <Avatar text={message.senderAvatar} />
                )}
                <div className={`min-w-0 max-w-full overflow-hidden ${own ? "text-right" : ""}`}>
                  {!own && conversation.type === "group" && (
                    <span className="mb-1 block text-[10px] text-[var(--chat-text-secondary)]">
                      {message.senderName}
                    </span>
                  )}
                  <MessageBubble
                    message={message}
                    own={own}
                    onRetry={chat.retry}
                    onCancel={chat.cancel}
                    onRemoveFailed={chat.removeFailed}
                    onQuote={chat.quoteMessage}
                    onRecall={chat.recall}
                    onForward={openForward}
                    onSelect={startSelecting}
                    onOpenForwardRecord={(target) => {
                      void window.desktop?.windows.openForwardRecord({
                        conversationId: target.conversationId,
                        messageId: target.id,
                      });
                    }}
                    contextMenuEnabled={!selectionMode}
                    quotedMessage={quotedMessage}
                    onLocateMessage={locateMessage}
                  />
                  {own && message.id > 0 && Boolean(message.recipientCount) && (
                    <span
                      className={`mt-1 block text-[10px] ${
                        message.readCount ? "text-[var(--chat-primary)]" : "text-[var(--chat-text-tertiary)]"
                      }`}
                    >
                      {conversation.type === "direct"
                        ? message.readCount ? "已读" : "未读"
                        : `${message.readCount ?? 0}/${message.recipientCount} 已读`}
                    </span>
                  )}
                </div>
                </article>
              </div>
            </div>
          );
        })}
        <div ref={chat.bottomRef} />
      </section>

      {selectionMode ? (
        <footer className="flex min-h-[84px] items-center justify-between border-t border-[var(--chat-line)] bg-white px-5">
          <span className="text-sm text-[var(--chat-text-secondary)]">
            已选择 <strong className="text-[var(--chat-primary)]">{selectedIds.size}</strong> 条
          </span>
          <div className="flex items-center gap-1 overflow-x-auto">
            <Button
              type="text"
              icon={<Forward size={17} />}
              disabled={!selectedIds.size}
              onClick={() => setForwardInput({ messageIds: [...selectedIds], mode: "individual" })}
            >
              逐条转发
            </Button>
            <Button
              type="text"
              icon={<MessageCircleMore size={17} />}
              disabled={!selectedIds.size}
              onClick={() => setForwardInput({ messageIds: [...selectedIds], mode: "merged" })}
            >
              合并转发
            </Button>
            <Button type="text" icon={<Copy size={17} />} disabled={!selectedIds.size} onClick={() => void copySelected()}>
              复制
            </Button>
            <Button
              type="text"
              icon={<Download size={17} />}
              disabled={!selectedMessages.some((item) => messageImages(item).length)}
              onClick={() => void saveSelectedImages()}
            >
              保存图片
            </Button>
            <Button danger type="text" icon={<Trash2 size={17} />} disabled={!selectedIds.size} onClick={deleteSelected}>
              删除
            </Button>
            <Button type="text" icon={<X size={18} />} aria-label="退出多选" onClick={stopSelecting} />
          </div>
        </footer>
      ) : (
      <footer className="relative min-h-[176px] border-t border-[var(--chat-line)] bg-white px-[18px] pb-3 pt-2.5 max-md:pb-[calc(12px+env(safe-area-inset-bottom))]">
        <input
          ref={chat.imageRef}
          hidden
          multiple
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={chat.pickFiles}
        />
        <input ref={chat.fileRef} hidden multiple type="file" onChange={chat.pickFiles} />

        <RichTextEditor
          value={chat.draft}
          attachments={chat.attachments}
          onChange={chat.changeDraft}
          onSubmit={() => void chat.submit()}
          onPickImage={() => chat.imageRef.current?.click()}
          onPickFile={() => chat.fileRef.current?.click()}
          onPasteFiles={(files, source) => void chat.addFiles(files, source)}
          onRemoveAttachment={(id) => void chat.removeDraftAttachment(id)}
          quoteContent={chat.quote ? (
            <ComposerQuote
              quote={chat.quote}
              onClear={() => chat.quoteMessage()}
            />
          ) : undefined}
          disabled={chat.submitting}
          mentionsEnabled={conversation.type === "group"}
          mentionUsers={(conversation.members ?? []).filter((user) =>
            user.id !== currentUser.id && user.status === "active")}
        />
        <Button
          type="text"
          className="!absolute !bottom-3.5 !right-[18px] !min-w-0 !border-0 !bg-transparent !px-2 !font-medium !shadow-none enabled:!text-[var(--chat-primary)] enabled:hover:!bg-[var(--chat-primary-soft)]"
          loading={chat.submitting}
          onClick={() => void chat.submit()}
          disabled={!chat.canSend}
        >
          发送
        </Button>
      </footer>
      )}
      <ForwardTargetModal
        open={Boolean(forwardInput)}
        conversations={conversations}
        submitting={forwarding}
        onClose={() => setForwardInput(undefined)}
        onConfirm={confirmForward}
      />
    </div>
  );
}
