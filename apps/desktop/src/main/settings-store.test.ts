import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopSettingsStore } from "./settings-store";

/** 每个用例使用独立临时文件，不接触 Electron 的真实用户目录。 */
async function fixture() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "chat-settings-regression-"),
  );
  const filename = path.join(directory, "settings.json");
  return { store: new DesktopSettingsStore(() => filename), filename };
}

describe("桌面设置读改写", () => {
  it("首次启动读取空设置", async () => {
    const { store } = await fixture();
    expect(await store.read()).toEqual({});
  });

  it("并发更新多个账号的偏好时不冲突也不丢失字段", async () => {
    const { store } = await fixture();
    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        store.update((current) => ({
          ...current,
          preferences: {
            ...current.preferences,
            accounts: {
              ...current.preferences?.accounts,
              [index]: { chat: { fontSize: 14 } },
            },
          },
        })),
      ),
    );
    expect(
      Object.keys((await store.read()).preferences?.accounts || {}),
    ).toHaveLength(24);
  });

  it("主题、截图和窗口并发保存互不覆盖，重启后可读取", async () => {
    const { store, filename } = await fixture();
    await Promise.all([
      store.update((current) => ({
        ...current,
        preferences: {
          ...current.preferences,
          device: { appearance: { theme: "dark" } },
        },
      })),
      store.update((current) => ({
        ...current,
        screenshot: { hideMainWindow: false },
      })),
      store.update((current) => ({
        ...current,
        window: { width: 1280, height: 800 },
      })),
    ]);
    expect(await new DesktopSettingsStore(() => filename).read()).toMatchObject(
      {
        preferences: { device: { appearance: { theme: "dark" } } },
        screenshot: { hideMainWindow: false },
        window: { width: 1280, height: 800 },
      },
    );
  });

  it("一次修改失败不阻塞后续更新", async () => {
    const { store } = await fixture();
    const rejected = store.update(() => {
      throw new Error("fixture failure");
    });
    const accepted = store.update((current) => ({
      ...current,
      screenshot: { hideMainWindow: true },
    }));
    await expect(rejected).rejects.toThrow("fixture failure");
    await accepted;
    expect((await store.read()).screenshot?.hideMainWindow).toBe(true);
  });

  it("读取等待已经提交的更新完成，不观察替换文件的中间状态", async () => {
    const { store } = await fixture();
    const updating = store.update((current) => ({
      ...current,
      screenshot: { hideMainWindow: false },
    }));
    const reading = store.read();
    expect(await reading).toMatchObject({
      screenshot: { hideMainWindow: false },
    });
    await updating;
  });

  it("交错读取与后续修改时仍按请求顺序提供一致快照", async () => {
    const { store } = await fixture();
    const operations: Promise<unknown>[] = [];
    for (let index = 0; index < 12; index += 1) {
      operations.push(
        store.update((current) => ({
          ...current,
          window: { width: 1024 + index, height: 800 },
        })),
      );
      operations.push(
        store
          .read()
          .then((snapshot) =>
            expect(snapshot.window?.width).toBe(1024 + index),
          ),
      );
    }
    await Promise.all(operations);
  });
});
