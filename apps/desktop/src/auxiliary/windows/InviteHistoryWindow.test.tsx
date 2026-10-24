// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InviteHistoryTask, Message } from "@chat/shared";
import InviteHistoryWindow from "./InviteHistoryWindow";

type Bridge = NonNullable<Window["auxiliary"]>;
const bridge = {
  messages: { getRecent: vi.fn<Bridge["messages"]["getRecent"]>() },
  task: {
    complete: vi.fn<Bridge["task"]["complete"]>(),
    cancel: vi.fn<Bridge["task"]["cancel"]>(),
  },
  attachments: { resolve: vi.fn<Bridge["attachments"]["resolve"]>() },
  images: { openViewer: vi.fn<Bridge["images"]["openViewer"]>() },
};
const task: InviteHistoryTask = {
  taskId: "history-a",
  type: "invite-history",
  sessionEpoch: 1,
  conversationId: 42,
  selectedMessageIds: [1, 999],
  defaultSelectAll: false,
};

/** 创建完整普通消息，组件测试保留真实 MessageView 与 Ant Design 控件。 */
function message(id: number): Message {
  return {
    schemaVersion: 1,
    id,
    clientId: `message-${id}`,
    conversationId: 42,
    senderId: id,
    senderName: `成员${id}`,
    senderAvatar: "成",
    kind: "user",
    parts: [{ type: "text", text: `历史正文 ${id}` }],
    summary: `历史正文 ${id}`,
    version: 1,
    createdAt: "2026-10-24T10:20:00Z",
    updatedAt: "2026-10-24T10:20:00Z",
    deletedAt: null,
  };
}

