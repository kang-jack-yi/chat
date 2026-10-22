# 文档评审工作流闭环验证结果

验证日期：2026-10-11。结论依据为真实 Egg HTTP 接口、SQLite、Socket.IO 客户端和独立 Node 进程的运行结果，不是仅阅读源码或内存状态模拟。

## 结论

固定单人审批的闭环已在当前技术栈跑通：

```text
提交文档评审 → 指定成员审批 → 创建负责人任务 → 到期通知 → 群消息及同步提示
```

可以继续评估原生 WorkflowService 路线，不必为这一个场景先接完整第三方工作流平台。此结论仅适用于已经验证的单进程原型；尚不是可上线的审批产品，不代表多实例部署、复杂会签、拖拽设计器或 Electron GUI 已完成验收。

## 最终验证统计

| 验证组 | 最终结果 | 实际验证方式 |
| --- | --- | --- |
| 原有后端基线 | 75/75，通过，退出码 0 | 独立子 agent 使用全新临时数据库运行原有完整测试套件 |
| 原有后端构建 | 通过，退出码 0 | 服务端原有 TypeScript 构建 |
| 固定流程与恢复 | 16/16 检查通过，退出码 0 | 6 个不同 Node 进程、真实 HTTP/SQLite、一次预期退出码 73 的异常中止 |
| 网络通知 | 5/5 检查通过，退出码 0 | 3 个真实认证 WebSocket 客户端，包含另一企业成员 |
| 独立安全与并发 | 37/37，连续 3 次通过，退出码均为 0 | 跨企业/伪造身份/撤权/停用/幂等；18 轮审批竞争及 3 组 8 请求并发重复提交 |
| 写队列失败恢复 | 已包含在独立回归的第 37 项 | 保留故障触发器时执行其他正常请求，再恢复原回调，验证错误不会毒化队列 |
| 原型类型与格式 | 通过 | 原型 5 个 TypeScript 文件单独编译，Prettier 检查通过 |

原有套件不会自动包含 `prototypes/`，所以表中分开报告，不能把原有 75 项通过当作新流程通过。

## 恢复验证的实际时间线

以下 PID 来自最终复跑报告，用于证明不是同一个内存对象的重建。

| 阶段 | Node PID | 可观察状态 |
| --- | --- | --- |
| 提交 | 68232 | 评审 1 等待审批，尚无任务；重复提交只一条审批通知 |
| 审批 | 58280 | 从 SQLite 恢复等待状态；审批后任务 1 和任务分配通知各一份 |
| 通知后异常退出 | 49236 | 到期通知已提交、群消息未处理，直接以 73 退出，不调用应用清理 |
| 恢复投递 | 40768 | 新进程补投群消息 5；已有到期通知不重复，重复扫描也不追加消息 |
| 再次恢复与分支 | 56276 | 投递记录仍存在；新增的已完成任务不催办，驳回流程不生成任务 |
| 故障注入与重试 | 1652 | SQLite 触发器阻止任务写入，审批状态一起回滚；移除故障后同一回调可成功 |

截止扫描使用固定逻辑时间 `2030-01-02T00:00:00.000Z`，同时验证截止前一毫秒的边界；没有声称等待了实际业务截止时长。

## 发现并修复的问题

### 1. SQLite 并发写锁竞争

独立回归的早期两次运行分别为 35 PASS/1 FAIL 与 34 PASS/2 FAIL。8 请求并发提交和批准/驳回竞争偶发 `500 INTERNAL_ERROR`，日志定位到 `BEGIN IMMEDIATE TRANSACTION` 的 `SQLITE_BUSY`。最终决定与副作用没有重复，但请求失败不能忽略。

原型共享 Service 实例加入串行写队列，提交、决定与到期投递按顺序持有写锁。失败返回给调用者，队列继续接受后续操作。原失败断言未删除，修复后三次独立完整回归均通过；另外通过真实任务插入故障证明失败不会让队列永久卡住。

**限制**：这不是分布式锁，也不约束其他 Egg worker 或普通业务接口写入。正式应用的 Egg Service 通常按上下文实例化，不能照搬“每个请求一条内存队列”作为全局写锁。部署前需要明确单执行器/数据库写入策略；多实例应另行评估 PostgreSQL、持久化任务队列和并发控制。

### 2. 新实例的空字段输出

