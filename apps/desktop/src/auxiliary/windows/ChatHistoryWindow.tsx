import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Avatar,
  Button,
  DatePicker,
  Empty,
  Input,
  Select,
  Spin,
  Tabs,
} from "antd";
import { RotateCcw, Search } from "lucide-react";
import type {
  Attachment,
  ChatHistoryMetadata,
  ChatHistoryTask,
  MessageHistoryCategory,
  MessageHistoryHit,
} from "@chat/shared";
import MessageView from "../../renderer/pages/Chat/components/MessageView";

export interface ChatHistoryWindowProps {
  task: ChatHistoryTask;
}

export default function ChatHistoryWindow({ task }: ChatHistoryWindowProps) {
  const bridge = window.auxiliary;
  const [metadata, setMetadata] = useState<ChatHistoryMetadata>();
  const [category, setCategory] = useState<MessageHistoryCategory>("all");
  const [keyword, setKeyword] = useState("");
  const [senderId, setSenderId] = useState<number>();
  const [dateRange, setDateRange] = useState<{
    startAt?: string;
    endAt?: string;
  }>({});
  const [items, setItems] = useState<MessageHistoryHit[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [datePickerKey, setDatePickerKey] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const deferredKeyword = useDeferredValue(keyword.trim());

  const queryPage = useCallback(async (cursor?: string) => {
    if (!bridge) throw new Error("辅助窗口桥接不可用");
    return bridge.history.query({
      taskId: task.taskId,
      query: {
        conversationId: task.conversationId,
        keyword: deferredKeyword || undefined,
        senderId,
        startAt: dateRange.startAt,
        endAt: dateRange.endAt,
        category,
        cursor,
        limit: 50,
      },
    });
  }, [
    bridge,
    category,
    dateRange.endAt,
    dateRange.startAt,
    deferredKeyword,
    senderId,
    task.conversationId,
    task.taskId,
  ]);

  useEffect(() => {
    let active = true;
    setMetadata(undefined);
    setError("");
    void bridge?.history.getMetadata(task.taskId).then((result) => {
      if (active) setMetadata(result);
    }).catch((reason: Error) => {
      if (active) setError(reason.message || "读取会话信息失败");
    });
    return () => {
      active = false;
    };
  }, [bridge, reloadKey, task.taskId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setItems([]);
    setNextCursor(null);
    void queryPage().then((page) => {
      if (!active) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
    }).catch((reason: Error) => {
      if (active) setError(reason.message || "读取本地聊天记录失败");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [queryPage, reloadKey]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !nextCursor || loadingMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      setLoadingMore(true);
      void queryPage(nextCursor).then((page) => {
        setItems((current) => [...current, ...page.items]);
        setNextCursor(page.nextCursor);
      }).catch((reason: Error) => {
        setError(reason.message || "加载更多聊天记录失败");
      }).finally(() => setLoadingMore(false));
    }, { rootMargin: "160px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadingMore, nextCursor, queryPage]);

  const memberOptions = useMemo(
    () => (metadata?.conversation.members ?? []).map((member) => ({
      value: member.id,
      label: member.name,
    })),
    [metadata?.conversation.members],
  );

  useEffect(() => {
    document.title = metadata?.conversation.name || "聊天记录";
  }, [metadata?.conversation.name]);

  const resolveAttachmentUrl = useCallback(
    (attachment: Attachment) => bridge!.attachments.resolve({
      taskId: task.taskId,
      attachmentId: attachment.id,
    }).then((result) => result.url),
    [bridge, task.taskId],
  );

  function resetFilters() {
    setCategory("all");
    setKeyword("");
    setSenderId(undefined);
    setDateRange({});
    setDatePickerKey((value) => value + 1);
  }

  return (
    <main
      data-chat-root
      className="fixed inset-0 grid min-h-0 grid-rows-[minmax(0,1fr)] bg-[var(--app-canvas)] text-[var(--app-text)]"
    >
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_240px]">
        <section className="grid min-h-0 grid-rows-[56px_44px_minmax(0,1fr)] border-r border-[var(--app-line)] bg-[var(--app-surface)]">
          <div className="flex items-center px-5">
            <Input
              allowClear
              value={keyword}
              prefix={<Search size={15} className="text-[var(--app-text-tertiary)]" />}
              placeholder="搜索聊天记录"
              onChange={(event) => setKeyword(event.target.value)}
              className="!bg-[var(--app-surface-muted)]"
            />
          </div>
          <Tabs
            activeKey={category}
            onChange={(key) => setCategory(key as MessageHistoryCategory)}
            className="!m-0 !px-5"
            items={[
              { key: "all", label: "聊天记录" },
              { key: "file", label: "文件" },
              { key: "media", label: "图片与视频" },
            ]}
          />

          <div className="min-h-0 overflow-y-auto px-5 pb-4">
            {loading && (
              <div className="grid h-full place-items-center"><Spin /></div>
            )}
            {!loading && error && (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <p className="text-sm text-[#d04b60]">{error}</p>
                  <Button onClick={() => setReloadKey((value) => value + 1)}>重新加载</Button>
                </div>
              </div>
            )}
            {!loading && !error && !items.length && (
              <div className="grid h-full place-items-center">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到聊天记录" />
              </div>
            )}
            {!loading && !error && items.map(({ message }, index) => {
              const day = new Date(message.createdAt).toLocaleDateString("zh-CN");
              const previousDay = index
                ? new Date(items[index - 1].message.createdAt).toLocaleDateString("zh-CN")
                : "";
              if (message.kind === "system") {
                return (
                  <div key={message.clientId}>
                    {day !== previousDay && (
                      <div className="my-4 flex items-center gap-3 text-[10px] text-[var(--app-text-tertiary)] before:h-px before:flex-1 before:bg-[var(--app-line)] after:h-px after:flex-1 after:bg-[var(--app-line)]">
                        <span className="shrink-0">{day}</span>
                      </div>
                    )}
                    <div className="py-2 text-center">
                      <MessageView
                        message={message}
                        currentUserId={metadata?.currentUserId}
                        compactSystem
                      />
                    </div>
                  </div>
                );
              }
              return (
                <div key={message.clientId}>
                  {day !== previousDay && (
                      <div className="my-4 flex items-center gap-3 text-[10px] text-[var(--app-text-tertiary)] before:h-px before:flex-1 before:bg-[var(--app-line)] after:h-px after:flex-1 after:bg-[var(--app-line)]">
                        <span className="shrink-0">{day}</span>
                    </div>
                  )}
                  <article
                    className="group flex cursor-pointer gap-3 border-b border-[var(--app-line)] py-4 transition-colors hover:bg-[var(--app-surface-soft)]"
                    onClick={() => void bridge?.history.locate({
                      taskId: task.taskId,
                      messageId: message.id,
                    })}
                  >
                    <Avatar
                      shape="square"
                      size={34}
                      className="!shrink-0 !rounded-lg !bg-[#4b8fea]"
                    >
                      {message.senderAvatar || message.senderName.slice(0, 1)}
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <strong className="truncate text-sm font-medium">
                          {message.senderName}
                        </strong>
                        <time className="shrink-0 text-[10px] text-[var(--app-text-tertiary)]">
                          {new Date(message.createdAt).toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })}
                        </time>
                      </div>
                      <div className="w-fit max-w-full text-sm leading-6 text-[var(--app-text)]">
                        <MessageView
                          message={message}
                          currentUserId={metadata?.currentUserId}
                          own={message.senderId === metadata?.currentUserId}
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
                </div>
              );
            })}
            {loadingMore && (
              <div className="py-3 text-center text-xs text-[var(--app-text-tertiary)]">
                正在加载更多…
              </div>
            )}
            <div ref={sentinelRef} className="h-px" />
          </div>
        </section>

        <aside className="min-h-0 overflow-y-auto bg-[var(--app-surface-soft)] px-4 py-5">
          <div className="mb-5 flex items-center justify-between border-b border-[var(--app-line)] pb-3">
            <strong className="text-sm font-semibold">筛选条件</strong>
            <Button
              type="text"
              size="small"
              icon={<RotateCcw size={13} />}
              onClick={resetFilters}
            >
              重置
            </Button>
          </div>
          <div className="grid gap-5">
            <label className="grid gap-2 text-xs font-medium">
              发送人
              <Select
                allowClear
                value={senderId}
                placeholder="请选择"
                options={memberOptions}
                onChange={setSenderId}
              />
            </label>
            <label className="grid gap-2 text-xs font-medium">
              时间
              <DatePicker.RangePicker
                key={datePickerKey}
                className="!w-full"
                placeholder={["开始", "结束"]}
                onChange={(values) => setDateRange(
                  values?.[0] && values[1]
                    ? {
                        startAt: values[0].startOf("day").toISOString(),
                        endAt: values[1].add(1, "day").startOf("day").toISOString(),
                      }
                    : {},
                )}
              />
            </label>
            {!metadata?.historyComplete && (
              <span className="rounded-lg bg-[color-mix(in_srgb,#d99832_14%,transparent)] px-3 py-2 text-[11px] leading-5 text-[#e5ad55]">
                历史消息仍在同步，当前结果可能不完整
              </span>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