/** 控制桥接请求完成顺序，确定性覆盖加载和任务切换的竞态。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("附带历史记录窗口", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("auxiliary", bridge);
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    bridge.messages.getRecent.mockResolvedValue([message(1), message(2)]);
    bridge.task.complete.mockResolvedValue();
    bridge.task.cancel.mockResolvedValue();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  /** 同一挂载点更新任务，检验组件自身隔离而非依赖父级 key。 */
  async function render(currentTask = task) {
    await act(async () =>
      root.render(<InviteHistoryWindow task={currentTask} />),
    );
  }

  /** 按可见名称寻找真实按钮，兼容 Ant Design 的中文间距。 */
  function button(label: string): HTMLButtonElement {
    const result = [...host.querySelectorAll("button")].find(
      (item) => item.textContent?.replace(/\s/g, "") === label,
    );
    if (!result) throw new Error(`找不到按钮：${label}`);
    return result;
  }

  /** 通过消息对应的原生复选框读取或操作选择。 */
  function checkbox(id: number): HTMLInputElement {
    const result = host.querySelector<HTMLInputElement>(
      `#invite-history-message-${id}`,
    );
    if (!result) throw new Error(`找不到消息复选框：${id}`);
    return result;
  }

  /** 在 React 更新范围内操作真实控件。 */
  async function click(target: HTMLElement) {
    await act(async () => target.click());
  }

  it("过滤无效预选，支持逐条选择、取消选中和取消任务", async () => {
    await render();
    expect(bridge.messages.getRecent).toHaveBeenCalledExactlyOnceWith({
      taskId: task.taskId,
      conversationId: 42,
      limit: 30,
    });
    expect(host.querySelector("h1")?.textContent).toBe("附带聊天记录");
    expect(host.textContent).toContain("历史正文 1");
    expect(checkbox(1).checked).toBe(true);
    expect(checkbox(2).checked).toBe(false);
    await click(checkbox(1));
    expect(button("确定").disabled).toBe(true);
    await click(checkbox(2));
    expect(checkbox(2).closest("article")?.className).toContain("--selected");
    expect(host.querySelector("footer [role=status]")?.textContent).toBe(
      "已选择 1 条",
    );
    await click(button("取消选中"));
    expect(checkbox(2).checked).toBe(false);
    expect(button("确定").disabled).toBe(true);
    await click(button("取消"));
    expect(bridge.task.cancel).toHaveBeenCalledExactlyOnceWith(task.taskId);
    expect(bridge.task.complete).not.toHaveBeenCalled();
  });

  it("默认全选后只提交当前选中 ID，保持完成协议", async () => {
    await render({ ...task, defaultSelectAll: true });
    expect(checkbox(1).checked).toBe(true);
    expect(checkbox(2).checked).toBe(true);
    await click(checkbox(1));
    await click(button("确定"));
    expect(bridge.task.complete).toHaveBeenCalledExactlyOnceWith(task.taskId, {
      confirmed: true,
      selectedMessageIds: [2],
      selectedCount: 1,
    });
  });

  it("失败时禁确认，重试加载期间也不能提交，恢复后重新初始化选择", async () => {
    const retry = deferred<Message[]>();
    bridge.messages.getRecent
      .mockRejectedValueOnce(new Error("本地记录暂时不可用"))
      .mockReturnValueOnce(retry.promise);
    await render({ ...task, defaultSelectAll: true });
    expect(host.querySelector(".ant-alert")?.textContent).toContain(
      "本地记录暂时不可用",
    );
    expect(button("确定").disabled).toBe(true);
    await click(button("确定"));
    await click(button("重新读取"));
    expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(button("确定").disabled).toBe(true);
    await click(button("确定"));
    expect(bridge.task.complete).not.toHaveBeenCalled();
    await act(async () => retry.resolve([message(2)]));
    expect(host.querySelector(".ant-alert")).toBeNull();
    expect(checkbox(2).checked).toBe(true);
    expect(button("确定").disabled).toBe(false);
    expect(bridge.messages.getRecent).toHaveBeenCalledTimes(2);
  });

  it("切换任务立即清除旧选择，新任务加载或失败不能提交旧消息", async () => {
    await render();
    expect(button("确定").disabled).toBe(false);
    const next = deferred<Message[]>();
    bridge.messages.getRecent.mockReturnValueOnce(next.promise);
    await render({ ...task, taskId: "history-b" });
    expect(host.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
    expect(host.querySelector("footer [role=status]")?.textContent).toBe(
      "已选择 0 条",
    );
    expect(button("确定").disabled).toBe(true);
    await click(button("确定"));
    await act(async () => next.reject(new Error("新任务读取失败")));
    expect(button("确定").disabled).toBe(true);
    await click(button("确定"));
    expect(bridge.task.complete).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"])(
    "旧任务 %s 迟到不污染新任务的消息、选择或错误状态",
    async (outcome) => {
      const old = deferred<Message[]>();
      bridge.messages.getRecent
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce([message(2)]);
      await render();
      expect(button("确定").disabled).toBe(true);
      await render({
        ...task,
        taskId: "history-b",
        conversationId: 43,
        selectedMessageIds: [2],
      });
      await act(async () => {
        if (outcome === "success") old.resolve([message(1)]);
        else old.reject(new Error("旧任务失败"));
      });
      expect(host.textContent).not.toContain("历史正文 1");
      expect(host.textContent).not.toContain("旧任务失败");
      expect(checkbox(2).checked).toBe(true);
      expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe(
        "false",
      );
      await click(button("确定"));
      expect(bridge.task.complete).toHaveBeenCalledExactlyOnceWith(
        "history-b",
        {
          confirmed: true,
          selectedMessageIds: [2],
          selectedCount: 1,
        },
      );
    },
  );

  it("真实图片仍经当前任务解析与预览，点击附件不改变选择", async () => {
    const image: Message = {
      ...message(1),
      parts: [
        {
          type: "image",
          attachment: {
            id: 88,
            originalName: "设计稿.png",
            mimeType: "image/png",
            size: 128,
            url: "/attachments/88",
          },
          width: 200,
          height: 100,
        },
      ],
    };
    bridge.messages.getRecent.mockResolvedValueOnce([image]);
    bridge.attachments.resolve.mockResolvedValue({
      url: "chat-attachment://88",
    });
    await render({ ...task, selectedMessageIds: [] });
    expect(bridge.attachments.resolve).toHaveBeenCalledExactlyOnceWith({
      taskId: task.taskId,
      attachmentId: 88,
    });
    const preview =
      host.querySelector<HTMLImageElement>('img[alt="设计稿.png"]');
    expect(preview).not.toBeNull();
    await click(preview!);
    expect(bridge.images.openViewer).toHaveBeenCalledExactlyOnceWith({
      taskId: task.taskId,
      conversationId: 42,
      messageId: 1,
      attachmentId: 88,
    });
    expect(checkbox(1).checked).toBe(false);
    expect(bridge.task.complete).not.toHaveBeenCalled();
  });

  it("空记录明确说明系统通知不可附带且禁确认", async () => {
    bridge.messages.getRecent.mockResolvedValueOnce([]);
    await render({ ...task, defaultSelectAll: true });
    expect(host.textContent).toContain("当前群聊暂无可附带的普通消息");
    expect(host.textContent).toContain("系统通知不会作为聊天附录");
    expect(button("确定").disabled).toBe(true);
  });
});
