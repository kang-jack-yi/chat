import { Subscription } from "egg";
import type { Application } from "egg";

/** 按应用环境创建到期提醒定时任务，测试环境不启动自动扫描。 */
export default function taskReminders(app: Application) {
  return class TaskReminders extends Subscription {
    /** 每分钟由单个 worker 扫描，避免所有 worker 同时处理。 */
    static get schedule() {
      return {
        interval: "1m",
        type: "worker",
        disable: app.config.env === "unittest",
      };
    }

    /** 使用匿名上下文调用全局任务扫描，不依赖当前登录用户。 */
    async subscribe() {
      await this.ctx.service.tasks.sendDueReminders();
      await this.ctx.service.documentReviews.sendDueGroupReminders();
    }
  };
}
