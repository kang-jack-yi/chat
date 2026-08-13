import { useEffect, useMemo, useState } from "react";
import { Button, Dropdown, Input, Spin } from "antd";
import { BellOff, MessageCircleMore, Plus, Search } from "lucide-react";
import type { Conversation, GlobalMessageSearchPage } from "@chat/shared";
import Avatar from "../../../components/Avatar";
import EmptyState from "../../../components/EmptyState";
import ListSkeleton from "../../../components/ListSkeleton";
import { formatTime } from "../../../utils/format";
import { richTextToPlainText } from "../../../utils/rich-text";
import {
  useChatDraftStore,
  type ConversationDraft,
} from "../../../stores/chat-draft-store";
import { chatService } from "../../../services/chat";
import { useUserStore } from "../../../stores/user-store";
import { messageSystemEvent, systemMessageText } from "./SystemMessage";

export function conversationDraftPreview(draft?: ConversationDraft) {
  if (!draft) return "";
  const text = richTextToPlainText(draft.text).trim();
  const hasImage = draft.attachments.some((item) => item.meta.image);
  const hasFile = draft.attachments.some((item) => !item.meta.image);
  return [text, hasImage ? "[图片]" : "", hasFile ? "[文件]" : ""]
    .filter(Boolean)
    .join(" ");
}

function HighlightedSnippet({
  value,
  keyword,
}: {
  value: string;
  keyword: string;
}) {
  const source = /<\/?mark>/.test(value)
    ? value
    : value.replace(
        new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
        "<mark>$1</mark>",
      );
  let highlighted = false;
  return source.split(/(<mark>|<\/mark>)/g).map((part, index) => {
    if (part === "<mark>") {
      highlighted = true;
      return null;
    }
    if (part === "</mark>") {
      highlighted = false;
      return null;
    }
    return highlighted ? (
      <mark
        key={index}
        className="rounded-sm bg-[var(--app-primary-soft)] text-[var(--app-primary)]"
      >
        {part}
      </mark>
    ) : (
      <span key={index}>{part}</span>
    );
  });
}

export interface ConversationListProps {
  conversations: Conversation[];
  loading: boolean;
  selectedId?: number;
  onSelect: (id: number) => void;
  onNewGroup: () => void;
  onSetting: (
    conversation: Conversation,
    payload: { pinned?: boolean; muted?: boolean; hidden?: boolean },
  ) => void;
  onDelete: (conversation: Conversation) => void;
  onLocateSearchResult: (
    conversation: Conversation,
    messageId?: number,
  ) => void;
}

