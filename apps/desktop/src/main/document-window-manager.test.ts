import { describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({ windows: [] as any[] }));

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");

  class FakeWebContents extends EventEmitter {
    id = 41;
    destroyed = false;
    send = vi.fn();
    setWindowOpenHandler = vi.fn();
    isDestroyed = () => this.destroyed;
  }

  class FakeBrowserWindow extends EventEmitter {
    private destroyed = false;
    private readonly contents = new FakeWebContents();
    loadURL = vi.fn(async () => undefined);
    isMinimized = vi.fn(() => false);
    restore = vi.fn();
    show = vi.fn();
    focus = vi.fn();

    constructor() {
      super();
      electronMock.windows.push(this);
    }

    get webContents() {
      if (this.destroyed) throw new Error("Object has been destroyed");
      return this.contents;
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy() {
      this.destroyed = true;
      this.contents.destroyed = true;
      this.emit("closed");
    }
  }

  return { BrowserWindow: FakeBrowserWindow };
});

import { DocumentWindowManager } from "./document-window-manager";

describe("DocumentWindowManager", () => {
  it("waits for the renderer and never reads webContents after the window is destroyed", async () => {
    const manager = new DocumentWindowManager({
      developmentUrl: "http://127.0.0.1:15173",
      preloadPath: "document-preload.cjs",
      getContext: async () => ({
        serverUrl: "http://127.0.0.1:7001",
        accessToken: "access-token",
        account: { serverId: "server", companyId: 1, userId: 1 },
      }),
    });

    await manager.open(7);
    const window = electronMock.windows.at(-1);
    const sender = window.webContents;
    const preventDefault = vi.fn();

    window.emit("close", { preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(sender.send).toHaveBeenCalledWith("document:before-close");
    expect(manager.readyToClose(sender)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(window.isDestroyed()).toBe(true);
    expect(manager.readyToClose(sender)).toBe(false);
  });
});
