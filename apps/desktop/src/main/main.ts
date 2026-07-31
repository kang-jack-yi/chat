import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  nativeImage,
  protocol,
  session,
  shell,
  Tray,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";
import type {
  ChatHistoryMetadata,
  Conversation,
  ImageGalleryItem,
  ImageGalleryPage,
  InviteHistoryResult,
  Message,
  MessageHistoryPage,
  MessageHistoryQuery,
  OpenChatHistoryInput,
  OpenForwardRecordInput,
  OpenImageViewerInput,
  OpenInviteHistoryInput,
  ServerConfig,
  ServerHealth,
  SyncStatus,
} from "@chat/shared";
import {
  AuxiliaryWindowPool,
  type AuxiliaryAccountContext,
} from "./auxiliary-window-pool";
import { DocumentWindowManager } from "./document-window-manager";

declare const __DESKTOP_DEFAULT_SERVER_URL__: string;

app.setName("EnterpriseChat");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "chat",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      codeCache: true,
    },
  },
]);

const developmentUrl = process.env.VITE_DEV_SERVER_URL;
const MAIN_WINDOW_MIN_WIDTH = 1024;
const MAIN_WINDOW_MIN_HEIGHT = 680;
const defaultServerUrl =
  __DESKTOP_DEFAULT_SERVER_URL__ || (developmentUrl ? "http://127.0.0.1:7001" : "");
const imPluginMethods = new Set([
  "applyBootstrap",
  "applyEvents",
  "upsertMessages",
  "listConversations",
  "upsertConversations",
  "replaceConversations",
  "getMessages",
  "getRecentUserMessages",
  "clearConversationMessages",
  "searchMessages",
  "queryMessageHistory",
  "getMessageContext",
  "getMessage",
  "queryImageGallery",
  "enqueueMessage",
  "markMessage",
  "getOutbox",
  "hasPendingConversation",
  "cancelQueuedMessage",
  "removeMessagesForMe",
  "setSyncState",
  "getSyncState",
  "setAttachmentCachePath",
]);

let mainWindow: BrowserWindow | null = null;
let auxiliaryWindowPool: AuxiliaryWindowPool | null = null;
let documentWindowManager: DocumentWindowManager | null = null;
let tray: Tray | null = null;
let quitting = false;
let activeAccount: AuxiliaryAccountContext | null = null;
let hostAccessToken: string | null = null;
let syncStatus: SyncStatus = {
  cursor: 0,
  minimumCursor: 0,
  maximumCursor: 0,
  historyComplete: false,
  phase: "idle",
};

type StoredSettings = {
  server?: ServerConfig;
  window?: { width: number; height: number; x?: number; y?: number; maximized?: boolean };
};

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

async function readSettings(): Promise<StoredSettings> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), "utf8"));
  } catch {
    return {};
  }
}

async function writeSettings(settings: StoredSettings) {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  const target = settingsPath();
  const temporary = `${target}.${process.pid}.tmp`;
  const backup = `${target}.${process.pid}.bak`;
  await fs.writeFile(temporary, JSON.stringify(settings, null, 2), "utf8");
  try {
    await fs.rename(target, backup).catch((error: any) => {
      if (error?.code !== "ENOENT") throw error;
    });
    await fs.rename(temporary, target);
    await fs.rm(backup, { force: true });
  } catch (error) {
    await fs.rm(temporary, { force: true });
    if (await fs.stat(backup).then(() => true).catch(() => false)) {
      await fs.rename(backup, target).catch(() => undefined);
    }
    throw error;
  }
}

function normalizeServerUrl(rawValue: string) {
  const value = String(rawValue || "").trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("服务地址格式不正确");
  }
  const loopback = ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !(developmentUrl && loopback && url.protocol === "http:")) {
    throw new Error("正式客户端只允许使用 HTTPS 服务地址");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("服务地址不能包含账号、查询参数或锚点");
  }
  return url.origin;
}

function compareVersions(left: string, right: string) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

