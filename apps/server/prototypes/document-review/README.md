# 文档评审工作流验证原型

PROTOTYPE：仅验证“一位指定成员审批 → 创建一项任务 → 到期提醒 → 群消息通知”，不属于正式审批产品。

所有数据使用系统临时目录中的 `chat-workflow-PROTOTYPE-*/PROTOTYPE-wipe-me.sqlite`。不会接入正式 Egg 路由，不修改正式数据库模型，不接入设计器或第三方平台，也不需要 Redis/PostgreSQL。

## 运行

在仓库根目录运行，使用项目已经安装的依赖：

```powershell
# 真实 HTTP / SQLite / 多进程恢复 / 写入故障回滚
pnpm --filter @chat/server exec ts-node --files prototypes/document-review/verify.ts

# 真实 Socket.IO 认证、通知和群同步事件
pnpm --filter @chat/server exec ts-node --files prototypes/document-review/socket-verification.ts

# 独立权限、幂等和并发回归
pnpm --filter @chat/server exec ts-node --files prototypes/document-review/security-regression.ts
```

脚本输出每项检查与报告路径。每次完整运行都会创建新临时库，保留数据库及 JSON 报告以便复核；不清理真实数据。`verify.ts` 内的异常退出阶段预期返回 73，只有父进程完整验证通过后，整个命令才返回 0。

## 验证对象

- `service.ts`：固定版本的原型 Service。提交者、审批人、负责人及文档/群聊权限都由服务端校验。
- `harness.ts`：启动真实 Egg 应用，仅为测试应用注册三个 `/prototype/reviews` 接口。
- `verify.ts`：六个独立 Node 进程验证持久化恢复、重复请求、截止边界、异常退出后补投、完成/驳回分支及真实 SQLite 写入故障。
- `socket-verification.ts`：真实 WebSocket 客户端验证通知与群同步；包含另一企业的认证成员。
- `security-regression.ts`：独立子 agent 的黑盒回归入口。

流程状态及任务、通知、消息使用真实 SQLite。通过现有 `/api/tasks`、`/api/notifications`、群聊消息接口读取结果，不以仅内存里的“状态正确”替代业务可见性验证。Socket 提示在数据库提交后发送，持久化同步事件用于补偿漏掉的提示。

## 范围与限制

- 定时验证推进到固定逻辑截止时间，不代表等待了实际的业务截止时长。
- 群消息通知复用当前消息/通知/同步数据结构；PoC 的群消息带有“工作流原型”标识。
- 由于正式 `TasksService.create` 自行管理事务且尚无工作流幂等入口，原型使用 Task 模型与现有通知/系统消息/同步 helper 同事务写入。正式化时应将这段领域操作收敛到支持幂等与事务协作的任务 Service，而不是复制到 Controller。
- 并发回归曾复现 SQLite `BEGIN IMMEDIATE` 写锁竞争导致偶发 500；原型用同一 Service 实例的串行写队列修复。此队列只约束本进程原型入口，不能约束其他 Egg worker 或其他业务写入；多实例部署需另行验证数据库、执行队列和并发策略。
- 只处理固定版本、单人审批，不包含审批模板 UI、拖拽设计、多人会签、转交/撤回、升级迁移或通用插件执行。
- 尚不等于完整 Electron GUI E2E、生产压力测试、分布式多实例恢复或第三方 Webhook 重试验收。
- 文件位于 `prototypes/`，不会由正式应用自动加载；独立脚本使用 ts-node 类型检查，原有服务端 tsconfig/测试套件默认不包含它们。
- 不自动修改分支、提交或推送 Git。
