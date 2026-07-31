import {
  app,
  BrowserWindow,
  screen,
  type Rectangle,
  type WebContents,
} from "electron";
import crypto from "node:crypto";
import type {
  AuxiliaryTask,
  ChatHistoryTask,
  ForwardRecordTask,
  ImageGalleryItem,
  ImageViewerTask,
  InviteHistoryResult,
  InviteHistoryTask,
  OpenChatHistoryInput,
  OpenForwardRecordInput,
  OpenImageViewerInput,
  OpenInviteHistoryInput,
} from "@chat/shared";
import {
  clampWindowBounds,
  IMAGE_VIEWER_DEFAULT_SIZE,
  IMAGE_VIEWER_MINIMUM_SIZE,
  shouldRecycleAuxiliaryWindow,
} from "./auxiliary-window-policy";

export interface AuxiliaryAccountContext {
  serverId: string;
  companyId: number;
  userId: number;
}

export interface AuxiliaryImageResource {
  key: string;
  attachmentId?: number;
  draftId?: string;
  originalName: string;
  mimeType: string;
}

type ActiveTask = AuxiliaryTask & {
  account: AuxiliaryAccountContext;
  allowedMessageIds: Set<number>;
  allowedAttachmentIds: Set<number>;
  attachmentMimeTypes: Map<number, string>;
  imageResources: Map<string, AuxiliaryImageResource>;
};

interface WindowSlot {
  window: BrowserWindow;
  baseline: boolean;
  state: "warming" | "idle" | "busy" | "dead";
  reuseCount: number;
  task: ActiveTask | null;
  ready: Promise<void>;
  destroying: boolean;
  resetFailures: number;
  disabledParent: BrowserWindow | null;
  pendingResetTaskId?: string;
  resetTimer?: ReturnType<typeof setTimeout>;
  resolve?: (result: InviteHistoryResult) => void;
}

export interface AuxiliaryWindowPoolOptions {
  parent: BrowserWindow;
  preloadPath: string;
  url: string;
}

const canceledResult = (task?: ActiveTask | null): InviteHistoryResult => ({
  confirmed: false,
  selectedMessageIds: task?.type === "invite-history" ? task.selectedMessageIds : [],
  selectedCount: task?.type === "invite-history" ? task.selectedMessageIds.length : 0,
});

function commonTask(
  task: AuxiliaryTask,
  account: AuxiliaryAccountContext,
): ActiveTask {
  return Object.assign(task, {
    account: { ...account },
    allowedMessageIds: new Set<number>(),
    allowedAttachmentIds: new Set<number>(),
    attachmentMimeTypes: new Map<number, string>(),
    imageResources: new Map<string, AuxiliaryImageResource>(),
  });
}

export class AuxiliaryWindowPool {
  private readonly slots = new Set<WindowSlot>();
  private context: AuxiliaryAccountContext | null = null;
  private sessionEpoch = 0;
  private disposed = false;
  private imageBounds: Rectangle | null = null;
  private historyBounds: Rectangle | null = null;
  private forwardRecordBounds: Rectangle | null = null;

  constructor(private readonly options: AuxiliaryWindowPoolOptions) {}

  async activate(context: AuxiliaryAccountContext) {
    await this.reset();
    this.context = context;
    this.sessionEpoch += 1;
    await this.ensureBaseline();
  }

  async openInviteHistory(
    input: OpenInviteHistoryInput,
    owner = this.options.parent,
  ) {
    const context = this.requireContext();
    if (!Number.isSafeInteger(input.conversationId) || input.conversationId <= 0) {
      throw new Error("会话编号无效");
    }
    const slot = await this.availableSlot();
    const task = commonTask({
      taskId: crypto.randomUUID(),
      type: "invite-history",
      sessionEpoch: this.sessionEpoch,
      conversationId: Number(input.conversationId),
      selectedMessageIds: [...new Set(input.selectedMessageIds.map(Number))],
      defaultSelectAll: Boolean(input.defaultSelectAll),
    } satisfies InviteHistoryTask, context);
    slot.task = task;
    slot.state = "busy";
    const result = new Promise<InviteHistoryResult>((resolve) => {
      slot.resolve = resolve;
    });
    this.prepareInviteWindow(slot, owner);
    slot.window.webContents.send("auxiliary:task-ready");
    slot.window.show();
    slot.window.focus();
    return result;
  }

