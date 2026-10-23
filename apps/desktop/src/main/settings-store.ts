import fs from "node:fs/promises";
import path from "node:path";
import type { DesktopPreferences, ServerConfig } from "@chat/shared";

export interface StoredSettings {
  server?: ServerConfig;
  window?: {
    width: number;
    height: number;
    x?: number;
    y?: number;
    maximized?: boolean;
  };
  screenshot?: { hideMainWindow: boolean };
  preferences?: {
    device?: {
      appearance?: Partial<DesktopPreferences["appearance"]>;
      general?: Partial<DesktopPreferences["general"]>;
    };
    accounts?: Record<string, { chat?: Partial<DesktopPreferences["chat"]> }>;
  };
}

/** 集中维护桌面设置文件，调用方通过一次读改写更新自己的字段。 */
export class DesktopSettingsStore {
  private pending: Promise<void> = Promise.resolve();
  /** 延迟解析位置，沿用 Electron 设置的用户数据目录。 */
  constructor(private readonly filename: () => string) {}

  /** 读取当前设置，兼容首次启动时尚无文件的情况。 */
  read(): Promise<StoredSettings> {
    return this.enqueue(() => this.readCurrent());
  }

  /** 仅供串行更新内部读取，避免等待自身产生死锁。 */
  private async readCurrent(): Promise<StoredSettings> {
    try {
      return JSON.parse(await fs.readFile(this.filename(), "utf8"));
    } catch {
      return {};
    }
  }

  /** 在当前文件内容上修改字段，不要求调用方自行合并其他偏好。 */
  update(
    change: (current: StoredSettings) => StoredSettings,
  ): Promise<StoredSettings> {
    return this.enqueue(async () => {
      const next = change(await this.readCurrent());
      await this.write(next);
      return next;
    });
  }

  /** 读取和修改共用队列；一次失败不会阻止后续请求执行。 */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** 先写临时文件，再替换目标；失败时恢复原设置。 */
  private async write(settings: StoredSettings): Promise<void> {
    const target = this.filename();
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    const backup = `${target}.${process.pid}.bak`;
    await fs.writeFile(temporary, JSON.stringify(settings, null, 2), "utf8");
    try {
      await fs.rename(target, backup).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await fs.rename(temporary, target);
      await fs.rm(backup, { force: true });
    } catch (error) {
      await fs.rm(temporary, { force: true });
      if (
        await fs
          .stat(backup)
          .then(() => true)
          .catch(() => false)
      ) {
        await fs.rename(backup, target).catch(() => undefined);
      }
      throw error;
    }
  }
}
