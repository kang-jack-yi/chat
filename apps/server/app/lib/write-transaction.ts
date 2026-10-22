import type { Application } from "egg";
import { Transaction, type Sequelize } from "sequelize";
import { ServiceError } from "./service-error";

// Egg Service 随请求创建，队列必须按数据库连接共享，不能保存在 Service 实例上。
const pendingWrites = new WeakMap<Sequelize, Promise<unknown>>();

/** 识别真实 SQLite 写锁冲突，不重试业务、约束或其他数据库错误。 */
function isBusy(error: any): boolean {
  return (
    error?.original?.code === "SQLITE_BUSY" ||
    error?.parent?.code === "SQLITE_BUSY"
  );
}

/** 串行执行本连接的评审写事务；跨 worker 依靠 IMMEDIATE 写锁与整笔事务重试。 */
export async function writeTransaction<T>(
  app: Application,
  operation: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  const db = app.chatDb.sequelize;
  const previous = pendingWrites.get(db) || Promise.resolve();
  const result = previous.then(async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await db.transaction(
          { type: Transaction.TYPES.IMMEDIATE },
          operation,
        );
      } catch (error) {
        if (!isBusy(error)) throw error;
        if (attempt >= 3)
          throw new ServiceError(
            503,
            "DATABASE_BUSY",
            "数据库繁忙，请使用相同请求标识重试",
          );
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  });
  pendingWrites.set(
    db,
    result.catch(() => undefined),
  );
  return result;
}