  async openImageViewer(input: OpenImageViewerInput) {
    const context = this.requireContext();
    if (!Number.isSafeInteger(input.conversationId) || input.conversationId <= 0) {
      throw new Error("会话编号无效");
    }
    const attachmentId = Number(input.attachmentId);
    const draftId = String(input.draftId || "");
    if (
      !(Number.isSafeInteger(attachmentId) && attachmentId > 0)
      && !/^[0-9a-f-]{36}$/i.test(draftId)
    ) {
      throw new Error("图片编号无效");
    }
    const active = [...this.slots].find((candidate) =>
      candidate.state === "busy" && candidate.task?.type === "image-viewer");
    const task = commonTask({
      taskId: crypto.randomUUID(),
      type: "image-viewer",
      sessionEpoch: this.sessionEpoch,
      conversationId: Number(input.conversationId),
      initialMessageId: Number(input.messageId) || undefined,
      initialAttachmentId: Number.isSafeInteger(attachmentId) && attachmentId > 0
        ? attachmentId
        : undefined,
      initialDraftId: draftId || undefined,
    } satisfies ImageViewerTask, context);

    if (active) {
      active.task = task;
      active.window.webContents.send("auxiliary:task-updated");
      active.window.show();
      active.window.focus();
      return;
    }

    const slot = await this.availableSlot();
    slot.task = task;
    slot.state = "busy";
    this.prepareImageWindow(slot);
    slot.window.webContents.send("auxiliary:task-ready");
    slot.window.show();
    slot.window.focus();
  }

  async openChatHistory(input: OpenChatHistoryInput) {
    const context = this.requireContext();
    if (!Number.isSafeInteger(input.conversationId) || input.conversationId <= 0) {
      throw new Error("会话编号无效");
    }
    const active = [...this.slots].find((candidate) =>
      candidate.state === "busy" && candidate.task?.type === "chat-history");
    const task = commonTask({
      taskId: crypto.randomUUID(),
      type: "chat-history",
      sessionEpoch: this.sessionEpoch,
      conversationId: Number(input.conversationId),
    } satisfies ChatHistoryTask, context);

    if (active) {
      active.task = task;
      active.window.webContents.send("auxiliary:task-updated");
      active.window.show();
      active.window.focus();
      return;
    }

    const slot = await this.availableSlot();
    slot.task = task;
    slot.state = "busy";
    this.prepareHistoryWindow(slot);
    slot.window.webContents.send("auxiliary:task-ready");
    slot.window.show();
    slot.window.focus();
  }

  async openForwardRecord(input: OpenForwardRecordInput) {
    const context = this.requireContext();
    if (
      !Number.isSafeInteger(input.conversationId)
      || input.conversationId <= 0
      || !Number.isSafeInteger(input.messageId)
      || input.messageId <= 0
    ) {
      throw new Error("聊天记录消息编号无效");
    }
    const active = [...this.slots].find((candidate) =>
      candidate.state === "busy" && candidate.task?.type === "forward-record");
    const task = commonTask({
      taskId: crypto.randomUUID(),
      type: "forward-record",
      sessionEpoch: this.sessionEpoch,
      conversationId: Number(input.conversationId),
      messageId: Number(input.messageId),
    } satisfies ForwardRecordTask, context);
    if (active) {
      active.task = task;
      this.prepareForwardRecordWindow(active);
      active.window.webContents.send("auxiliary:task-updated");
      active.window.show();
      active.window.focus();
      return;
    }
    const slot = await this.availableSlot();
    slot.task = task;
    slot.state = "busy";
    this.prepareForwardRecordWindow(slot);
    slot.window.webContents.send("auxiliary:task-ready");
    slot.window.show();
    slot.window.focus();
  }

  taskFor(sender: WebContents, taskId?: string) {
    const slot = [...this.slots].find((candidate) =>
      candidate.window.webContents.id === sender.id
      && candidate.state === "busy"
      && candidate.task);
    if (!slot?.task) throw new Error("辅助窗口任务不存在或已失效");
    if (taskId && slot.task.taskId !== taskId) throw new Error("辅助窗口任务编号无效");
    if (slot.task.sessionEpoch !== this.sessionEpoch) throw new Error("辅助窗口会话已失效");
    if (
      !this.context
      || slot.task.account.serverId !== this.context.serverId
      || slot.task.account.companyId !== this.context.companyId
      || slot.task.account.userId !== this.context.userId
    ) {
      throw new Error("辅助窗口账号上下文已失效");
    }
    return slot.task;
  }

