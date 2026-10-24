import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Message } from "@chat/shared";

interface MessageViewportOptions {
  conversationId?: number;
  focusedMessageId?: number;
  currentUserId: number;
  items: Message[];
  viewport: RefObject<HTMLElement | null>;
  content: RefObject<HTMLDivElement | null>;
}

interface ViewportAnchor {
  element: HTMLElement;
  offset: number;
}

/** 在底部跟随新消息，在阅读历史时保留位置并累计新消息提示。 */
export function useMessageViewport({
  conversationId,
  focusedMessageId,
  currentUserId,
  items,
  viewport,
  content,
}: MessageViewportOptions) {
  const following = useRef(true);
  const previousLast = useRef<string | undefined>(undefined);
  const readingAnchor = useRef<ViewportAnchor | undefined>(undefined);
  const historyAnchor = useRef<
    (ViewportAnchor & { firstClientId: string }) | undefined
  >(undefined);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);

  /** 立即回到最新，避免平滑滚动中途的 scroll 事件误判为用户离开底部。 */
  function scrollToLatest() {
    historyAnchor.current = undefined;
    readingAnchor.current = undefined;
    following.current = true;
    setAwayFromLatest(false);
    setNewMessageCount(0);
    const node = viewport.current;
    if (node) node.scrollTop = node.scrollHeight;
  }

  /** 使用容差吸收小数像素和图片加载引起的微小高度差。 */
  function onViewportScroll() {
    const node = viewport.current;
    if (!node) return;
    const atBottom =
      node.scrollHeight - node.clientHeight - node.scrollTop <= 64;
    following.current = atBottom;
    readingAnchor.current = atBottom ? undefined : captureAnchor();
    setAwayFromLatest(!atBottom);
    if (atBottom) setNewMessageCount(0);
  }

  /** 保存首个可见消息的内容坐标，以覆盖分页和图片迟到加载。 */
  function captureAnchor(): ViewportAnchor | undefined {
    const node = viewport.current;
    if (!node) return;
    const element = Array.from(
      node.querySelectorAll<HTMLElement>("[data-message-entry]"),
    ).find(
      (entry) =>
        entry.getBoundingClientRect().bottom >=
        node.getBoundingClientRect().top,
    );
    return element
      ? {
          element,
          offset: element.getBoundingClientRect().top + node.scrollTop,
        }
      : undefined;
  }

  /** 只补偿锚点上方的高度变化，保留请求期间用户继续滚动的距离。 */
  function restoreAnchor(anchor: ViewportAnchor) {
    const node = viewport.current;
    if (!node || !anchor.element.isConnected) return;
    node.scrollTop +=
      anchor.element.getBoundingClientRect().top +
      node.scrollTop -
      anchor.offset;
    onViewportScroll();
  }

  /** 等前置消息真正提交到 DOM 后再恢复，而非依赖请求完成的时机。 */
  function preserveHistoryPosition() {
    following.current = false;
    const anchor = captureAnchor();
    const first = items[0];
    if (anchor && first)
      historyAnchor.current = { ...anchor, firstClientId: first.clientId };
  }

  useLayoutEffect(() => {
    previousLast.current = undefined;
    historyAnchor.current = undefined;
    readingAnchor.current = undefined;
    following.current = !focusedMessageId;
    setAwayFromLatest(false);
    setNewMessageCount(0);
  }, [conversationId, focusedMessageId]);

  useLayoutEffect(() => {
    const anchor = historyAnchor.current;
    const node = viewport.current;
    if (!anchor || !node || items[0]?.clientId === anchor.firstClientId) return;
    historyAnchor.current = undefined;
    if (items.some((item) => item.clientId === anchor.firstClientId))
      restoreAnchor(anchor);
  }, [items]);

  useLayoutEffect(() => {
    if (focusedMessageId) return;
    const last = items.at(-1);
    const previous = previousLast.current;
    previousLast.current = last?.clientId;
    if (!last || previous === last.clientId) return;
    const previousIndex = items.findIndex((item) => item.clientId === previous);
    const appended = previousIndex >= 0 ? items.slice(previousIndex + 1) : [];
    if (
      following.current ||
      (viewport.current &&
        viewport.current.scrollHeight <= viewport.current.clientHeight) ||
      appended.some((item) => item.senderId === currentUserId)
    ) {
      scrollToLatest();
    } else if (appended.length) {
      setNewMessageCount((count) => count + appended.length);
      setAwayFromLatest(true);
    }
  }, [items, currentUserId, conversationId, focusedMessageId]);

  useLayoutEffect(() => {
    const node = content.current;
    if (!node || focusedMessageId) return;
    const observer = new ResizeObserver(() => {
      if (following.current) scrollToLatest();
      else if (readingAnchor.current) restoreAnchor(readingAnchor.current);
    });
    observer.observe(node);
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [content, viewport, conversationId, focusedMessageId]);

  return {
    awayFromLatest,
    newMessageCount,
    scrollToLatest,
    onViewportScroll,
    preserveHistoryPosition,
  };
}