async function checkServer(rawUrl: string): Promise<{ config: ServerConfig; health: ServerHealth }> {
  const url = normalizeServerUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await net.fetch(`${url}/api/health`, {
      signal: controller.signal,
      headers: { "X-Desktop-Version": app.getVersion() },
    });
    if (!response.ok) throw new Error(`服务器返回 ${response.status}`);
    const payload = await response.json() as { success?: boolean; data?: ServerHealth };
    const health = payload.data;
    if (!payload.success || !health || health.serviceId !== "enterprise-chat") {
      throw new Error("该地址不是企业协作服务");
    }
    if (health.apiVersion !== "1") throw new Error(`不支持服务器 API v${health.apiVersion}`);
    if (compareVersions(app.getVersion(), health.minDesktopVersion) < 0) {
      throw new Error(`客户端版本过低，请升级至 ${health.minDesktopVersion} 或更高版本`);
    }
    return {
      health,
      config: {
        url,
        serverId: health.serverId,
        name: health.name,
        apiVersion: health.apiVersion,
        socketPath: health.socketPath,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("连接服务器超时");
    if (error instanceof TypeError) {
      const detail = `${error.message} ${(error as any).cause?.message || ""}`.toLowerCase();
      if (detail.includes("certificate") || detail.includes("cert_")) {
        throw new Error("HTTPS 证书校验失败");
      }
      if (detail.includes("enotfound") || detail.includes("name_not_resolved")) {
        throw new Error("DNS 解析失败，请检查服务地址");
      }
      throw new Error("无法连接服务器，请检查网络和服务地址");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

class ImPluginClient {
  private child: UtilityProcess | null = null;
  private pending = new Map<string, { resolve(value: any): void; reject(error: Error): void }>();
  private accountDirectory = "";
  private cacheDirectory = "";
  private draftDirectory = "";
  private drafts = new Map<string, { path: string; name: string; mimeType: string; size: number }>();

  private start() {
    if (this.child) return;
    const workerPath = path.join(__dirname, "im-plugin-worker.cjs");
    this.child = utilityProcess.fork(workerPath, [], {
      serviceName: "Enterprise Chat IM Plugin",
      stdio: "pipe",
    });
    this.child.on("message", ({ id, result, error }: any) => {
      const request = this.pending.get(id);
      if (!request) return;
      this.pending.delete(id);
      if (error) request.reject(new Error(error));
      else request.resolve(result);
    });
    this.child.on("exit", () => {
      const error = new Error("本地数据库进程已退出");
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
      this.child = null;
    });
  }

  call<T = any>(method: string, args?: unknown): Promise<T> {
    this.start();
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.postMessage({ id, method, args });
    });
  }

  async open(input: { serverId: string; companyId: number; userId: number }) {
    const safeServer = input.serverId.replace(/[^a-zA-Z0-9-]/g, "_");
    this.accountDirectory = path.join(
      app.getPath("userData"),
      "data",
      safeServer,
      String(input.companyId),
      String(input.userId),
    );
    this.cacheDirectory = path.join(
      app.getPath("userData"),
      "cache",
      safeServer,
      String(input.companyId),
      String(input.userId),
    );
    this.draftDirectory = path.join(this.cacheDirectory, "drafts");
    await fs.mkdir(this.cacheDirectory, { recursive: true });
    await fs.mkdir(this.draftDirectory, { recursive: true });
    return this.call("open", {
      filePath: path.join(this.accountDirectory, "chat.db"),
      cacheDirectory: this.cacheDirectory,
      meta: input,
    });
  }

  async close() {
    if (!this.child) return;
    try {
      await this.call("close");
    } finally {
      this.child?.kill();
      this.child = null;
      this.accountDirectory = "";
      this.cacheDirectory = "";
      this.draftDirectory = "";
      this.drafts.clear();
    }
  }

  async stageAttachment(input: { name: string; mimeType: string; size: number; data: Uint8Array }) {
    if (!this.draftDirectory) throw new Error("本地附件缓存尚未打开");
    const id = crypto.randomUUID();
    const extension = path.extname(path.basename(input.name)).slice(0, 12);
    const target = path.join(this.draftDirectory, `${id}${extension}`);
    const data = Buffer.from(input.data);
    if (data.byteLength !== Number(input.size)) throw new Error("附件数据大小不一致");
    await fs.writeFile(target, data);
    this.drafts.set(id, {
      path: target,
      name: path.basename(input.name),
      mimeType: input.mimeType || "application/octet-stream",
      size: data.byteLength,
    });
    return {
      id,
      name: path.basename(input.name),
      mimeType: input.mimeType || "application/octet-stream",
      size: data.byteLength,
      image: String(input.mimeType || "").startsWith("image/"),
      previewUrl: `chat://attachment/draft/${id}`,
    };
  }

  async removeDraftAttachment(id: string) {
    const draft = this.drafts.get(id);
    if (!draft) return false;
    this.drafts.delete(id);
    await fs.rm(draft.path, { force: true });
    return true;
  }

  draftAttachment(id: string) {
    return this.drafts.get(id) || null;
  }

  private async attachmentPath(input: { attachmentId?: number; draftId?: string }) {
    if (input.draftId) {
      if (!/^[0-9a-f-]{36}$/i.test(input.draftId)) throw new Error("草稿附件编号无效");
      const draft = this.drafts.get(input.draftId);
      if (!draft) throw new Error("草稿附件不存在");
      return draft.path;
    }
    if (!input.attachmentId) throw new Error("附件编号无效");
    const target = this.cachePath(input.attachmentId);
    await fs.access(target);
    return target;
  }

  async openAttachment(input: { attachmentId?: number; draftId?: string }) {
    const target = await this.attachmentPath(input);
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return true;
  }

  async saveAttachment(input: {
    attachmentId?: number;
    draftId?: string;
    name: string;
  }, owner?: BrowserWindow | null) {
    const source = await this.attachmentPath(input);
    const options = { defaultPath: path.basename(input.name) };
    const targetWindow = owner && !owner.isDestroyed() ? owner : mainWindow;
    const result = targetWindow
      ? await dialog.showSaveDialog(targetWindow, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    await fs.copyFile(source, result.filePath);
    return true;
  }

  async showAttachment(input: { attachmentId?: number; draftId?: string }) {
    const target = await this.attachmentPath(input);
    shell.showItemInFolder(target);
    return true;
  }

  async clear() {
    const dataTarget = this.accountDirectory;
    const cacheTarget = this.cacheDirectory;
    await this.close();
    for (const [rootName, target] of [["data", dataTarget], ["cache", cacheTarget]] as const) {
      if (!target) continue;
      const root = path.resolve(app.getPath("userData"), rootName);
      const resolved = path.resolve(target);
      if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error("本地数据目录不安全，已取消删除");
      }
      await fs.rm(resolved, { recursive: true, force: true });
    }
    return true;
  }

  private cachePath(attachmentId: number) {
    if (!this.cacheDirectory) throw new Error("本地缓存尚未打开");
    if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) throw new Error("附件编号无效");
    return path.join(this.cacheDirectory, `${attachmentId}.bin`);
  }

  async readAttachment(attachmentId: number) {
    const target = this.cachePath(attachmentId);
    try {
      const data = await fs.readFile(target);
      const now = new Date();
      await fs.utimes(target, now, now).catch(() => undefined);
      await this.call("setAttachmentCachePath", {
        attachmentId,
        localCachePath: target,
      }).catch(() => undefined);
      return new Uint8Array(data);
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async writeAttachment(input: { attachmentId: number; data: Uint8Array }) {
    const target = this.cachePath(input.attachmentId);
    await fs.mkdir(this.cacheDirectory, { recursive: true });
    await fs.writeFile(target, Buffer.from(input.data));
    await this.call("setAttachmentCachePath", {
      attachmentId: input.attachmentId,
      localCachePath: target,
    });
    await this.enforceCacheLimit();
    return true;
  }

  private async enforceCacheLimit() {
    const maximumBytes = 2 * 1024 * 1024 * 1024;
    const entries = await fs.readdir(this.cacheDirectory, { withFileTypes: true });
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".bin"))
      .map(async (entry) => {
        const filePath = path.join(this.cacheDirectory, entry.name);
        const stat = await fs.stat(filePath);
        return { filePath, size: stat.size, lastAccessed: stat.mtimeMs };
      }));
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort((left, right) => left.lastAccessed - right.lastAccessed)) {
      if (total <= maximumBytes) break;
      await fs.rm(file.filePath, { force: true });
      total -= file.size;
    }
  }
}