  allowAttachments(
    sender: WebContents,
    taskId: string,
    messageIds: number[],
    attachments: Array<{ id: number; mimeType: string }>,
  ) {
    const task = this.taskFor(sender, taskId);
    if (
      task.type !== "invite-history"
      && task.type !== "chat-history"
      && task.type !== "forward-record"
    ) {
      throw new Error("辅助窗口任务类型不正确");
    }
    const persistentAllowList = task.type === "chat-history" || task.type === "forward-record";
    const existingMessageIds = persistentAllowList
      ? [...task.allowedMessageIds]
      : [];
    const existingAttachmentIds = persistentAllowList
      ? [...task.allowedAttachmentIds]
      : [];
    const existingMimeTypes = persistentAllowList
      ? [...task.attachmentMimeTypes]
      : [];
    task.allowedMessageIds = new Set([
      ...existingMessageIds,
      ...messageIds.filter((id) => Number.isSafeInteger(id) && id > 0),
    ]);
    task.allowedAttachmentIds = new Set([
      ...existingAttachmentIds,
      ...attachments.map((item) => item.id)
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    ]);
    task.attachmentMimeTypes = new Map([
      ...existingMimeTypes,
      ...attachments.map((item) =>
        [item.id, item.mimeType || "application/octet-stream"] as const),
    ]);
  }

  allowImageItems(sender: WebContents, taskId: string, items: ImageGalleryItem[]) {
    const task = this.taskFor(sender, taskId);
    if (task.type !== "image-viewer") throw new Error("辅助窗口任务类型不正确");
    for (const item of items) {
      if (item.conversationId !== task.conversationId) continue;
      const attachmentId = Number(item.attachmentId);
      const draftId = String(item.draftId || "");
      if (
        !(Number.isSafeInteger(attachmentId) && attachmentId > 0)
        && !/^[0-9a-f-]{36}$/i.test(draftId)
      ) {
        continue;
      }
      task.imageResources.set(item.key, {
        key: item.key,
        attachmentId: Number.isSafeInteger(attachmentId) && attachmentId > 0
          ? attachmentId
          : undefined,
        draftId: draftId || undefined,
        originalName: item.originalName,
        mimeType: item.mimeType || "application/octet-stream",
      });
    }
  }

  attachmentTask(taskId: string, attachmentId: number) {
    const slot = [...this.slots].find((candidate) =>
      candidate.task?.taskId === taskId && candidate.state === "busy");
    if (
      !slot?.task
      || slot.task.sessionEpoch !== this.sessionEpoch
      || !slot.task.allowedAttachmentIds.has(attachmentId)
    ) {
      throw new Error("附件不属于当前辅助窗口任务");
    }
    return slot.task;
  }

  imageResource(taskId: string, imageKey: string) {
    const slot = [...this.slots].find((candidate) =>
      candidate.task?.taskId === taskId
      && candidate.task.type === "image-viewer"
      && candidate.state === "busy");
    const resource = slot?.task?.imageResources.get(imageKey);
    if (
      !slot?.task
      || slot.task.sessionEpoch !== this.sessionEpoch
      || !resource
    ) {
      throw new Error("图片不属于当前查看任务");
    }
    return resource;
  }

  complete(sender: WebContents, taskId: string, result: InviteHistoryResult) {
    const slot = this.slotForTask(sender, taskId);
    if (slot.task?.type !== "invite-history") throw new Error("辅助窗口任务类型不正确");
    const allowedMessageIds = slot.task.allowedMessageIds;
    const selectedMessageIds = [...new Set(result.selectedMessageIds.map(Number))]
      .filter((id) => Number.isSafeInteger(id) && allowedMessageIds.has(id))
      .slice(0, 30);
    this.release(slot, {
      confirmed: true,
      selectedMessageIds,
      selectedCount: selectedMessageIds.length,
    });
  }

  cancel(sender: WebContents, taskId: string) {
    const slot = this.slotForTask(sender, taskId);
    this.release(
      slot,
      slot.task?.type === "invite-history" ? canceledResult(slot.task) : undefined,
    );
  }

  async reset() {
    this.sessionEpoch += 1;
    this.context = null;
    for (const slot of [...this.slots]) {
      this.destroySlot(
        slot,
        slot.task?.type === "invite-history" ? canceledResult(slot.task) : undefined,
      );
    }
    await Promise.resolve();
  }

