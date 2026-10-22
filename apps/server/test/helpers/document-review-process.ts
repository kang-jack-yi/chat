import assert from "node:assert/strict";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import type { Context } from "egg";

export interface ReviewOperation {
  action: "submit" | "decide" | "scan";
  userId?: number;
  reviewId?: number;
  input?: Record<string, any>;
  now?: string;
}

export interface ProcessResult {
  status: number;
  data?: any;
  code?: string;
  message?: string;
}

/** 启动独立 Node 和真实 Egg，使用显式临时库，等待就绪后才允许参与竞争。 */
export async function startReviewProcess(
  baseDir: string,
  databasePath: string,
) {
  const child = fork(__filename, [], {
    cwd: baseDir,
    execArgv: ["-r", require.resolve("ts-node/register/transpile-only")],
    env: {
      ...process.env,
      CHAT_DATABASE_PATH: databasePath,
      CHAT_REVIEW_PROCESS: "1",
      CHAT_REVIEW_BASE_DIR: baseDir,
      CHAT_COLLABORATION_DISABLED: "1",
      CHAT_CONSOLE_LOG_LEVEL: "NONE",
      EGG_SERVER_ENV: "unittest",
      TS_NODE_PROJECT: path.join(baseDir, "tsconfig.json"),
      TS_NODE_FILES: "true",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  child.stdout!.on("data", (chunk) => {
    output = (output + chunk).slice(-12000);
  });
  child.stderr!.on("data", (chunk) => {
    output = (output + chunk).slice(-12000);
  });

  /** 限时等待 IPC 消息，崩溃和启动错误必须携带子进程输出使测试失败。 */
  function receive(type: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          finish(new Error(`子进程 ${child.pid} 等待 ${type} 超时\n${output}`)),
        50000,
      );
      /** 移除本次监听，避免下一次运行混入旧结果或泄漏计时器。 */
      function finish(error?: Error, value?: any) {
        clearTimeout(timer);
        child.off("message", onMessage);
        child.off("exit", onExit);
        child.off("error", onError);
        if (error) reject(error);
        else resolve(value);
      }
      /** 仅接收本次阶段结果，保留真实启动异常。 */
      function onMessage(message: any) {
        if (message.type === "fatal")
          finish(new Error(`${message.error}\n${output}`));
        else if (message.type === type) finish(undefined, message);
      }
      /** 将意外退出转为断言证据，不能将进程退出当作竞争成功。 */
      function onExit(code: number | null, signal: string | null) {
        finish(
          new Error(
            `子进程 ${child.pid} 提前退出 code=${code} signal=${signal}\n${output}`,
          ),
        );
      }
      /** 保留操作系统启动错误。 */
      function onError(error: Error) {
        finish(error);
      }
      child.on("message", onMessage);
      child.on("exit", onExit);
      child.on("error", onError);
    });
  }

  try {
    const ready = await receive("ready");
    assert.equal(ready.storage, path.resolve(databasePath));
    assert.notEqual(
      ready.pid,
      process.pid,
      "必须是不同 Node 进程而不是另一个 app 实例",
    );
    process.stdout.write(
      `[document-review-process] ${JSON.stringify({ phase: "ready", parentPid: process.pid, pid: ready.pid, storage: ready.storage })}\n`,
    );
    return {
      pid: ready.pid as number,
      /** 同时放行已就绪进程中的真实 Service 请求，并返回每个请求的结果。 */
      async run(operations: ReviewOperation[]): Promise<ProcessResult[]> {
        const result = receive("result");
        child.send({ type: "run", operations });
        const message = await result;
        assert.equal(message.pid, ready.pid);
        process.stdout.write(
          `[document-review-process] ${JSON.stringify({ phase: "result", pid: ready.pid, actions: operations.map((operation) => operation.action), statuses: message.results.map((item: ProcessResult) => item.status) })}\n`,
        );
        return message.results;
      },
      /** 关闭真实应用和数据库后退出，下一次启动必须从磁盘恢复。 */
      async close() {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = waitForExit(child);
        child.send({ type: "close" });
        await exited;
        process.stdout.write(
          `[document-review-process] ${JSON.stringify({ phase: "closed", pid: ready.pid, exitCode: child.exitCode })}\n`,
        );
      },
    };
  } catch (error) {
    child.kill();
    throw error;
  }
}

/** 限时回收专用子进程，仅在关闭超时后终止本测试启动的进程。 */
function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`子进程 ${child.pid} 关闭超时`));
    }, 10000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`子进程 ${child.pid} 关闭失败 code=${code}`));
    });
  });
}

/** 子进程直接加载正式应用，不注册测试路由、不替换事务或业务服务。 */
async function runChild() {
  const mm = require("egg-mock");
  const app = mm.app({
    baseDir: process.env.CHAT_REVIEW_BASE_DIR,
    cache: false,
  });
  await app.ready();
  process.send!({
    type: "ready",
    pid: process.pid,
    storage: app.chatDb.sequelize.options.storage,
  });
  process.on("message", async (message: any) => {
    if (message.type === "close") {
      try {
        await app.close();
        await app.chatDb.sequelize.close();
        process.exit(0);
      } catch (error) {
        process.send!({ type: "fatal", error: String(error) });
        process.exit(1);
      }
    }
    if (message.type !== "run") return;
    const results = await Promise.all(
      message.operations.map(
        async (operation: ReviewOperation): Promise<ProcessResult> => {
          try {
            const ctx: Context = app.createAnonymousContext();
            if (operation.userId) {
              const user = await app.chatDb.User.findByPk(operation.userId);
              assert.ok(user, "子进程操作身份必须来自同一临时数据库");
              ctx.currentUser = user.get({ plain: true });
            }
            let data: any;
            if (operation.action === "submit")
              data = await ctx.service.documentReviews.submit(operation.input!);
            else if (operation.action === "decide")
              data = await ctx.service.documentReviews.decide(
                operation.reviewId!,
                operation.input!,
              );
            else {
              const now = new Date(operation.now!);
              const notifications =
                await ctx.service.tasks.sendDueReminders(now);
              const groups =
                await ctx.service.documentReviews.sendDueGroupReminders(now);
              data = { notifications, groups };
            }
            return { status: 200, data };
          } catch (error: any) {
            return {
              status: error.status || 500,
              code: error.code,
              message: error.stack || String(error),
            };
          }
        },
      ),
    );
    process.send!({ type: "result", pid: process.pid, results });
  });
}

if (process.env.CHAT_REVIEW_PROCESS === "1") {
  runChild().catch((error) => {
    process.send?.({ type: "fatal", error: error.stack || String(error) });
    process.exit(1);
  });
}
