// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@chat/shared";
import { useMessageViewport } from "./use-message-viewport";

/** 生成仅参与滚动身份与发送者判断的消息。 */
function message(id: number, senderId = 2): Message {
  return { id, clientId: `message-${id}`, senderId } as Message;
}

describe("聊天消息滚动与新消息提示", () => {
  let host: HTMLDivElement;
  let root: Root;
  let height: number;
  let top: number;
  let imageGrowth: number;
  let resized: (() => void) | undefined;
  let controls: ReturnType<typeof useMessageViewport>;

  /** 使用真实 Hook 和模拟视口尺寸，单独控制滚动及图片尺寸事件。 */
  function Harness({
    items,
    conversationId = 1,
    focusedMessageId,
  }: {
    items: Message[];
    conversationId?: number;
    focusedMessageId?: number;
  }) {
    const viewport = useRef<HTMLElement | null>(null);
    const content = useRef<HTMLDivElement | null>(null);
    controls = useMessageViewport({
      items,
      conversationId,
      focusedMessageId,
      currentUserId: 1,
      viewport,
      content,
    });
    return (
      <section
        ref={(node) => {
          viewport.current = node;
          if (node)
            Object.defineProperties(node, {
              scrollHeight: { configurable: true, get: () => height },
              clientHeight: { configurable: true, value: 300 },
              scrollTop: {
                configurable: true,
                get: () => top,
                set: (value: number) => {
                  top = Math.max(0, Math.min(value, height - 300));
                },
              },
            });
        }}
      >
        <div ref={content}>
          {items.map((item, index) => (
            <div
              key={item.clientId}
              data-message-entry
              ref={(node) => {
                if (node)
                  node.getBoundingClientRect = () =>
                    ({
                      top: index * 100 + (index ? imageGrowth : 0) - top,
                      bottom: (index + 1) * 100 + imageGrowth - top,
                    }) as DOMRect;
              }}
            />
          ))}
        </div>
      </section>
    );
  }

  /** 提交消息批次并等待布局效果执行。 */
  async function render(
    items: Message[],
    conversationId = 1,
    focusedMessageId?: number,
  ) {
    await act(async () =>
      root.render(
        <Harness
          items={items}
          conversationId={conversationId}
          focusedMessageId={focusedMessageId}
        />,
      ),
    );
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        /** 保存回调，让测试模拟图片迟到撑高内容。 */
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    height = 1000;
    top = 0;
    imageGrowth = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("首次加载与位于底部时自动显示最新消息", async () => {
    await render([message(1)]);
    expect(top).toBe(700);
    height = 1200;
    await render([message(1), message(2)]);
    expect(top).toBe(900);
    expect(controls.newMessageCount).toBe(0);
  });

  it("阅读历史时不抢位置，累计新消息并一键回底部", async () => {
    await render([message(1)]);
    top = 100;
    await act(async () => controls.onViewportScroll());
    height = 1200;
    await render([message(1), message(2), message(3)]);
    expect(top).toBe(100);
    expect(controls.awayFromLatest).toBe(true);
    expect(controls.newMessageCount).toBe(2);
    await act(async () => controls.scrollToLatest());
    expect(top).toBe(900);
    expect(controls.newMessageCount).toBe(0);
    expect(controls.awayFromLatest).toBe(false);
  });

  it("前置历史分页与相同消息的重新查询不增加新消息数", async () => {
    await render([message(3), message(4)]);
    top = 100;
    await act(async () => controls.onViewportScroll());
    await render([message(1), message(2), message(3), message(4)]);
    await render([message(1), message(2), message(3), message(4)]);
    expect(top).toBe(100);
    expect(controls.newMessageCount).toBe(0);
  });

  it("图片变高只在跟随底部时调整位置", async () => {
    await render([message(1)]);
    height = 1200;
    await act(async () => resized?.());
    expect(top).toBe(900);
    top = 100;
    await act(async () => controls.onViewportScroll());
    height = 1400;
    await act(async () => resized?.());
    expect(top).toBe(100);
  });

  it("历史请求先完成、DOM 后提交时仍保持原消息位置", async () => {
    await render([message(3), message(4)]);
    top = 0;
    await act(async () => controls.preserveHistoryPosition());
    // 网络完成不等于 React 已提交，未新增节点时不能提前消耗锚点。
    await render([message(3), message(4)]);
    expect(top).toBe(0);
    height = 1200;
    await render([message(1), message(2), message(3), message(4)]);
    expect(top).toBe(200);
    expect(controls.newMessageCount).toBe(0);
  });

  it("历史上方图片加载变高时保持可见消息的阅读位置", async () => {
    await render([message(1), message(2), message(3), message(4)]);
    top = 150;
    await act(async () => controls.onViewportScroll());
    const anchor = host.querySelectorAll<HTMLElement>(
      "[data-message-entry]",
    )[1];
    const before = anchor.getBoundingClientRect().top;
    imageGrowth = 200;
    height += imageGrowth;
    await act(async () => resized?.());
    expect(anchor.getBoundingClientRect().top).toBe(before);
    expect(top).toBe(350);
    await act(async () => resized?.());
    expect(top).toBe(350);
  });

  it("分页期间切换会话或主动回到最新，不恢复旧锚点", async () => {
    await render([message(3), message(4)]);
    top = 0;
    await act(async () => controls.preserveHistoryPosition());
    await render([message(10), message(11)], 2);
    expect(top).toBe(700);
    top = 0;
    await act(async () => controls.preserveHistoryPosition());
    await act(async () => controls.scrollToLatest());
    height = 1200;
    await render([message(8), message(9), message(10), message(11)], 2);
    await act(async () => resized?.());
    expect(top).toBe(900);
  });

  it("切换会话清除提示，新的会话从底部开始", async () => {
    await render([message(1)]);
    top = 100;
    await act(async () => controls.onViewportScroll());
    await render([message(1), message(2)]);
    await render([message(20)], 2);
    expect(top).toBe(700);
    expect(controls.newMessageCount).toBe(0);
  });

  it("定位历史消息时不自动滚动，退出定位后回到最新", async () => {
    await render([message(1), message(2)], 1, 1);
    expect(top).toBe(0);
    await act(async () => resized?.());
    expect(top).toBe(0);
    await render([message(1), message(2)]);
    expect(top).toBe(700);
  });

  it("用户发送自己的消息时回到底部，手动滚回底部清除提示", async () => {
    await render([message(1)]);
    top = 100;
    await act(async () => controls.onViewportScroll());
    await render([message(1), message(2, 1)]);
    expect(top).toBe(700);
    top = 100;
    await act(async () => controls.onViewportScroll());
    await render([message(1), message(2, 1), message(3)]);
    expect(controls.newMessageCount).toBe(1);
    top = 700;
    await act(async () => controls.onViewportScroll());
    expect(controls.newMessageCount).toBe(0);
  });

  it("内容未超出视口时不会显示多余的新消息提示", async () => {
    height = 200;
    await render([message(1)]);
    await act(async () => controls.onViewportScroll());
    height = 250;
    await render([message(1), message(2)]);
    expect(controls.awayFromLatest).toBe(false);
    expect(controls.newMessageCount).toBe(0);
  });
});
