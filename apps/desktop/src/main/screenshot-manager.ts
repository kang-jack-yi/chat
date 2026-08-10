import { BrowserWindow, shell, systemPreferences } from "electron";
import Screenshots from "electron-screenshots";

export interface ScreenshotCaptureInput {
  hideMainWindow: boolean;
}

export type ScreenshotCaptureResult =
  | { canceled: true }
  | {
      canceled: false;
      name: string;
      mimeType: "image/png";
      data: Uint8Array;
    };

interface ScreenshotEvent {
  preventDefault(): void;
}

interface WindowState {
  visible: boolean;
  minimized: boolean;
  maximized: boolean;
  fullScreen: boolean;
}

interface PendingCapture {
  resolve: (result: ScreenshotCaptureResult) => void;
  reject: (error: Error) => void;
  windowState: WindowState | null;
}

function screenshotName() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `截图-${timestamp}.png`;
}

export class ScreenshotManager {
  private readonly screenshots: Screenshots;
  private pending: PendingCapture | null = null;

  constructor(private readonly getMainWindow: () => BrowserWindow | null) {
    this.screenshots = new Screenshots({
      singleWindow: true,
      lang: {
        operation_ok_title: "完成",
        operation_cancel_title: "取消",
        operation_save_title: "插入聊天",
      },
    });

    this.screenshots.on("ok", (event: ScreenshotEvent, buffer: Buffer) => {
      event.preventDefault();
      void this.complete({
        canceled: false,
        name: screenshotName(),
        mimeType: "image/png",
        data: new Uint8Array(buffer),
      });
    });
    this.screenshots.on("save", (event: ScreenshotEvent, buffer: Buffer) => {
      event.preventDefault();
      void this.complete({
        canceled: false,
        name: screenshotName(),
        mimeType: "image/png",
        data: new Uint8Array(buffer),
      });
    });
    this.screenshots.on("cancel", (event: ScreenshotEvent) => {
      event.preventDefault();
      void this.complete({ canceled: true });
    });
    this.screenshots.on("windowClosed", () => {
      if (this.pending) void this.complete({ canceled: true });
    });
  }

  async capture(input: ScreenshotCaptureInput): Promise<ScreenshotCaptureResult> {
    if (this.pending) throw new Error("已有截图任务正在进行");
    if (process.platform === "darwin") {
      const status = systemPreferences.getMediaAccessStatus("screen");
      if (status === "denied" || status === "restricted") {
        await shell.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        ).catch(() => undefined);
        throw new Error("请在系统设置中允许屏幕录制权限后重试");
      }
    }

    const mainWindow = this.getMainWindow();
    const windowState = input.hideMainWindow && mainWindow && !mainWindow.isDestroyed()
      ? {
          visible: mainWindow.isVisible(),
          minimized: mainWindow.isMinimized(),
          maximized: mainWindow.isMaximized(),
          fullScreen: mainWindow.isFullScreen(),
        }
      : null;

    return new Promise<ScreenshotCaptureResult>((resolve, reject) => {
      this.pending = { resolve, reject, windowState };
      void (async () => {
        try {
          if (windowState) {
            mainWindow?.hide();
            await new Promise((done) => setTimeout(done, 150));
          }
          await this.screenshots.startCapture();
        } catch (error) {
          await this.fail(error);
        }
      })();
    });
  }

  async dispose() {
    if (this.pending) await this.complete({ canceled: true });
    this.screenshots.removeAllListeners();
    const captureWindow = this.screenshots.$win;
    if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy();
    if (!this.screenshots.$view.webContents.isDestroyed()) {
      this.screenshots.$view.webContents.close({ waitForBeforeUnload: false });
    }
  }

  private async complete(result: ScreenshotCaptureResult) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    await this.screenshots.endCapture().catch(() => undefined);
    this.restoreMainWindow(pending.windowState);
    pending.resolve(result);
  }

  private async fail(error: unknown) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    await this.screenshots.endCapture().catch(() => undefined);
    this.restoreMainWindow(pending.windowState);
    pending.reject(error instanceof Error ? error : new Error("截图失败"));
  }

  private restoreMainWindow(state: WindowState | null) {
    if (!state) return;
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!state.visible) {
      mainWindow.hide();
      return;
    }
    if (state.fullScreen && !mainWindow.isFullScreen()) mainWindow.setFullScreen(true);
    else if (state.maximized && !mainWindow.isMaximized()) mainWindow.maximize();
    mainWindow.show();
    if (state.minimized) {
      if (!mainWindow.isMinimized()) mainWindow.minimize();
      return;
    }
    mainWindow.focus();
  }
}
