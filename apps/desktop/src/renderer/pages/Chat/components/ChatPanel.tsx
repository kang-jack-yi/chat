import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
} from "react";
import { Button, Checkbox, Modal, message as toast } from "antd";
import {
  Copy,
  ArrowDown,
  Download,
  Forward,
  History,
  MessageCircleMore,
  UsersRound,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type { Conversation, Message, MessagePart, User } from "@chat/shared";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import Avatar from "../../../components/Avatar";
import EmptyState from "../../../components/EmptyState";
import { queryKeys } from "../../../constants/query-keys";
import { chatService } from "../../../services/chat";
import { writeClipboardText } from "../../../services/clipboard";
import { localDatabase } from "../../../services/local-database";
import type { MessagePage } from "../../../types/api";
import { useChat } from "../hooks";
import ComposerQuote from "./ComposerQuote";
import ForwardTargetModal from "./ForwardTargetModal";
import MemberProfilePopover from "./MemberProfilePopover";
import { continuesMessageGroup } from "./message-grouping";
import {
  getSelectableRange,
  isSelectableMessage,
  toggleRangeSelection,
} from "./message-selection";
import { displayMessageText, saveAttachment } from "./MessageContent";
import RichTextEditor from "./RichTextEditor";
import { usePreferencesStore } from "../../../stores/preferences-store";
import MessageView from "./MessageView";
import MessageReadReceiptPopover from "./MessageReadReceiptPopover";
import CreateTaskModal from "./CreateTaskModal";
import styles from "./ChatPanel.module.less";
import {
  COMPOSER_DEFAULT_HEIGHT,
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  resizedComposerHeight,
} from "./composer-resize";

export interface ChatPanelProps {
  conversation: Conversation | null;
  currentUser: User;
  companyName: string;
  users: User[];
  conversations: Conversation[];
  membersOpen?: boolean;
  onToggleMembers?: () => void;
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
    if (part.type === "markdown") return displayMessageText(part.content);
    if (part.type === "mention" || part.type === "mention_all")
      return `@${part.label}`;
    if (part.type === "image") return `[图片] ${part.attachment.originalName}`;
    if (part.type === "file") return `[文件] ${part.attachment.originalName}`;
    if (part.type === "quote")
      return `[回复 ${part.senderName}: ${part.summary}]`;
    if (part.type === "forwarded_message") return part.snapshot.summary;
    if (part.type === "chat_record") return `[聊天记录] ${part.title}`;
    return "";
  };
  return (
    message.parts.map(partText).filter(Boolean).join(" ").trim() ||
    message.summary
  );
}

function messageImages(message: Message) {
  const images: Array<Extract<MessagePart, { type: "image" }>> = [];
  for (const part of message.parts) {
    if (part.type === "image") images.push(part);
    if (part.type === "forwarded_message") {
      images.push(
        ...part.snapshot.parts.filter(
          (item): item is Extract<MessagePart, { type: "image" }> =>
            item.type === "image",
        ),
      );
    }
    if (part.type === "chat_record") {
      for (const item of part.items) {
        images.push(
          ...item.parts.filter(
            (entry): entry is Extract<MessagePart, { type: "image" }> =>
              entry.type === "image",
          ),
        );
      }
    }
  }
  return images;
}