首次提交响应中的未绑定 `taskId` 曾被序列化为缺失字段，验证断言捕获后统一为显式 `null`；同一输入和恢复后的输出保持一致。

### 3. 验证入口的 TypeScript loader

直接使用 ts-node 不会自动打开 Egg 的 TypeScript loader，最小启动曾未加载 `app.ts` 数据库初始化。验证 harness 显式启用 `EGG_TYPESCRIPT=true` 后原启动复现通过。修复仅在原型入口，没有改生产配置。

SQLite 触发器故障在现有错误中间件映射为 `400 VALIDATION_ERROR`，故障注入按真实契约断言，不为迎合预设的 500 改生产逻辑。

## 已验证的权限与幂等边界

- 未登录、非指定审批人、同企业无关成员均不能越权操作。
- 双向跨企业查询、决定和引用其他企业文档/群聊/成员均被拒绝。
- body 里的企业/提交者字段不能覆盖认证身份，篡改令牌和不匹配的用户企业均被拒绝。
- 提交者、审批人、负责人任何一人的文档或群聊权限被撤销、账号被停用，以及文档进入回收站后，不继续产生非法任务或通知。
- 重复提交复用实例，相同提交键不同内容返回 409。
- 重复批准不追加任务、分配通知或系统消息；批准与驳回竞争只有一个最终决定。
- 已完成任务不催办；到期通知、群消息及同步提示在重复扫描后不重复。
- 真实网络检查中负责人观察到 2 条群同步提示（任务创建和到期消息），另一企业观察到 0 条流程事件。

## 代码与复跑

原型代码保存在 [document-review](../../apps/server/prototypes/document-review/README.md)，核心逻辑在 `service.ts`；harness 的三个接口只为验证应用注册，没有接入正式路由。

```powershell
pnpm --filter @chat/server exec ts-node --files prototypes/document-review/verify.ts
pnpm --filter @chat/server exec ts-node --files prototypes/document-review/socket-verification.ts
pnpm --filter @chat/server exec ts-node --files prototypes/document-review/security-regression.ts
```

每次运行创建新的系统临时数据库并输出 JSON 报告路径。报告和数据库保留供复核，不接触默认 `chat.sqlite` 或 Electron 用户缓存。

## 本机原始证据

以下路径仅在本次验证机器上可用，临时目录如被系统清理，可以用上述命令重新生成。

- [多进程闭环报告](C:/Users/admin/AppData/Local/Temp/chat-workflow-PROTOTYPE-ElmM7J/verification.json)
- [真实 WebSocket 报告](C:/Users/admin/AppData/Local/Temp/chat-workflow-PROTOTYPE-Skk904/socket-verification.json)
- [独立回归第 1 次](C:/Users/admin/AppData/Local/Temp/chat-workflow-PROTOTYPE-PWO1Dy/security-regression-report.json)
- [独立回归第 2 次](C:/Users/admin/AppData/Local/Temp/chat-workflow-PROTOTYPE-8bOanb/security-regression-report.json)
- [独立回归第 3 次](C:/Users/admin/AppData/Local/Temp/chat-workflow-PROTOTYPE-SdnACJ/security-regression-report.json)
- [原有后端基线](C:/Users/admin/AppData/Local/Temp/chat-document-review-baseline-165f3c2ee4c046288cdb90ae66f2ebb9/baseline-summary.json)

## 正式化前仍需完成

1. 将原型中 Task 模型与现有 helper 的同事务操作收敛到任务 Service 的幂等入口。当前正式 `TasksService.create` 自行管理事务，不能在外层简单包一层就保证审批+任务原子性。
2. 建立正式流程模型、版本化定义、审计、权限规则和受控的后台执行器，并接入正常路由与应用生命周期。
3. 增加审批页面、待办入口和通知跳转；本次尚未跑完整 Electron GUI E2E。
4. 验证长期运行、业务并发写入、多 worker/多实例、备份恢复、升级迁移和真实部署；不根据本次有限并发回归给出容量保证。
5. 如果后续选 FlowGram/React Flow，只把它们作为设计器接入；第三方平台许可与实际运行兼容性仍按独立方案验证。

本次未安装依赖，未修改正式业务代码、共享 DTO、应用路由或生产数据库迁移；未修改分支、提交或推送 Git。