export default function ConversationList({
  conversations,
  loading,
  selectedId,
  onSelect,
  onNewGroup,
  onSetting,
  onDelete,
  onLocateSearchResult,
}: ConversationListProps) {
  const [query, setQuery] = useState("");
  const [searchPage, setSearchPage] = useState<GlobalMessageSearchPage>();
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const drafts = useChatDraftStore((state) => state.drafts);
  const currentUserId = useUserStore((state) => state.session?.user.id);
  const filtered = useMemo(
    () =>
      conversations.filter((item) =>
        item.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [conversations, query],
  );

  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) {
      setSearchPage(undefined);
      setSearchLoading(false);
      return;
    }
    let active = true;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      chatService
        .searchWorkspace(keyword)
        .then((page) => {
          if (active) setSearchPage(page);
        })
        .catch(() => {
          if (active) {
            setSearchPage({
              conversations: [],
              messages: [],
              nextCursor: null,
              historyComplete: false,
            });
          }
        })
        .finally(() => {
          if (active) setSearchLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  async function loadMoreSearchResults() {
    if (!searchPage?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await chatService.searchWorkspace(
        query.trim(),
        searchPage.nextCursor,
      );
      setSearchPage((current) =>
        current
          ? {
              ...next,
              conversations: current.conversations,
              messages: [...current.messages, ...next.messages],
            }
          : next,
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-[var(--chat-line)] bg-[var(--app-surface-soft)] px-3">
        <Input
          allowClear
          value={query}
          prefix={
            <Search size={15} className="text-[var(--chat-text-secondary)]" />
          }
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索"
          className="!rounded-[10px] !border !border-transparent !bg-[var(--app-surface-muted)] !shadow-none focus-within:!border-[var(--chat-primary)] focus-within:!bg-[var(--app-surface)]"
        />
        <Button
          type="text"
          icon={<Plus size={19} />}
          onClick={onNewGroup}
          title="新建群聊"
          className="!w-8 !shrink-0 !rounded-[10px] !bg-[var(--app-surface-muted)] !px-0 !text-[var(--chat-text-secondary)] hover:!bg-[var(--chat-rail-hover)] hover:!text-[var(--chat-primary)]"
        />
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-1.5 py-1.5">
        {query.trim() ? (
          <>
            {searchLoading && (
              <div className="grid h-24 place-items-center">
                <Spin size="small" />
              </div>
            )}
            {!searchLoading && searchPage && (
              <div className="grid gap-3 px-1 py-1">
                {!searchPage.historyComplete && (
                  <div className="rounded-md bg-[var(--app-surface-soft)] px-2 py-1.5 text-[11px] text-[var(--app-text-secondary)]">
                    完整历史仍在同步，搜索结果可能不完整
                  </div>
                )}
                {searchPage.conversations.length > 0 && (
                  <section>
                    <h3 className="m-0 px-1 pb-1.5 text-[11px] font-medium text-[var(--chat-text-secondary)]">
                      会话
                    </h3>
                    {searchPage.conversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => {
                          setQuery("");
                          onLocateSearchResult(conversation);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--app-surface-muted)]"
                      >
                        <Avatar
                          text={conversation.avatar}
                          group={conversation.type === "group"}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-[var(--chat-text)]">
                          {conversation.name}
                        </span>
                        {conversation.hidden && (
                          <span className="text-[10px] text-[var(--chat-text-tertiary)]">
                            已隐藏
                          </span>
                        )}
                      </button>
                    ))}
                  </section>
                )}
                {searchPage.messages.length > 0 && (
                  <section>
                    <h3 className="m-0 px-1 pb-1.5 text-[11px] font-medium text-[var(--chat-text-secondary)]">
                      聊天记录
                    </h3>
                    <div className="grid gap-0.5">
                      {searchPage.messages.map((hit) => (
                        <button
                          key={`${hit.conversation.id}-${hit.message.clientId}`}
                          type="button"
                          onClick={() => {
                            setQuery("");
                            onLocateSearchResult(
                              hit.conversation,
                              hit.message.id,
                            );
                          }}
                          className="grid w-full gap-1 rounded-md px-2 py-2 text-left hover:bg-[var(--app-surface-muted)]"
                        >
                          <span className="flex items-center justify-between gap-2">
                            <strong className="truncate text-xs text-[var(--chat-text)]">
                              {hit.conversation.name}
                            </strong>
                            <time className="shrink-0 text-[9px] text-[var(--chat-text-tertiary)]">
                              {formatTime(hit.message.createdAt)}
                            </time>
                          </span>
                          {hit.message.kind !== "system" && (
                            <span className="truncate text-[11px] text-[var(--chat-text-secondary)]">
                              {hit.message.senderName}
                            </span>
                          )}
                          <span className="line-clamp-2 break-all text-xs leading-5 text-[var(--chat-text-secondary)]">
                            <HighlightedSnippet
                              value={
                                hit.message.kind === "system"
                                  ? (() => {
                                      const event = messageSystemEvent(
                                        hit.message,
                                      );
                                      return event
                                        ? systemMessageText(
                                            event,
                                            currentUserId,
                                          )
                                        : hit.message.summary;
                                    })()
                                  : hit.snippet
                              }
                              keyword={query.trim()}
                            />
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {!searchPage.conversations.length &&
                  !searchPage.messages.length && (
                    <EmptyState
                      compact
                      icon={<Search />}
                      title="没有找到相关内容"
                    />
                  )}
                {searchPage.nextCursor && (
                  <Button
                    type="text"
                    size="small"
                    loading={loadingMore}
                    onClick={() => void loadMoreSearchResults()}
                  >
                    加载更多
                  </Button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {loading && <ListSkeleton />}
            {!loading && !filtered.length && (
              <EmptyState
                compact
                icon={<MessageCircleMore />}
                title="暂无会话"
              />
            )}
            {filtered.map((item) => {
              const draftPreview = conversationDraftPreview(drafts[item.id]);
              const selected = selectedId === item.id;
              const menu = {
                items: [
                  {
                    key: "pin",
                    label: item.pinned ? "取消置顶" : "置顶",
                    onClick: () => onSetting(item, { pinned: !item.pinned }),
                  },
                  {
                    key: "mute",
                    label: item.muted ? "关闭免打扰" : "开启免打扰",
                    onClick: () => onSetting(item, { muted: !item.muted }),
                  },
                  {
                    key: "hide",
                    label: "隐藏会话",
                    onClick: () => onSetting(item, { hidden: true }),
                  },
                  { type: "divider" as const },
                  {
                    key: "delete",
                    label: "删除聊天记录",
                    danger: true,
                    onClick: () => onDelete(item),
                  },
                ],
              };
              return (
                <Dropdown key={item.id} trigger={["contextMenu"]} menu={menu}>
                  <button
                    className={`group flex w-full max-w-full items-center gap-2.5 overflow-hidden rounded-[10px] border px-2.5 py-2.5 text-left transition-colors duration-150 ${
                      selected
                        ? "border-transparent bg-[var(--chat-primary-soft)]"
                        : item.pinned
                          ? "border-transparent bg-[var(--chat-pinned)] hover:bg-[var(--chat-pinned-hover)]"
                          : "border-transparent bg-transparent hover:bg-[var(--app-surface-muted)]"
                    }`}
                    onClick={() => onSelect(item.id)}
                  >
                    <Avatar text={item.avatar} group={item.type === "group"} />
                    <span className="grid min-w-0 max-w-full flex-1 gap-1.5 overflow-hidden">
                      <span className="flex min-w-0 max-w-full justify-between gap-2 overflow-hidden">
                        <strong className="flex min-w-0 items-center gap-1 overflow-hidden text-[13px] text-[var(--chat-text)] whitespace-nowrap">
                          <span className="overflow-hidden text-ellipsis">
                            {item.name}
                          </span>
                          {draftPreview && item.mentioned && (
                            <span className="shrink-0 text-[10px] text-[#e17a2d]">
                              {item.mentionType === "all" ? "@所有人" : "@我"}
                            </span>
                          )}
                        </strong>
                        <time className="shrink-0 text-[10px] text-[var(--chat-text-tertiary)]">
                          {formatTime(item.lastMessageAt)}
                        </time>
                      </span>
                      <span className="flex min-w-0 max-w-full items-center justify-between gap-2 overflow-hidden text-xs text-[var(--chat-text-secondary)]">
                        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[var(--chat-text-secondary)]">
                          {draftPreview ? (
                            <>
                              <span className="text-[#e5484d]">[草稿]</span>
                              <span>{draftPreview}</span>
                            </>
                          ) : (
                            <>
                              {item.mentioned && (
                                <span className="text-[#e17a2d]">
                                  {item.mentionType === "all"
                                    ? "[@所有人]"
                                    : "[有人@我]"}
                                </span>
                              )}
                              <span>{item.lastMessage || "开始新的对话"}</span>
                            </>
                          )}
                        </span>
                        {item.muted && (
                          <BellOff
                            size={13}
                            className="ml-auto shrink-0 text-[var(--chat-text-tertiary)]"
                          />
                        )}
                        {item.unreadCount > 0 && (
                          <span
                            className={`grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-bold text-white shadow-sm ${item.muted ? "bg-[#b5bbc5]" : "bg-[#e85d75]"}`}
                          >
                            {item.unreadCount > 99 ? "99+" : item.unreadCount}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </Dropdown>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}
