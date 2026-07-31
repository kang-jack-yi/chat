import { BrowserWindow, type WebContents } from "electron";
import type { AuxiliaryAccountContext } from "./auxiliary-window-pool";

export interface DocumentWindowContext {
  documentId: number;
  serverUrl: string;
  accessToken: string;
  account: AuxiliaryAccountContext;
}

interface DocumentWindowManagerOptions {
  developmentUrl?: string;
  preloadPath: string;
  getContext: () => Promise<{
    serverUrl: string;
    accessToken: string | null;
    account: AuxiliaryAccountContext | null;
  }>;
}

export class DocumentWindowManager {
  private readonly windows = new Map<number, BrowserWindow>();
  private readonly documentByWebContents = new Map<number, number>();
  private readonly closeTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly closingDocuments = new Set<number>();

  constructor(private readonly options: DocumentWindowManagerOptions) {}

  async open(documentId: number) {
    if (!Number.isSafeInteger(documentId) || documentId <= 0) {
      throw new Error("文档编号无效");
    }
    const existing = this.windows.get(documentId);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return;
    }
    const context = await this.options.getContext();
    if (!context.account || !context.accessToken || !context.serverUrl) {
      throw new Error("请先登录后再打开云文档");
    }
    const window = new BrowserWindow({
      width: 1200,
      height: 820,
      minWidth: 900,
      minHeight: 640,
      show: false,
      title: "云文档",
      backgroundColor: "#f3f6fa",
      webPreferences: {
        preload: this.options.preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    const webContentsId = window.webContents.id;
    this.windows.set(documentId, window);
    this.documentByWebContents.set(webContentsId, documentId);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      const allowed = this.options.developmentUrl
        ? url.startsWith(this.options.developmentUrl)
        : url.startsWith("chat://app");
      if (!allowed) event.preventDefault();
    });
    window.once("ready-to-show", () => window.show());
    window.on("close", (event) => {
      if (this.closingDocuments.has(documentId)) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      this.closingDocuments.add(documentId);
      if (!window.webContents.isDestroyed()) {
        window.webContents.send("document:before-close");
      }
      const timer = setTimeout(() => this.finishClose(documentId, window), 1_500);
      this.closeTimers.set(documentId, timer);
    });
    window.on("closed", () => {
      this.windows.delete(documentId);
      this.documentByWebContents.delete(webContentsId);
      this.closingDocuments.delete(documentId);
      const timer = this.closeTimers.get(documentId);
      if (timer) clearTimeout(timer);
      this.closeTimers.delete(documentId);
    });
    const query = `documentId=${documentId}`;
    if (this.options.developmentUrl) {
      await window.loadURL(`${this.options.developmentUrl}/document.html?${query}`);
    } else {
      await window.loadURL(`chat://app/document.html?${query}`);
    }
  }

  async contextFor(sender: WebContents): Promise<DocumentWindowContext> {
    const documentId = this.documentByWebContents.get(sender.id);
    if (!documentId) throw new Error("不允许的窗口调用");
    const context = await this.options.getContext();
    if (!context.account || !context.accessToken || !context.serverUrl) {
      throw new Error("登录状态已失效");
    }
    return {
      documentId,
      serverUrl: context.serverUrl,
      accessToken: context.accessToken,
      account: context.account,
    };
  }

  readyToClose(sender: WebContents) {
    const documentId = this.documentByWebContents.get(sender.id);
    if (!documentId || !this.closingDocuments.has(documentId)) return false;
    const window = this.windows.get(documentId);
    if (!window || window.isDestroyed()) return false;
    setTimeout(() => {
      if (this.windows.get(documentId) === window) {
        this.finishClose(documentId, window);
      }
    }, 0);
    return true;
  }

  sendAccessToken(accessToken: string) {
    for (const window of this.windows.values()) {
      if (!window.isDestroyed()) {
        window.webContents.send("document:token-updated", accessToken);
      }
    }
  }

  closeAll() {
    for (const timer of this.closeTimers.values()) clearTimeout(timer);
    this.closeTimers.clear();
    for (const [documentId, window] of this.windows) {
      this.closingDocuments.add(documentId);
      if (!window.isDestroyed()) window.destroy();
    }
    this.closingDocuments.clear();
    this.windows.clear();
    this.documentByWebContents.clear();
  }

  private finishClose(documentId: number, window: BrowserWindow) {
    const timer = this.closeTimers.get(documentId);
    if (timer) clearTimeout(timer);
    this.closeTimers.delete(documentId);
    if (!window.isDestroyed()) window.destroy();
  }
}