  async dispose() {
    this.disposed = true;
    await this.reset();
    this.context = null;
  }

  private requireContext() {
    if (!this.context) throw new Error("本地账号数据尚未打开");
    return this.context;
  }

  private async availableSlot() {
    const slot = this.idleSlot() ?? this.createSlot(false);
    await slot.ready;
    if (slot.state === "dead") throw new Error("辅助窗口启动失败");
    return slot;
  }

  private slotForTask(sender: WebContents, taskId: string) {
    const slot = [...this.slots].find((candidate) =>
      candidate.window.webContents.id === sender.id
      && candidate.task?.taskId === taskId
      && candidate.state === "busy");
    if (!slot) throw new Error("辅助窗口任务不存在或已失效");
    return slot;
  }

  private idleSlot() {
    return [...this.slots].find((slot) => slot.state === "idle");
  }

  private async ensureBaseline() {
    if (this.disposed || !this.context) return;
    if ([...this.slots].some((slot) => slot.baseline && slot.state !== "dead")) return;
    const slot = this.createSlot(true);
    await slot.ready.catch(() => undefined);
  }

  private createSlot(baseline: boolean) {
    let readyResolve!: () => void;
    let readyReject!: (reason: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const window = new BrowserWindow({
      show: false,
      width: 660,
      height: 620,
      minWidth: 320,
      minHeight: 240,
      autoHideMenuBar: true,
      backgroundColor: "#ffffff",
      hasShadow: true,
      webPreferences: {
        preload: this.options.preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: true,
      },
    });
    const slot: WindowSlot = {
      window,
      baseline,
      state: "warming",
      reuseCount: 0,
      task: null,
      ready,
      destroying: false,
      resetFailures: 0,
      disabledParent: null,
    };
    this.slots.add(slot);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, target) => {
      if (!target.startsWith(this.options.url.split("?")[0])) event.preventDefault();
    });
    window.webContents.once("did-finish-load", () => {
      if (slot.state === "dead") return;
      slot.state = "idle";
      readyResolve();
    });
    window.webContents.once("did-fail-load", (_event, _code, description) => {
      readyReject(new Error(description));
      this.destroySlot(slot, slot.task?.type === "invite-history"
        ? canceledResult(slot.task)
        : undefined);
    });
    window.webContents.on("render-process-gone", () => {
      this.destroySlot(slot, slot.task?.type === "invite-history"
        ? canceledResult(slot.task)
        : undefined);
    });
    window.on("unresponsive", () => {
      this.destroySlot(slot, slot.task?.type === "invite-history"
        ? canceledResult(slot.task)
        : undefined);
    });
    window.on("close", (event) => {
      if (slot.destroying) return;
      event.preventDefault();
      if (slot.state === "busy") {
        this.release(
          slot,
          slot.task?.type === "invite-history" ? canceledResult(slot.task) : undefined,
        );
      } else {
        window.hide();
      }
    });
    void window.loadURL(this.options.url);
    return slot;
  }

  private prepareInviteWindow(slot: WindowSlot, owner: BrowserWindow) {
    this.restoreParent(slot, false);
    slot.window.setParentWindow(owner);
    slot.disabledParent = owner;
    if (!owner.isDestroyed()) owner.setEnabled(false);
    slot.window.setTitle("选择附带的聊天记录");
    slot.window.setMinimumSize(560, 480);
    slot.window.setSize(660, 620);
    slot.window.center();
  }

  private prepareImageWindow(slot: WindowSlot) {
    this.restoreParent(slot, false);
    slot.window.setParentWindow(null);
    slot.window.setTitle("图片");
    slot.window.setMinimumSize(
      IMAGE_VIEWER_MINIMUM_SIZE.width,
      IMAGE_VIEWER_MINIMUM_SIZE.height,
    );
    if (this.imageBounds) {
      slot.window.setBounds(this.visibleImageBounds(this.imageBounds));
    } else {
      slot.window.setSize(
        IMAGE_VIEWER_DEFAULT_SIZE.width,
        IMAGE_VIEWER_DEFAULT_SIZE.height,
      );
      slot.window.center();
    }
  }

  private prepareHistoryWindow(slot: WindowSlot) {
    this.restoreParent(slot, false);
    slot.window.setParentWindow(null);
    slot.window.setTitle("聊天记录");
    slot.window.setMinimumSize(680, 480);
    if (this.historyBounds) {
      slot.window.setBounds(this.visibleImageBounds(this.historyBounds));
    } else {
      slot.window.setSize(860, 640);
      slot.window.center();
    }
  }

  private prepareForwardRecordWindow(slot: WindowSlot) {
    this.restoreParent(slot, false);
    slot.window.setParentWindow(null);
    slot.window.setTitle("聊天记录");
    slot.window.setMinimumSize(520, 420);
    if (this.forwardRecordBounds) {
      slot.window.setBounds(this.visibleImageBounds(this.forwardRecordBounds));
    } else {
      slot.window.setSize(680, 620);
      slot.window.center();
    }
  }

  private visibleImageBounds(bounds: Rectangle) {
    const display = screen.getDisplayMatching(bounds);
    const area = display.workArea;
    return clampWindowBounds(bounds, area);
  }

  private restoreParent(slot: WindowSlot, focus = true) {
    const parent = slot.disabledParent;
    slot.disabledParent = null;
    if (parent && !parent.isDestroyed()) {
      parent.setEnabled(true);
      if (focus) parent.focus();
    }
  }

  private release(slot: WindowSlot, result?: InviteHistoryResult) {
    if (slot.state !== "busy" || !slot.task) return;
    const task = slot.task;
    const taskId = task.taskId;
    if (task.type === "image-viewer" && !slot.window.isDestroyed()) {
      this.imageBounds = slot.window.getBounds();
    }
    if (
      task.type === "chat-history"
      && !slot.window.isDestroyed()
    ) {
      this.historyBounds = slot.window.getBounds();
    }
    if (task.type === "forward-record" && !slot.window.isDestroyed()) {
      this.forwardRecordBounds = slot.window.getBounds();
    }
    const resolve = slot.resolve;
    slot.resolve = undefined;
    slot.task = null;
    slot.reuseCount += 1;
    slot.window.hide();
    slot.window.setParentWindow(null);
    this.restoreParent(slot);
    if (task.type === "invite-history") resolve?.(result ?? canceledResult(task));
    if (!slot.baseline) {
      this.destroySlot(slot);
      void this.ensureBaseline();
      return;
    }
    slot.state = "warming";
    slot.pendingResetTaskId = taskId;
    slot.window.webContents.send("auxiliary:task-reset", taskId);
    slot.resetTimer = setTimeout(() => {
      slot.resetTimer = undefined;
      slot.resetFailures += 1;
      slot.pendingResetTaskId = undefined;
      if (slot.resetFailures >= 2) {
        this.destroySlot(slot);
        void this.ensureBaseline();
      } else if (slot.state !== "dead") {
        slot.state = "idle";
      }
    }, 1_500);
  }

  resetComplete(sender: WebContents, taskId: string) {
    const slot = [...this.slots].find((candidate) =>
      candidate.window.webContents.id === sender.id
      && candidate.state === "warming"
      && candidate.pendingResetTaskId === taskId);
    if (!slot || !taskId) return;
    if (slot.resetTimer) clearTimeout(slot.resetTimer);
    slot.resetTimer = undefined;
    slot.resetFailures = 0;
    slot.pendingResetTaskId = undefined;
    if (shouldRecycleAuxiliaryWindow({
      baseline: slot.baseline,
      reuseCount: slot.reuseCount,
      privateBytesKb: this.privateMemoryKb(slot),
    })) {
      this.destroySlot(slot);
      void this.ensureBaseline();
      return;
    }
    slot.state = "idle";
  }

  private privateMemoryKb(slot: WindowSlot) {
    const pid = slot.window.webContents.getOSProcessId();
    const metric = app.getAppMetrics().find((item) => item.pid === pid);
    return Number(metric?.memory?.privateBytes || 0);
  }

  private destroySlot(slot: WindowSlot, result?: InviteHistoryResult) {
    if (slot.state === "dead") return;
    slot.state = "dead";
    slot.destroying = true;
    if (slot.resetTimer) clearTimeout(slot.resetTimer);
    slot.pendingResetTaskId = undefined;
    this.restoreParent(slot, false);
    this.slots.delete(slot);
    const resolve = slot.resolve;
    const task = slot.task;
    slot.resolve = undefined;
    slot.task = null;
    if (task?.type === "invite-history") resolve?.(result ?? canceledResult(task));
    if (!slot.window.isDestroyed()) slot.window.destroy();
    if (slot.baseline && !this.disposed && this.context) {
      queueMicrotask(() => void this.ensureBaseline());
    }
  }
}