const imPlugin = new ImPluginClient();

async function refreshHostAccessToken() {
  const server = (await readSettings()).server;
  if (!server) throw new Error("服务器尚未配置");
  const response = await net.fetch(`${server.url}/api/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const payload = await response.json() as {
    success?: boolean;
    data?: { accessToken?: string };
  };
  const accessToken = payload.data?.accessToken;
  if (!response.ok || !payload.success || !accessToken) {
    hostAccessToken = null;
    mainWindow?.webContents.send("auth:required");
    throw new Error("登录已失效");
  }
  hostAccessToken = accessToken;
  mainWindow?.webContents.send("auth:token-updated", accessToken);
  documentWindowManager?.sendAccessToken(accessToken);
  return accessToken;
}

async function downloadAttachmentToCache(attachmentId: number) {
  const cached = await imPlugin.readAttachment(attachmentId);
  if (cached) return cached;
  const server = (await readSettings()).server;
  if (!server) throw new Error("服务器尚未配置");
  let token = hostAccessToken || await refreshHostAccessToken();
  const request = () => net.fetch(`${server.url}/api/files/${attachmentId}`, {
    credentials: "include",
    headers: { Authorization: `Bearer ${token}` },
  });
  let response = await request();
  if (response.status === 401) {
    token = await refreshHostAccessToken();
    response = await request();
  }
  if (!response.ok) throw new Error(`附件下载失败（${response.status}）`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > 50 * 1024 * 1024) throw new Error("附件超过本地预览限制");
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength > 50 * 1024 * 1024) throw new Error("附件超过本地预览限制");
  await imPlugin.writeAttachment({ attachmentId, data });
  return data;
}

async function registerProtocol() {
  const rendererRoot = path.join(__dirname, "..", "dist", "renderer");
  protocol.handle("chat", async (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.hostname === "attachment") {
      const [, namespace, firstId, secondId] = requestUrl.pathname.split("/");
      if (namespace === "auxiliary") {
        const attachmentId = Number(secondId);
        try {
          const task = auxiliaryWindowPool?.attachmentTask(firstId, attachmentId);
          if (!task) throw new Error("辅助窗口任务不存在");
          const data = await downloadAttachmentToCache(attachmentId);
          const responseBody = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ) as ArrayBuffer;
          return new Response(responseBody, {
            status: 200,
            headers: {
              "Content-Type": task.attachmentMimeTypes.get(attachmentId)
                || "application/octet-stream",
              "Cache-Control": "no-store",
            },
          });
        } catch (error: any) {
          return new Response(error?.message || "Not found", { status: 404 });
        }
      }
      if (namespace === "auxiliary-image") {
        try {
          const imageKey = decodeURIComponent(secondId || "");
          const resource = auxiliaryWindowPool?.imageResource(firstId, imageKey);
          if (!resource) throw new Error("图片查看任务不存在");
          let data: Uint8Array;
          if (resource.attachmentId) {
            data = await downloadAttachmentToCache(resource.attachmentId);
          } else {
            const draft = imPlugin.draftAttachment(resource.draftId || "");
            if (!draft) throw new Error("草稿图片不存在");
            data = await fs.readFile(draft.path);
          }
          const responseBody = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ) as ArrayBuffer;
          return new Response(responseBody, {
            status: 200,
            headers: {
              "Content-Type": resource.mimeType || "application/octet-stream",
              "Cache-Control": "no-store",
            },
          });
        } catch (error: any) {
          return new Response(error?.message || "Not found", { status: 404 });
        }
      }
      if (namespace !== "draft" || !/^[0-9a-f-]{36}$/i.test(firstId || "")) {
        return new Response("Not found", { status: 404 });
      }
      const draft = imPlugin.draftAttachment(firstId);
      if (!draft) return new Response("Not found", { status: 404 });
      const data = await fs.readFile(draft.path);
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": draft.mimeType,
          "Cache-Control": "no-store",
        },
      });
    }
    const pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    const requestedPath = path.resolve(rendererRoot, `.${pathname}`);
    const relative = path.relative(rendererRoot, requestedPath);
    const safePath = relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      ? requestedPath
      : path.join(rendererRoot, "index.html");
    try {
      return await net.fetch(pathToFileURL(safePath).toString());
    } catch {
      return net.fetch(pathToFileURL(path.join(rendererRoot, "index.html")).toString());
    }
  });
}

async function createWindow() {
  const stored = await readSettings();
  const bounds = stored.window || { width: 1280, height: 800 };
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    show: false,
    backgroundColor: "#edf0f5",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = developmentUrl ? url.startsWith(developmentUrl) : url.startsWith("chat://app");
    if (!allowed) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (bounds.maximized) mainWindow?.maximize();
  });
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  if (developmentUrl) await mainWindow.loadURL(developmentUrl);
  else await mainWindow.loadURL("chat://app/");
  auxiliaryWindowPool = new AuxiliaryWindowPool({
    parent: mainWindow,
    preloadPath: path.join(__dirname, "auxiliary-preload.cjs"),
    url: developmentUrl
      ? `${developmentUrl}/auxiliary.html`
      : "chat://app/auxiliary.html",
  });
  documentWindowManager = new DocumentWindowManager({
    developmentUrl,
    preloadPath: path.join(__dirname, "document-preload.cjs"),
    getContext: async () => ({
      serverUrl: (await readSettings()).server?.url || "",
      accessToken: hostAccessToken,
      account: activeAccount,
    }),
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(process.execPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("企业协作");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开企业协作", click: () => mainWindow?.show() },
    {
      label: "退出",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]));
  tray.on("double-click", () => mainWindow?.show());
}

function registerIpc() {
  ipcMain.handle("auth:update-access-token", (_event, accessToken: string | null) => {
    hostAccessToken = accessToken ? String(accessToken) : null;
    if (hostAccessToken) documentWindowManager?.sendAccessToken(hostAccessToken);
    else documentWindowManager?.closeAll();
    return true;
  });
  ipcMain.handle("windows:open-document", (event, documentId: number) => {
    if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
      throw new Error("不允许的窗口调用");
    }
    if (!documentWindowManager) throw new Error("文档窗口服务尚未启动");
    return documentWindowManager.open(Number(documentId));
  });
  ipcMain.handle("document:get-context", (event) => {
    if (!documentWindowManager) throw new Error("文档窗口服务尚未启动");
    return documentWindowManager.contextFor(event.sender);
  });
  ipcMain.handle("document:refresh-token", async (event) => {
    if (!documentWindowManager) throw new Error("文档窗口服务尚未启动");
    await documentWindowManager.contextFor(event.sender);
    return refreshHostAccessToken();
  });
  ipcMain.handle("document:ready-to-close", (event) => {
    if (!documentWindowManager) return false;
    return documentWindowManager.readyToClose(event.sender);
  });
  ipcMain.handle("windows:open-invite-history", (event, input: OpenInviteHistoryInput) => {
    if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
      throw new Error("不允许的窗口调用");
    }
    if (!auxiliaryWindowPool) throw new Error("辅助窗口池尚未启动");
    return auxiliaryWindowPool.openInviteHistory(input, mainWindow);
  });
  ipcMain.handle("windows:open-image-viewer", (event, input: OpenImageViewerInput) => {
    if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
      throw new Error("不允许的窗口调用");
    }
    if (!auxiliaryWindowPool) throw new Error("辅助窗口池尚未启动");
    return auxiliaryWindowPool.openImageViewer(input);
  });
  ipcMain.handle("windows:open-chat-history", (event, input: OpenChatHistoryInput) => {
    if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
      throw new Error("不允许的窗口调用");
    }
    if (!auxiliaryWindowPool) throw new Error("辅助窗口池尚未启动");
    return auxiliaryWindowPool.openChatHistory(input);
  });
  ipcMain.handle("windows:open-forward-record", (event, input: OpenForwardRecordInput) => {
    if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
      throw new Error("不允许的窗口调用");
    }
    if (!auxiliaryWindowPool) throw new Error("辅助窗口池尚未启动");
    return auxiliaryWindowPool.openForwardRecord(input);
  });
  ipcMain.handle("windows:get-recent-invite-history-ids", async (event, conversationId: number) => {
    if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
      throw new Error("不允许的窗口调用");
    }
    const id = Number(conversationId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("会话编号无效");
    const messages = await imPlugin.call<Message[]>("getRecentUserMessages", {
      conversationId: id,
      limit: 30,
    });
    return messages.map((message) => message.id);
  });
  ipcMain.handle("auxiliary:task:get", (event) => {
    try {
      const task = auxiliaryWindowPool?.taskFor(event.sender);
      if (!task) return null;
      const {
        account: _account,
        allowedAttachmentIds: _allowed,
        attachmentMimeTypes: _types,
        allowedMessageIds: _messages,
        imageResources: _images,
        ...publicTask
      } = task;
      return publicTask;
    } catch {
      return null;
    }
  });
  ipcMain.handle("auxiliary:messages:get-recent", async (event, input: {
    taskId: string;
    conversationId: number;
    limit: number;
  }) => {
    const task = auxiliaryWindowPool?.taskFor(event.sender, input.taskId);
    if (
      !task
      || task.type !== "invite-history"
      || task.conversationId !== Number(input.conversationId)
    ) {
      throw new Error("无权读取该会话的本地消息");
    }
    const messages = await imPlugin.call<Message[]>("getRecentUserMessages", {
      conversationId: task.conversationId,
      limit: Math.min(Math.max(Number(input.limit) || 30, 1), 30),
    });
    const attachments = messages.flatMap((message) => message.parts.flatMap((part) =>
      part.type === "image" || part.type === "file"
        ? [{
            id: Number(part.attachment.id),
            mimeType: part.attachment.mimeType,
          }]
        : []));
    auxiliaryWindowPool?.allowAttachments(
      event.sender,
      task.taskId,
      messages.map((message) => message.id),
      attachments,
    );
    return messages;
  });
  ipcMain.handle("auxiliary:history:get-metadata", async (event, taskId: string) => {
    const task = auxiliaryWindowPool?.taskFor(event.sender, taskId);
    if (!task || task.type !== "chat-history") {
      throw new Error("聊天记录任务不存在");
    }
    const conversations = await imPlugin.call<Conversation[]>("listConversations");
    const conversation = conversations.find((item) => item.id === task.conversationId);
    if (!conversation) throw new Error("会话不存在或已隐藏");
    return {
      conversation,
      historyComplete: syncStatus.historyComplete,
    } satisfies ChatHistoryMetadata;
  });
  ipcMain.handle("auxiliary:history:query", async (event, input: {
    taskId: string;
    query: MessageHistoryQuery;
  }) => {
    const task = auxiliaryWindowPool?.taskFor(event.sender, input.taskId);
    if (!task || task.type !== "chat-history") {
      throw new Error("聊天记录任务不存在");
    }
    const page = await imPlugin.call<MessageHistoryPage>("queryMessageHistory", {
      ...input.query,
      conversationId: task.conversationId,
      limit: Math.min(Math.max(Number(input.query.limit) || 50, 1), 100),
    });
    const attachments = page.items.flatMap(({ message }) =>
      message.parts.flatMap((part) =>
        part.type === "image" || part.type === "file"
          ? [{
              id: Number(part.attachment.id),
              mimeType: part.attachment.mimeType,
            }]
          : []));
    auxiliaryWindowPool?.allowAttachments(
      event.sender,
      task.taskId,
      page.items.map(({ message }) => message.id),
      attachments,
    );
    return page;
  });
  ipcMain.handle("auxiliary:history:locate", (event, input: {
    taskId: string;
    messageId: number;
  }) => {
    const task = auxiliaryWindowPool?.taskFor(event.sender, input.taskId);
    const messageId = Number(input.messageId);
    if (
      !task
      || task.type !== "chat-history"
      || !Number.isSafeInteger(messageId)
      || messageId <= 0
    ) {
      throw new Error("聊天记录定位参数无效");
    }
    mainWindow?.webContents.send("windows:locate-history-message", {
      conversationId: task.conversationId,
      messageId,
    });
    mainWindow?.show();
    mainWindow?.focus();
    return true;
  });
  ipcMain.handle("auxiliary:forward-record:get", async (event, taskId: string) => {
    const task = auxiliaryWindowPool?.taskFor(event.sender, taskId);
    if (!task || task.type !== "forward-record") {
      throw new Error("合并聊天记录任务不存在");
    }
    const message = await imPlugin.call<Message | null>("getMessage", {
      conversationId: task.conversationId,
      messageId: task.messageId,
    });
    const record = message?.parts.find((part) => part.type === "chat_record");
    if (!message || record?.type !== "chat_record") {
      throw new Error("合并聊天记录不存在");
    }
    const attachments = record.items.flatMap((item) => item.parts.flatMap((part) =>
      part.type === "image" || part.type === "file"
        ? [{ id: Number(part.attachment.id), mimeType: part.attachment.mimeType }]
        : []));
    auxiliaryWindowPool?.allowAttachments(
      event.sender,
      task.taskId,
      [message.id],
      attachments,
    );
    return message;
  });
  ipcMain.handle("auxiliary:attachments:resolve", (event, input: {
    taskId: string;
    attachmentId: number;
  }) => {
    const task = auxiliaryWindowPool?.taskFor(event.sender, input.taskId);
    const attachmentId = Number(input.attachmentId);
    if (
      !task
      || (
        task.type !== "invite-history"
        && task.type !== "chat-history"
        && task.type !== "forward-record"
      )
      || !task.allowedAttachmentIds.has(attachmentId)
    ) {
      throw new Error("无权读取该附件");
    }
    return {
      url: `chat://attachment/auxiliary/${task.taskId}/${attachmentId}`,
    };
  });
  ipcMain.handle("auxiliary:images:open-viewer", async (event, input: {
    taskId: string;
    conversationId: number;
    messageId: number;
    attachmentId: number;
  }) => {
    const source = auxiliaryWindowPool?.taskFor(event.sender, input.taskId);
    const attachmentId = Number(input.attachmentId);
    if (
      !source
      || (
        source.type !== "invite-history"
        && source.type !== "chat-history"
        && source.type !== "forward-record"
      )
      || source.conversationId !== Number(input.conversationId)
      || !source.allowedAttachmentIds.has(attachmentId)
    ) {
      throw new Error("无权查看该图片");
    }
    await auxiliaryWindowPool?.openImageViewer({
      conversationId: source.conversationId,
      messageId: Number(input.messageId),
      attachmentId,
    });
    return true;
  });
  ipcMain.handle("auxiliary:images:get-page", async (event, input: {
    taskId: string;
    direction: "initial" | "previous" | "next";
    cursor?: string;
    limit: number;
  }) => {
    const task = auxiliaryWindowPool?.taskFor(event.sender, input.taskId);
    if (!task || task.type !== "image-viewer") {
      throw new Error("图片查看任务不存在");
    }
    const page = await imPlugin.call<ImageGalleryPage>("queryImageGallery", {
      conversationId: task.conversationId,
      attachmentId: input.direction === "initial"
        ? task.initialAttachmentId
        : undefined,
      direction: input.direction,
      cursor: input.cursor,
      limit: Math.min(Math.max(Number(input.limit) || 50, 1), 100),
    });
    const items = [...page.items];
    if (
      input.direction === "initial"
      && task.initialAttachmentId
      && !items.some((item) => item.attachmentId === task.initialAttachmentId)
      && task.initialMessageId
    ) {
      const message = await imPlugin.call<Message | null>("getMessage", {
        conversationId: task.conversationId,
        messageId: task.initialMessageId,
      });
      const nestedParts: any[] = [];
      const visit = (parts: any[]) => {
        for (const part of parts || []) {
          if (part.type === "forwarded_message") visit(part.snapshot?.parts || []);
          else if (part.type === "chat_record") {
            for (const snapshot of part.items || []) visit(snapshot.parts || []);
          } else nestedParts.push(part);
        }
      };
      visit(message?.parts || []);
      const imagePart = nestedParts.find((part) =>
        part.type === "image"
        && Number(part.attachment?.id) === Number(task.initialAttachmentId));
      if (imagePart && message) {
        items.push({
          key: `forward:${message.id}:${task.initialAttachmentId}`,
          conversationId: task.conversationId,
          messageId: message.id,
          attachmentId: task.initialAttachmentId,
          originalName: imagePart.attachment.originalName,
          mimeType: imagePart.attachment.mimeType,
          width: Number(imagePart.width) || 1,
          height: Number(imagePart.height) || 1,
          createdAt: message.createdAt,
        });
      }
    }
    if (input.direction === "initial" && task.initialDraftId) {
      const draft = imPlugin.draftAttachment(task.initialDraftId);
      if (draft) {
        items.push({
          key: `draft:${task.initialDraftId}`,
          conversationId: task.conversationId,
          messageId: task.initialMessageId || 0,
          draftId: task.initialDraftId,
          originalName: draft.name,
          mimeType: draft.mimeType,
          width: 1,
          height: 1,
          createdAt: new Date().toISOString(),
        });
      }
    }
    auxiliaryWindowPool?.allowImageItems(event.sender, task.taskId, items);
    return { ...page, items } satisfies ImageGalleryPage;
  });
  ipcMain.handle("auxiliary:images:resolve", (event, input: {
    taskId: string;
    imageKey: string;
  }) => {
    const task = auxiliaryWindowPool?.taskFor(event.sender, input.taskId);
    if (!task || task.type !== "image-viewer") throw new Error("图片查看任务不存在");
    auxiliaryWindowPool?.imageResource(task.taskId, String(input.imageKey));
    return {
      url: `chat://attachment/auxiliary-image/${task.taskId}/${
        encodeURIComponent(String(input.imageKey))
      }`,
    };
  });
  ipcMain.handle("auxiliary:images:save-as", async (event, input: {
    taskId: string;
    imageKey: string;
  }) => {
    const task = auxiliaryWindowPool?.taskFor(event.sender, input.taskId);
    if (!task || task.type !== "image-viewer") throw new Error("图片查看任务不存在");
    const resource = auxiliaryWindowPool?.imageResource(task.taskId, String(input.imageKey));
    if (!resource) throw new Error("图片不存在");
    if (resource.attachmentId) await downloadAttachmentToCache(resource.attachmentId);
    return imPlugin.saveAttachment({
      attachmentId: resource.attachmentId,
      draftId: resource.draftId,
      name: resource.originalName,
    }, BrowserWindow.fromWebContents(event.sender));
  });
  ipcMain.handle("auxiliary:task:complete", (event, taskId: string, result: InviteHistoryResult) => {
    auxiliaryWindowPool?.complete(event.sender, taskId, result);
    return true;
  });
  ipcMain.handle("auxiliary:task:cancel", (event, taskId: string) => {
    auxiliaryWindowPool?.cancel(event.sender, taskId);
    return true;
  });
  ipcMain.handle("auxiliary:task:reset-complete", (event, taskId: string) => {
    auxiliaryWindowPool?.resetComplete(event.sender, taskId);
    return true;
  });
  ipcMain.handle("clipboard:write-text", (_event, value: string) => {
    clipboard.writeText(String(value ?? ""));
    return true;
  });
  ipcMain.handle("clipboard:read-text", () => clipboard.readText());
  ipcMain.handle("clipboard:write-image", (_event, input: {
    data: Uint8Array;
    mimeType: string;
  }) => {
    const image = nativeImage.createFromBuffer(Buffer.from(input.data));
    if (image.isEmpty()) throw new Error("图片格式不支持复制");
    clipboard.writeImage(image);
    return true;
  });
  ipcMain.handle("server:get", async () => {
    const stored = await readSettings();
    if (stored.server) return stored.server;
    if (!defaultServerUrl) return null;
    return {
      url: defaultServerUrl,
      serverId: "",
      name: "默认企业服务器",
      apiVersion: "1",
      socketPath: "/socket.io",
    } satisfies ServerConfig;
  });
  ipcMain.handle("server:test", (_event, url: string) => checkServer(url));
  ipcMain.handle("server:switch", async (_event, url: string) => {
    const checked = await checkServer(url);
    await auxiliaryWindowPool?.reset();
    documentWindowManager?.closeAll();
    activeAccount = null;
    hostAccessToken = null;
    await imPlugin.close();
    const stored = await readSettings();
    await writeSettings({ ...stored, server: checked.config });
    await session.defaultSession.clearStorageData({ storages: ["cookies"] });
    mainWindow?.webContents.send("server:switched", checked.config);
    return checked;
  });
  ipcMain.handle("database:open", async (_event, input: AuxiliaryAccountContext) => {
    const result = await imPlugin.open(input);
    activeAccount = {
      serverId: input.serverId,
      companyId: Number(input.companyId),
      userId: Number(input.userId),
    };
    await auxiliaryWindowPool?.activate(activeAccount);
    return result;
  });
  ipcMain.handle("database:close", async () => {
    activeAccount = null;
    hostAccessToken = null;
    documentWindowManager?.closeAll();
    await auxiliaryWindowPool?.reset();
    return imPlugin.close();
  });
  ipcMain.handle("database:clear", async () => {
    activeAccount = null;
    documentWindowManager?.closeAll();
    await auxiliaryWindowPool?.reset();
    return imPlugin.clear();
  });
  ipcMain.handle("database:call", (_event, method: string, args: unknown) => {
    if (!imPluginMethods.has(method)) throw new Error("不允许的 IM Plugin 操作");
    return imPlugin.call(method, args);
  });
  ipcMain.handle("cache:read-attachment", (_event, attachmentId: number) =>
    imPlugin.readAttachment(attachmentId));
  ipcMain.handle("cache:write-attachment", (_event, input) =>
    imPlugin.writeAttachment(input));
  ipcMain.handle("attachment:stage", (_event, input) =>
    imPlugin.stageAttachment(input));
  ipcMain.handle("attachment:remove-draft", (_event, id: string) =>
    imPlugin.removeDraftAttachment(id));
  ipcMain.handle("attachment:open", (_event, input) =>
    imPlugin.openAttachment(input));
  ipcMain.handle("attachment:save-as", (event, input) =>
    imPlugin.saveAttachment(input, BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle("attachment:save-many", async (event, input: Array<{
    attachmentId: number;
    name: string;
  }>) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = { properties: ["openDirectory"] as Array<"openDirectory"> };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    const directory = result.filePaths[0];
    if (result.canceled || !directory) return 0;
    let saved = 0;
    for (const item of input || []) {
      const attachmentId = Number(item.attachmentId);
      if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) continue;
      const source = await downloadAttachmentToCache(attachmentId);
      const original = path.basename(String(item.name || `图片-${attachmentId}`));
      const extension = path.extname(original);
      const basename = path.basename(original, extension);
      let target = path.join(directory, original);
      let suffix = 1;
      while (true) {
        try {
          await fs.access(target);
          target = path.join(directory, `${basename} (${suffix})${extension}`);
          suffix += 1;
        } catch {
          break;
        }
      }
      await fs.writeFile(target, source);
      saved += 1;
    }
    return saved;
  });
  ipcMain.handle("attachment:show-in-folder", (_event, input) =>
    imPlugin.showAttachment(input));
  ipcMain.handle("sync:get-status", () => syncStatus);
  ipcMain.handle("sync:report", (_event, status: SyncStatus) => {
    syncStatus = { ...syncStatus, ...status };
    mainWindow?.webContents.send("sync:status", syncStatus);
    return true;
  });
  ipcMain.handle("sync:retry", () => {
    mainWindow?.webContents.send("sync:retry-requested");
    return true;
  });
  ipcMain.handle("app:get-version", () => app.getVersion());
  ipcMain.handle("external:open", (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("仅允许打开 HTTPS 链接");
    return shell.openExternal(parsed.toString());
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId("com.enterprise.chat");
    await registerProtocol();
    registerIpc();
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(permission === "notifications");
    });
    await createWindow();
    createTray();
  });
}

app.on("before-quit", async () => {
  quitting = true;
  if (mainWindow) {
    const bounds = mainWindow.getNormalBounds();
    const stored = await readSettings();
    await writeSettings({
      ...stored,
      window: { ...bounds, maximized: mainWindow.isMaximized() },
    });
  }
  await auxiliaryWindowPool?.dispose();
  documentWindowManager?.closeAll();
  await imPlugin.close();
});

app.on("window-all-closed", () => {
  // Keep the desktop client running in the tray.
});