/** 承载消息阅读、回复、多选和可调高度的输入区。 */
export default function ChatPanel({
  conversation,
  currentUser,
  companyName,
  users,
  conversations,
  membersOpen = false,
  onToggleMembers,
  focusedMessageId,
  onOpenSettings,
  onOpenHistory,
  onFocusMessage,
  onClearFocusedMessage,
  onStartDirectChat,
  onViewMember,
}: ChatPanelProps) {
  const queryClient = useQueryClient();
  const chatPreferences = usePreferencesStore(
    (state) => state.preferences?.chat,
  );
  const chat = useChat(conversation?.id, currentUser, focusedMessageId);
  const [selectionAnchorId, setSelectionAnchorId] = useState<number>();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [forwardInput, setForwardInput] = useState<{
    messageIds: number[];
    mode: "individual" | "merged";
  }>();
  const [forwarding, setForwarding] = useState(false);
  const [taskMessage, setTaskMessage] = useState<Message | null>(null);
  const [composerHeight, setComposerHeight] = useState(COMPOSER_DEFAULT_HEIGHT);
  const composerResize = useRef<
    | {
        pointerId: number;
        startHeight: number;
        startPointerY: number;
      }
    | undefined
  >(undefined);
  const selectionMode = Boolean(selectionAnchorId);

  function startComposerResize(event: ReactPointerEvent<HTMLDivElement>) {
    composerResize.current = {
      pointerId: event.pointerId,
      startHeight: composerHeight,
      startPointerY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveComposerResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resizing = composerResize.current;
    if (!resizing || resizing.pointerId !== event.pointerId) return;
    setComposerHeight(
      resizedComposerHeight(
        resizing.startHeight,
        resizing.startPointerY,
        event.clientY,
      ),
    );
  }

  function stopComposerResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (composerResize.current?.pointerId !== event.pointerId) return;
    composerResize.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  useEffect(() => {
    setSelectionAnchorId(undefined);
    setSelectedIds(new Set());
    setForwardInput(undefined);
    setTaskMessage(null);
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

  const selectableRange = getSelectableRange(
    chat.messageItems,
    selectionAnchorId,
  );
  const rangeMessages = selectableRange.messages;
  const rangeIds = rangeMessages.map((item) => item.id);
  const rangeSelectedCount = rangeIds.filter((id) =>
    selectedIds.has(id),
  ).length;
  const rangeAllSelected =
    Boolean(rangeIds.length) && rangeSelectedCount === rangeIds.length;
  const rangePartiallySelected = rangeSelectedCount > 0 && !rangeAllSelected;
  const selectedMessages = chat.messageItems.filter((item) =>
    selectedIds.has(item.id),
  );

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
      const result = await chatService.forward(conversation.id, {
        requestId: crypto.randomUUID(),
        messageIds: forwardInput.messageIds,
        targetConversationIds,
        mode: forwardInput.mode,
      });
      const deliveredMessages = result.deliveries.flatMap(
        (delivery) => delivery.messages,
      );
      const deliveredConversations = result.deliveries.flatMap((delivery) => {
        const target = conversations.find(
          (item) => item.id === delivery.conversationId,
        );
        const lastMessage = delivery.messages.at(-1);
        return target && lastMessage
          ? [
              {
                ...target,
                lastMessage: lastMessage.summary,
                lastMessageId: lastMessage.id,
                lastMessageAt: lastMessage.createdAt,
              },
            ]
          : [];
      });
      if (localDatabase.available()) {
        await Promise.all([
          ...(deliveredMessages.length
            ? [localDatabase.upsertMessages(deliveredMessages)]
            : []),
          ...(deliveredConversations.length
            ? [localDatabase.upsertConversations(deliveredConversations)]
            : []),
        ]);
      }
      const currentDelivery = result.deliveries.find(
        (delivery) => delivery.conversationId === conversation.id,
      );
      if (currentDelivery?.messages.length) {
        queryClient.setQueryData<InfiniteData<MessagePage<Message>>>(
          queryKeys.messages(conversation.id),
          (current) => {
            if (!current) {
              return {
                pages: [{ items: currentDelivery.messages, nextCursor: null }],
                pageParams: [undefined],
              };
            }
            const deliveredIds = new Set(
              currentDelivery.messages.map((message) => message.id),
            );
            const deliveredClientIds = new Set(
              currentDelivery.messages.map((message) => message.clientId),
            );
            const pages = [...current.pages];
            pages[0] = {
              ...pages[0],
              items: [
                ...pages[0].items.filter(
                  (message) =>
                    !deliveredIds.has(message.id) &&
                    !deliveredClientIds.has(message.clientId),
                ),
                ...currentDelivery.messages,
              ],
            };
            return { ...current, pages };
          },
        );
      }
      queryClient.setQueryData<Conversation[]>(
        queryKeys.conversations,
        (current) =>
          current?.map(
            (item) =>
              deliveredConversations.find(
                (updated) => updated.id === item.id,
              ) || item,
          ),
      );
      toast.success(
        forwardInput.mode === "merged" ? "聊天记录已转发" : "消息已转发",
      );
      setForwardInput(undefined);
      stopSelecting();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversations,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "消息转发失败");
    } finally {
      setForwarding(false);
    }
  }

  async function copySelected() {
    if (!selectedMessages.length) return;
    const text = selectedMessages
      .map((item) => {
        const time = new Date(item.createdAt).toLocaleString("zh-CN", {
          hour12: false,
        });
        return `${item.senderName} ${time}\n${plainMessageText(item)}`;
      })
      .join("\n\n");
    await writeClipboardText(text);
    toast.success("已复制所选消息");
  }

  async function saveSelectedImages() {
    const images = selectedMessages.flatMap(messageImages);
    if (!images.length) return;
    if (images.length > 1 && window.desktop?.attachment.saveMany) {
      await window.desktop.attachment.saveMany(
        images.map((part) => ({
          attachmentId: part.attachment.id,
          name: part.attachment.originalName,
        })),
      );
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
          queryClient.invalidateQueries({
            queryKey: queryKeys.messages(conversation.id),
          }),
          queryClient.invalidateQueries({ queryKey: queryKeys.conversations }),
        ]);
      },
    });
  }

  function memberProfile(userId: number) {
    const conversationMember = conversation?.members?.find(
      (member) => member.id === userId,
    );
    const directoryUser = users.find((user) => user.id === userId);
    if (!conversationMember && !directoryUser) return null;
    return {
      ...conversationMember,
      ...directoryUser,
      online: conversationMember?.online ?? directoryUser?.online,
    } as User;
  }

  /** 定位引用消息，减少动态效果偏好下直接跳转并保留主题化提示。 */
  function locateMessage(messageId: number) {
    const element = document.getElementById(`message-${messageId}`);
    if (!element) {
      onFocusMessage(messageId);
      return;
    }
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    element.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
    if (reducedMotion) return;
    element.animate(
      [
        { backgroundColor: "var(--app-primary-soft)" },
        { backgroundColor: "transparent" },
      ],
      { duration: 1200, easing: "ease-out" },
    );
  }

  /** 同步阅读位置，到达顶部时才加载前一页历史。 */
  function loadEarlierOnReachTop(event: UIEvent<HTMLElement>) {
    chat.messageViewport.onViewportScroll();
    const viewport = event.currentTarget;
    if (
      focusedMessageId ||
      viewport.scrollTop > 32 ||
      !chat.messages.hasNextPage ||
      chat.messages.isFetchingNextPage
    )
      return;
    void chat.loadEarlier();
  }

  useEffect(() => {
    if (
      !focusedMessageId ||
      !chat.messageItems.some((item) => item.id === focusedMessageId)
    )
      return;
    const frame = window.requestAnimationFrame(() =>
      locateMessage(focusedMessageId),
    );
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
      className="relative flex h-full w-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden"
    >
      <header className="chat-detail-heading">
        <div className="chat-heading-identity">
          <span className="chat-heading-avatar" aria-hidden="true">
            <Avatar
              text={conversation.avatar || conversation.name.slice(0, 1)}
              group={conversation.type === "group"}
            />
          </span>
          <div className="chat-heading-copy">
            {conversation.type === "direct" ? (
              <MemberProfilePopover
                user={memberProfile(
                  conversation.members?.find(
                    (member) => member.id !== currentUser.id,
                  )?.id ?? 0,
                )}
                currentUser={currentUser}
                companyName={companyName}
                placement="bottomLeft"
                onSendMessage={onStartDirectChat}
                onViewProfile={onViewMember}
              >
                <button
                  type="button"
                  className="chat-heading-profile"
                  aria-label={`查看${conversation.name}的资料`}
                >
                  {conversation.name}
                </button>
              </MemberProfilePopover>
            ) : (
              <h2 title={conversation.name}>{conversation.name}</h2>
            )}
            <p className="chat-heading-meta" aria-live="polite">
              {conversation.type === "group"
                ? `${conversation.members?.length ?? 0} 位成员 · 团队群聊`
                : chat.typingName
                  ? `${chat.typingName} 正在输入…`
                  : conversation.online
                    ? "在线"
                    : "离线"}
            </p>
          </div>
        </div>
        <div className="chat-heading-actions">
          {conversation.type === "group" && onToggleMembers && (
            <Button
              type="text"
              icon={<UsersRound size={18} />}
              aria-label="群成员"
              title={membersOpen ? "收起群成员" : "查看群成员"}
              aria-expanded={membersOpen}
              onClick={onToggleMembers}
              className={membersOpen ? "is-active" : ""}
            />
          )}
          <Button
            type="text"
            icon={<History size={17} />}
            title="聊天记录"
            aria-label="打开聊天记录"
            onClick={onOpenHistory}
            className="!rounded-md !text-[var(--chat-text-secondary)] hover:!bg-[var(--app-surface-muted)] hover:!text-[var(--chat-primary)]"
          />
          <Button
            type="text"
            icon={<Settings size={17} />}
            title="聊天设置"
            aria-label="打开聊天设置"
            onClick={onOpenSettings}
            className="!rounded-md !text-[var(--chat-text-secondary)] hover:!bg-[var(--app-surface-muted)] hover:!text-[var(--chat-primary)]"
          />
        </div>
      </header>

      {selectionMode && (
        <div className={styles.selectionBanner}>
          <Checkbox
            checked={rangeAllSelected}
            indeterminate={rangePartiallySelected}
            onChange={toggleRange}
            className={styles.rangeSelect}
          >
            {rangeAllSelected ? "取消选择以下信息" : "选择以下信息"}
          </Checkbox>
          <span className={styles.rangeHint}>可勾选多条消息</span>
        </div>
      )}

      <div className="chat-timeline">
        <section
          ref={chat.messageListRef}
          aria-label="聊天消息"
          onScroll={loadEarlierOnReachTop}
          className="chat-message-viewport min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto bg-[var(--chat-canvas)] px-5 py-5 max-md:px-3.5 max-md:py-4"
          style={selectionMode ? { paddingTop: 48 } : undefined}
        >
          {focusedMessageId && (
            <div className="sticky top-0 z-10 mb-3 text-center">
              <Button size="small" onClick={onClearFocusedMessage}>
                返回最新消息
              </Button>
            </div>
          )}
          {chat.messageQuery.isLoading && (
            <div role="status" className="chat-history-status">
              正在加载消息...
            </div>
          )}
          {chat.messageQuery.isError && (
            <div role="alert" className="chat-history-status">
              消息加载失败
              <Button
                type="link"
                size="small"
                onClick={() => void chat.messageQuery.refetch()}
              >
                重新加载
              </Button>
            </div>
          )}
          {!focusedMessageId &&
            chat.messages.hasNextPage &&
            !chat.messages.isError && (
              <div className="chat-history-status">
                <Button
                  type="text"
                  size="small"
                  loading={chat.messages.isFetchingNextPage}
                  onClick={() => void chat.loadEarlier()}
                >
                  加载更早消息
                </Button>
              </div>
            )}
          {!chat.messageQuery.isLoading &&
            !chat.messageQuery.isError &&
            !chat.messageItems.length && (
              <div className="chat-timeline-empty">
                <MessageCircleMore size={28} aria-hidden="true" />
                <strong>从一句问候开始</strong>
                <span>在下方输入消息，开启这次对话</span>
              </div>
            )}
          <div ref={chat.messageContentRef}>
            {chat.messageItems.map((message, index, items) => {
              const own = message.senderId === currentUser.id;
              const previous = items[index - 1];
              const continuesPrevious = continuesMessageGroup(
                previous,
                message,
              );
              const quotePart = message.parts.find(
                (part) => part.type === "quote",
              );
              const quotedMessage =
                quotePart?.type === "quote"
                  ? items.find((item) => item.id === quotePart.messageId)
                  : undefined;
              const showTime =
                index === 0 ||
                new Date(message.createdAt).getTime() -
                  new Date(items[index - 1].createdAt).getTime() >
                  300000;
              if (message.kind === "system") {
                return (
                  <div
                    key={message.clientId}
                    id={`message-${message.id}`}
                    data-message-entry
                    className="rounded-xl"
                  >
                    {showTime && (
                      <div className="my-4 text-center text-xs text-[var(--chat-text-tertiary)]">
                        {new Date(message.createdAt).toLocaleString("zh-CN", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </div>
                    )}
                    <div
                      data-message-row
                      className="chat-message-row text-center"
                    >
                      <MessageView
                        message={message}
                        currentUserId={currentUser.id}
                      />
                    </div>
                  </div>
                );
              }
              return (
                <div
                  key={message.clientId}
                  id={`message-${message.id}`}
                  data-message-entry
                  className="min-w-0 max-w-full rounded-xl"
                >
                  {showTime && (
                    <div className="my-4 text-center text-xs text-[var(--chat-text-tertiary)]">
                      {new Date(message.createdAt).toLocaleString("zh-CN", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </div>
                  )}
                  <div
                    data-message-row
                    className={`chat-message-row flex min-w-0 max-w-full items-start gap-2 overflow-hidden${continuesPrevious ? " chat-message-continuation" : ""}`}
                  >
                    {selectionMode && (
                      <Checkbox
                        className="!mt-3 shrink-0"
                        checked={selectedIds.has(message.id)}
                        disabled={!isSelectableMessage(message)}
                        onChange={(event) =>
                          toggleMessage(message, event.target.checked)
                        }
                      />
                    )}
                    <article
                      className={`flex min-w-0 max-w-full flex-1 items-start gap-2 overflow-hidden ${own ? "flex-row-reverse" : ""}`}
                    >
                      {continuesPrevious ? (
                        <span
                          className="chat-message-avatar-space"
                          aria-hidden="true"
                        />
                      ) : conversation.type === "group" &&
                        message.senderType !== "bot" ? (
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
                      <div
                        className={`min-w-0 max-w-full overflow-hidden ${own ? "flex flex-col items-end text-right" : ""}`}
                      >
                        {!own &&
                          !continuesPrevious &&
                          (conversation.type === "group" ||
                            message.senderType === "bot") && (
                            <span className="mb-1 flex items-center gap-1 text-xs text-[var(--chat-text-secondary)]">
                              {message.senderName}
                              {message.senderType === "bot" && (
                                <em className="rounded bg-[var(--chat-primary-soft)] px-1 not-italic text-xs text-[var(--chat-primary)]">
                                  机器人
                                </em>
                              )}
                            </span>
                          )}
                        <MessageView
                          message={message}
                          own={own}
                          onRetry={chat.retry}
                          onCancel={chat.cancel}
                          onRemoveFailed={chat.removeFailed}
                          onQuote={chat.quoteMessage}
                          onRecall={chat.recall}
                          onForward={openForward}
                          onCreateTask={setTaskMessage}
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
                        {own &&
                          message.id > 0 &&
                          Boolean(message.recipientCount) && (
                            <MessageReadReceiptPopover
                              message={message}
                              conversationType={conversation.type}
                            />
                          )}
                      </div>
                    </article>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        {!focusedMessageId && chat.messageViewport.awayFromLatest && (
          <Button
            className="chat-jump-latest"
            icon={<ArrowDown size={16} />}
            aria-label="回到最新消息"
            onClick={chat.messageViewport.scrollToLatest}
          >
            <span aria-live="polite">
              {chat.messageViewport.newMessageCount
                ? `${chat.messageViewport.newMessageCount} 条新消息`
                : "回到最新"}
            </span>
          </Button>
        )}
      </div>

      {selectionMode ? (
        <footer className={styles.selectionToolbar}>
          <span className={styles.selectionCount} aria-live="polite">
            已选择 <strong>{selectedIds.size}</strong> 条
          </span>
          <div
            className={styles.selectionActions}
            role="group"
            aria-label="已选消息操作"
          >
            <Button
              type="text"
              className={styles.selectionAction}
              disabled={!selectedIds.size}
              onClick={() =>
                setForwardInput({
                  messageIds: [...selectedIds],
                  mode: "individual",
                })
              }
            >
              <Forward size={18} />
              <span>逐条转发</span>
            </Button>
            <Button
              type="text"
              className={styles.selectionAction}
              disabled={!selectedIds.size}
              onClick={() =>
                setForwardInput({
                  messageIds: [...selectedIds],
                  mode: "merged",
                })
              }
            >
              <MessageCircleMore size={18} />
              <span>合并转发</span>
            </Button>
            <Button
              type="text"
              className={styles.selectionAction}
              disabled={!selectedIds.size}
              onClick={() => void copySelected()}
            >
              <Copy size={18} />
              <span>复制</span>
            </Button>
            <Button
              type="text"
              className={styles.selectionAction}
              disabled={
                !selectedMessages.some((item) => messageImages(item).length)
              }
              onClick={() => void saveSelectedImages()}
            >
              <Download size={18} />
              <span>保存图片</span>
            </Button>
            <span className={styles.actionDivider} aria-hidden="true" />
            <Button
              danger
              type="text"
              className={`${styles.selectionAction} ${styles.deleteAction}`}
              disabled={!selectedIds.size}
              onClick={deleteSelected}
            >
              <Trash2 size={18} />
              <span>删除</span>
            </Button>
          </div>
          <Button
            type="text"
            shape="circle"
            icon={<X size={19} />}
            aria-label="退出多选"
            title="退出多选（Esc）"
            className={styles.closeSelection}
            onClick={stopSelecting}
          />
        </footer>
      ) : (
        <footer
          className="chat-composer relative min-h-40 max-h-96 border-t border-[var(--chat-line)] bg-[var(--app-surface)] px-4 pb-3 pt-2.5 max-md:pb-[calc(12px+env(safe-area-inset-bottom))]"
          style={
            {
              height: composerHeight,
              "--composer-height": `${composerHeight}px`,
            } as CSSProperties
          }
        >
          <div
            role="separator"
            aria-label="调整发送框高度"
            aria-orientation="horizontal"
            aria-valuemin={COMPOSER_MIN_HEIGHT}
            aria-valuemax={COMPOSER_MAX_HEIGHT}
            aria-valuenow={composerHeight}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              setComposerHeight((height) =>
                resizedComposerHeight(
                  height,
                  0,
                  event.key === "ArrowUp" ? -16 : 16,
                ),
              );
            }}
            className="group absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize touch-none"
            onPointerDown={startComposerResize}
            onPointerMove={moveComposerResize}
            onPointerUp={stopComposerResize}
            onPointerCancel={stopComposerResize}
          >
            <span className="absolute inset-x-0 top-1 h-px bg-transparent transition-colors group-hover:bg-[var(--chat-primary)]" />
          </div>
          <input
            ref={chat.imageRef}
            hidden
            multiple
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={chat.pickFiles}
          />
          <input
            ref={chat.fileRef}
            hidden
            multiple
            type="file"
            onChange={chat.pickFiles}
          />

          <RichTextEditor
            value={chat.draft}
            attachments={chat.attachments}
            onChange={chat.changeDraft}
            onSubmit={() => void chat.submit()}
            onPickImage={() => chat.imageRef.current?.click()}
            onPickFile={() => chat.fileRef.current?.click()}
            onPasteFiles={(files, source) => void chat.addFiles(files, source)}
            onRemoveAttachment={(id) => void chat.removeDraftAttachment(id)}
            quoteContent={
              chat.quote ? (
                <ComposerQuote
                  quote={chat.quote}
                  onClear={() => chat.quoteMessage()}
                />
              ) : undefined
            }
            disabled={chat.submitting}
            editorClassName="min-h-12 h-[calc(var(--composer-height,176px)-106px)]"
            mentionsEnabled={conversation.type === "group"}
            sendKey={chatPreferences?.sendKey}
            placeholder="输入消息…"
            mentionUsers={(conversation.members ?? []).filter(
              (user) => user.id !== currentUser.id && user.status === "active",
            )}
          />
          <span className="chat-composer-hint">
            {chatPreferences?.sendKey === "ctrlEnter"
              ? "Ctrl + Enter 发送 · Enter 换行"
              : "Enter 发送 · Shift + Enter 换行"}
          </span>
          <Button
            type="primary"
            className="!absolute !right-4 !bottom-3.5 !min-w-18 !px-4 !font-medium"
            onClick={() => void chat.submit()}
            disabled={!chat.canSend || chat.submitting}
          >
            {chat.submitting ? "发送中..." : "发送"}
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
      <CreateTaskModal
        open={Boolean(taskMessage)}
        message={taskMessage}
        users={users}
        currentUserId={currentUser.id}
        onClose={() => setTaskMessage(null)}
        onCreated={() => undefined}
      />
    </div>
  );
}
