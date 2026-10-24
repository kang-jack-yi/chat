import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dropdown, Input, Spin } from "antd";
import {
  BellOff,
  MessageCircleMore,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";
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
import "./conversation-list.less";

/** 将草稿正文与附件类型压缩为会话预览，不改变原草稿。 */
export function conversationDraftPreview(draft?: ConversationDraft) {
  if (!draft) return "";
  const text = richTextToPlainText(draft.text).trim();
  const hasImage = draft.attachments.some((item) => item.meta.image);
  const hasFile = draft.attachments.some((item) => !item.meta.image);
  return [text, hasImage ? "[图片]" : "", hasFile ? "[文件]" : ""]
    .filter(Boolean)
    .join(" ");
}

/** 高亮匹配片段，按文本渲染服务端标记以避免注入 HTML。 */
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

/** 合并搜索页并按会话与消息身份去重，保留首次出现的顺序。 */
function mergeSearchPage(
  page: GlobalMessageSearchPage,
  previous?: GlobalMessageSearchPage,
): GlobalMessageSearchPage {
  const conversations = new Map<number, Conversation>();
  const messages = new Map<
    string,
    GlobalMessageSearchPage["messages"][number]
  >();
  for (const item of [
    ...(previous?.conversations || []),
    ...page.conversations,
  ]) {
    conversations.set(item.id, item);
  }
  for (const hit of [...(previous?.messages || []), ...page.messages]) {
    messages.set(
      `${hit.conversation.id}-${hit.message.clientId || hit.message.id}`,
      hit,
    );
  }
  return {
    ...page,
    conversations: [...conversations.values()],
    messages: [...messages.values()],
  };
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

/** 展示会话、未读提示和搜索结果，保留置顶与草稿预览。 */
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
  const [searchError, setSearchError] = useState("");
  const [retry, setRetry] = useState(0);
  const [filter, setFilter] = useState<"all" | "unread" | "group">("all");
  const [openMenuId, setOpenMenuId] = useState<number>();
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const searchSession = useRef({ active: false, loadingMore: false });
  const keyword = query.trim();
  const hasDesktopSearch =
    typeof window !== "undefined" &&
    typeof window.desktop?.im?.call === "function";
  const drafts = useChatDraftStore((state) => state.drafts);
  const currentUserId = useUserStore((state) => state.session?.user.id);
  const visibleConversations = useMemo(
    () => conversations.filter((item) => !item.hidden),
    [conversations],
  );
  const unreadConversations = visibleConversations.filter(
    (item) => item.unreadCount > 0,
  );
  const unreadCount = unreadConversations.reduce(
    (total, item) => total + item.unreadCount,
    0,
  );
  const filtered = useMemo(
    () =>
      visibleConversations.filter((item) =>
        filter === "unread"
          ? item.unreadCount > 0
          : filter === "group"
            ? item.type === "group"
            : true,
      ),
    [visibleConversations, filter],
  );
  const results = hasDesktopSearch
    ? searchPage
    : {
        conversations: conversations.filter((item) =>
          item.name.toLowerCase().includes(keyword.toLowerCase()),
        ),
        messages: [],
        nextCursor: null,
        historyComplete: true,
      };

  /** 输入变化时立即废弃旧请求，包括防抖间隙内返回的分页。 */
  function changeQuery(value: string) {
    if (value.trim() !== keyword) {
      searchSession.current.active = false;
      setSearchPage(undefined);
      setSearchError("");
      setLoadingMore(false);
      setSearchLoading(Boolean(value.trim() && hasDesktopSearch));
    }
    setQuery(value);
  }

  useEffect(() => {
    const session = { active: true, loadingMore: false };
    searchSession.current = session;
    setSearchPage(undefined);
    setSearchError("");
    setLoadingMore(false);
    setSearchLoading(Boolean(keyword && hasDesktopSearch));
    /** 捕获桥接调用的同步/异步失败，只发布仍属于当前查询的结果。 */
    async function search() {
      try {
        const page = await chatService.searchWorkspace(keyword);
        if (session.active) setSearchPage(mergeSearchPage(page));
      } catch {
        if (session.active) setSearchError("搜索失败，请重试");
      } finally {
        if (session.active) setSearchLoading(false);
      }
    }
    const timer =
      keyword && hasDesktopSearch
        ? window.setTimeout(() => void search(), 250)
        : undefined;
    return () => {
      session.active = false;
      window.clearTimeout(timer);
    };
  }, [keyword, hasDesktopSearch, retry]);

  /** 分页失败保留已有结果；查询切换或卸载后忽略结果、错误及收尾状态。 */
  async function loadMoreSearchResults() {
    const session = searchSession.current;
    if (
      !hasDesktopSearch ||
      !searchPage?.nextCursor ||
      !session.active ||
      session.loadingMore
    )
      return;
    session.loadingMore = true;
    setLoadingMore(true);
    setSearchError("");
    try {
      const next = await chatService.searchWorkspace(
        keyword,
        searchPage.nextCursor,
      );
      if (session.active)
        setSearchPage((current) => mergeSearchPage(next, current));
    } catch {
      if (session.active) setSearchError("加载更多失败，已有结果已保留");
    } finally {
      session.loadingMore = false;
      if (session.active) setLoadingMore(false);
    }
  }

  return (
    <>
      <div className="conversation-list-heading">
        <h1>消息</h1>
        <span className="conversation-list-summary" aria-live="polite">
          {unreadCount > 0
            ? `${unreadCount} 条未读`
            : `${visibleConversations.length} 个会话`}
        </span>
      </div>
      <header className="chat-list-search flex shrink-0 items-center gap-2 px-4 pb-4">
        <Input
          allowClear
          aria-label="搜索会话与消息"
          value={query}
          prefix={
            <Search size={15} className="text-[var(--chat-text-secondary)]" />
          }
          onChange={(event) => changeQuery(event.target.value)}
          placeholder="搜索会话与消息"
          className="!rounded-lg !border !border-transparent !bg-[var(--app-surface-muted)] !shadow-none focus-within:!border-[var(--chat-primary)] focus-within:!bg-[var(--app-surface)]"
        />
        <Button
          type="text"
          icon={<Plus size={19} />}
          onClick={onNewGroup}
          title="新建群聊"
          aria-label="新建群聊"
          className="!w-8 !shrink-0 !rounded-lg !bg-[var(--app-surface-muted)] !px-0 !text-[var(--chat-text-secondary)] hover:!bg-[var(--chat-rail-hover)] hover:!text-[var(--chat-primary)]"
        />
      </header>
      {!keyword && (
        <div
          className="conversation-list-filters"
          role="group"
          aria-label="会话筛选"
        >
          <button
            type="button"
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            全部
          </button>
          <button
            type="button"
            aria-pressed={filter === "unread"}
            onClick={() => setFilter("unread")}
            aria-label={`未读会话，${unreadConversations.length} 个`}
          >
            未读 <span>{unreadConversations.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={filter === "group"}
            onClick={() => setFilter("group")}
          >
            群聊
          </button>
        </div>
      )}
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-1.5 py-1.5">
        {keyword ? (
          <>
            {!hasDesktopSearch && (
              <p className="conversation-list-notice" role="status">
                仅搜索已有会话；本地历史消息搜索需使用桌面客户端。
              </p>
            )}
            {searchLoading && (
              <div
                className="conversation-list-feedback"
                role="status"
                aria-busy="true"
              >
                <Spin size="small" />
                <span>正在搜索…</span>
              </div>
            )}
            {searchError && (
              <div className="conversation-list-feedback" role="alert">
                <span>{searchError}</span>
                <Button
                  type="text"
                  size="small"
                  onClick={() =>
                    searchPage
                      ? void loadMoreSearchResults()
                      : setRetry((value) => value + 1)
                  }
                >
                  {searchPage ? "重试加载更多" : "重试搜索"}
                </Button>
              </div>
            )}
            {!searchLoading && results && (
              <div className="grid gap-3 px-1 py-1">
                {hasDesktopSearch && !results.historyComplete && (
                  <div className="rounded-md bg-[var(--app-surface-soft)] px-2 py-1.5 text-xs text-[var(--app-text-secondary)]">
                    完整历史仍在同步，搜索结果可能不完整
                  </div>
                )}
                {results.conversations.length > 0 && (
                  <section>
                    <h3 className="m-0 px-1 pb-1.5 text-xs font-medium text-[var(--chat-text-secondary)]">
                      会话
                    </h3>
                    {results.conversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => {
                          changeQuery("");
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
                          <span className="text-xs text-[var(--chat-text-tertiary)]">
                            已隐藏
                          </span>
                        )}
                      </button>
                    ))}
                  </section>
                )}
                {results.messages.length > 0 && (
                  <section>
                    <h3 className="m-0 px-1 pb-1.5 text-xs font-medium text-[var(--chat-text-secondary)]">
                      聊天记录
                    </h3>
                    <div className="grid gap-0.5">
                      {results.messages.map((hit) => (
                        <button
                          key={`${hit.conversation.id}-${hit.message.clientId || hit.message.id}`}
                          type="button"
                          onClick={() => {
                            changeQuery("");
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
                            <time className="shrink-0 text-xs text-[var(--chat-text-tertiary)]">
                              {formatTime(hit.message.createdAt)}
                            </time>
                          </span>
                          {hit.message.kind !== "system" && (
                            <span className="truncate text-xs text-[var(--chat-text-secondary)]">
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
                              keyword={keyword}
                            />
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {!searchError &&
                  !results.conversations.length &&
                  !results.messages.length && (
                    <EmptyState
                      compact
                      icon={<Search />}
                      title="没有找到相关内容"
                    />
                  )}
                {results.nextCursor && !searchError && (
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
              <div className="conversation-list-empty">
                <EmptyState
                  compact
                  icon={<MessageCircleMore />}
                  title={
                    filter === "unread"
                      ? "暂无未读会话"
                      : filter === "group"
                        ? "暂无群聊"
                        : "暂无会话"
                  }
                />
                {filter !== "all" && (
                  <Button type="text" onClick={() => setFilter("all")}>
                    查看全部会话
                  </Button>
                )}
              </div>
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
                <Dropdown
                  key={item.id}
                  trigger={["contextMenu"]}
                  menu={menu}
                  autoFocus
                  onOpenChange={(open) => {
                    if (open) setOpenMenuId(undefined);
                  }}
                >
                  <div
                    className={`chat-conversation-row conversation-list-row group flex w-full max-w-full items-center overflow-hidden rounded-lg border text-left ${
                      selected
                        ? "border-transparent bg-[var(--chat-primary-soft)]"
                        : item.pinned
                          ? "border-transparent bg-[var(--chat-pinned)] hover:bg-[var(--chat-pinned-hover)]"
                          : "border-transparent bg-transparent hover:bg-[var(--app-surface-muted)]"
                    }`}
                  >
                    <button
                      type="button"
                      className="conversation-list-select"
                      aria-label={`打开会话：${item.name}`}
                      aria-current={selected ? "true" : undefined}
                      onClick={() => onSelect(item.id)}
                    >
                      <Avatar
                        text={item.avatar}
                        group={item.type === "group"}
                      />
                      <span className="grid min-w-0 max-w-full flex-1 gap-1.5 overflow-hidden">
                        <span className="flex min-w-0 max-w-full justify-between gap-2 overflow-hidden">
                          <strong className="flex min-w-0 items-center gap-1 overflow-hidden text-sm text-[var(--chat-text)] whitespace-nowrap">
                            <span className="overflow-hidden text-ellipsis">
                              {item.name}
                            </span>
                            {draftPreview && item.mentioned && (
                              <span className="shrink-0 text-xs text-[var(--app-primary)]">
                                {item.mentionType === "all" ? "@所有人" : "@我"}
                              </span>
                            )}
                          </strong>
                          <time className="shrink-0 text-xs text-[var(--chat-text-tertiary)]">
                            {formatTime(item.lastMessageAt)}
                          </time>
                        </span>
                        <span className="flex min-w-0 max-w-full items-center justify-between gap-2 overflow-hidden text-xs text-[var(--chat-text-secondary)]">
                          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[var(--chat-text-secondary)]">
                            {draftPreview ? (
                              <>
                                <span className="text-[var(--app-danger)]">
                                  [草稿]
                                </span>
                                <span>{draftPreview}</span>
                              </>
                            ) : (
                              <>
                                {item.mentioned && (
                                  <span className="text-[var(--app-primary)]">
                                    {item.mentionType === "all"
                                      ? "[@所有人]"
                                      : "[有人@我]"}
                                  </span>
                                )}
                                <span>
                                  {item.lastMessage || "开始新的对话"}
                                </span>
                              </>
                            )}
                          </span>
                          {item.muted && (
                            <BellOff
                              size={13}
                              aria-label="免打扰"
                              className="ml-auto shrink-0 text-[var(--chat-text-tertiary)]"
                            />
                          )}
                          {item.unreadCount > 0 && (
                            <span
                              className={`conversation-list-unread${item.muted ? " is-muted" : ""}`}
                              aria-label={`${item.unreadCount} 条未读消息`}
                              title={`${item.unreadCount} 条未读消息`}
                            >
                              {item.unreadCount > 99 ? "99+" : item.unreadCount}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                    <Dropdown
                      trigger={["click"]}
                      menu={menu}
                      autoFocus
                      open={openMenuId === item.id}
                      onOpenChange={(open) => {
                        setOpenMenuId(open ? item.id : undefined);
                        // 菜单内通过键盘关闭时归还焦点，不打断点击外部控件。
                        if (
                          !open &&
                          document.activeElement?.closest('[role="menu"]')
                        ) {
                          menuTrigger.current?.focus();
                        }
                      }}
                    >
                      <button
                        type="button"
                        className="conversation-list-more"
                        aria-label={`${item.name}的更多操作`}
                        title="更多操作"
                        aria-haspopup="menu"
                        aria-expanded={openMenuId === item.id}
                        onFocus={(event) => {
                          menuTrigger.current = event.currentTarget;
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setOpenMenuId(item.id);
                          }
                        }}
                      >
                        <MoreHorizontal size={17} aria-hidden="true" />
                      </button>
                    </Dropdown>
                  </div>
                </Dropdown>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}
