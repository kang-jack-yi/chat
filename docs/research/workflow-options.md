# 当前项目工作流方案调研

调研日期：2026-10-11。依据：当前仓库源码、项目官方文档、官方 GitHub 仓库及 npm 元数据。本文区分“可核实的产品能力”和“针对当前项目的工程判断”；只完成资料与源码调研，没有安装平台、运行 PoC、压测或验证生产部署，许可证与版本信息需要在实际采购/上线前再次核对。

## 1. 结论与范围

本次主要讨论企业协作中的业务工作流：审批流转、条件分支、任务/通知联动、定时触发与 Webhook 自动化。GitHub Actions 的开发流水线单独列在后文，不与业务审批混用。

**针对本项目的建议：**

- 对应 TODO 中“审批模板和基础工作流”：优先实现一个范围受限的原生 WorkflowService，复用 Sequelize/SQLite、现有身份与通知机制。初期用表单配置串行审批；状态复杂后再引入 XState，确有拖拽设计需求再接 React Flow。不是现在就自建一个通用 n8n。
- 自有拖拽工作流：比较 FlowGram 与 React Flow，前者包含更多节点表单/变量工具，但其参考运行时仍需另做生产化验证。
- 开发者维护的异步自动化：BullMQ 是合适的执行层，但它不替代审批领域模型。
- 希望尽快获得现成连接器和流程编辑器：评估 Activepieces；仅供内部管理员配置的轻量事件集成可优先试 Node-RED。是否给最终用户嵌入编辑器，必须作为独立的授权与权限评估项。
- 流程跨多服务、持续多天且恢复要求高：再评估 Temporal；已有 BPMN 标准化/复杂人工任务诉求时考虑 bpmn-engine 或独立 Flowable 服务。
- n8n、Windmill 可纳入侧挂自动化备选，但不能简单地按“GitHub 上有源码，所以可免费白标嵌入”判断。

上述排序是结合当前代码规模和依赖的工程判断，不代表这些平台已在本项目中运行成功。

## 2. 当前项目的接入基础

| 项目现状 | 对工作流选型的影响 |
| --- | --- |
| Electron + React 19 + TypeScript + Ant Design + Vite | 适合自有审批界面及 React 流程编辑组件；不是所有完整平台的 UI 都可当作 React 组件导入 |
| Egg.js 3 / Node.js / TypeScript，Controller 与 Service 分层 | 业务规则放 Service；HTTP 与外部引擎回调只作入口，不堆积在 Controller |
| Sequelize 6 + SQLite，暂无 Redis/PostgreSQL 依赖 | 原生轻量审批不必先增加基础设施；外部队列/平台的存储和运维是新增成本 |
| TasksService 已把任务、通知、SyncEvent 放进事务，提交后 Socket 推送 | 可复用任务与通知闭环，但不能认为现有服务已支持任意跨步骤事务或重复执行 |
| Egg schedule 每分钟调用 sendDueReminders，通知有持久化去重键 | 已有扫描/提醒基础，适合轻量持久化到期事件；不是分布式长流程引擎 |
| SyncEvent 按接收用户记录，用于客户端补偿同步 | 不等同于工作流事件总线/outbox；直接重复消费可能产生按用户放大的触发 |
| 机器人 Webhook 可接收消息 | 可作为“外部流程发群消息”入口，但不等于拥有创建任务/审批的全部权限 |
| TODO 明确“审批模板和基础工作流”未实现；当前无 .github/workflows | 业务工作流和 CI/CD 都有增量空间，但要分别实施 |

本地依据：[服务端依赖](../../apps/server/package.json)、[桌面端依赖](../../apps/desktop/package.json)、[任务服务](../../apps/server/app/service/tasks.ts)、[提醒调度](../../apps/server/app/schedule/task_reminders.ts)、[通知落库](../../apps/server/app/lib/notifications.ts)、[增量同步](../../apps/server/app/lib/sync.ts)、[机器人服务](../../apps/server/app/service/conversation_bot.ts)、[TODO](../../TODO.md)。

## 3. 不要混淆三类组件

1. **设计器**：绘制节点/连线并保存定义，例如 React Flow、bpmn-js。画布本身不提供企业权限、可靠执行和审批审计。
2. **执行组件**：状态机、任务队列或持久化流程引擎，例如 XState、BullMQ、bpmn-engine、Temporal。它们提供的持久化/恢复边界不同。
3. **完整平台**：编辑器、连接器、运行服务与管理 UI，例如 Activepieces、Node-RED、n8n、Windmill。运行平台和商业嵌入权益必须分别核实。

这一区分基于各项目的功能范围；画布与队列可作为原生方案的组成部分，而不是互相替代。[React Flow 项目说明](https://github.com/xyflow/xyflow)、[BullMQ Flows](https://docs.bullmq.io/guide/flows/)、[XState 持久化](https://stately.ai/docs/persistence)。

## 4. 适合 Node/TypeScript 后端的组件与引擎

### 4.1 原生流程状态 + 可选 XState + React Flow：当前基础审批优先

XState 是 MIT 许可的状态机/actor 库，提供可序列化快照的保存和恢复接口；快照存储由使用方实现，状态机变化可能导致快照不兼容。其“能够恢复状态”不意味着数据库事务、外部副作用和重复通知自动实现 exactly-once。[许可证](https://github.com/statelyai/xstate/blob/main/LICENSE)、[持久化及限制](https://stately.ai/docs/persistence)。

React Flow 核心 MIT，适合 React 的节点式编辑 UI；保存的是节点、边和视口等图形状态，不是审批实例或作业执行记录。高级示例/支持订阅与核心库应分开评估。[仓库](https://github.com/xyflow/xyflow)、[保存与恢复示例](https://reactflow.dev/examples/interaction/save-and-restore)。

**工程判断**：先做提交、逐级审批、拒绝、撤回、抄送与超时提醒中确实需要的子集；审批状态及截止时间写数据库。不要把一个等待几天的审批仅保存在内存 Promise、XState actor 或 setTimeout 里。也不必同时引入 XState、BullMQ、BPMN 三套运行时。

### 4.2 BullMQ：异步执行层，不是开箱即用的审批系统

BullMQ 核心 MIT，提供队列、失败重试、延迟/定时作业和父子依赖；Flows 是作业依赖树，不应直接等同于完整 BPMN 或“人工审批待办”。默认 Redis 后端之外，当前官方文档也提供可选 PostgreSQL 后端；不是直接复用 SQLite。官方仍将 Redis 称为默认且更充分验证的后端。[项目与许可](https://github.com/taskforcesh/bullmq)、[功能](https://docs.bullmq.io/)、[Flows](https://docs.bullmq.io/guide/flows/)、[PostgreSQL 后端](https://docs.bullmq.io/guide/postgresql)。

**工程判断**：适合 Webhook 重试、报告生成、批量通知、AI 文档处理，以及审批状态变更之后的异步动作。审批人、撤回/驳回和审计仍保存在本项目的业务表中。作业需要幂等处理，不能把队列交付保证直接当成“外部动作只发生一次”。[重试](https://docs.bullmq.io/guide/retrying-failing-jobs)、[幂等作业](https://docs.bullmq.io/patterns/idempotent-jobs)。

### 4.3 bpmn-engine + bpmn-js：坚持 Node、又确实需要 BPMN 时

bpmn-engine 是 MIT 的 Node.js BPMN 执行库；API 提供 userTask 等待、signal、getState、recover、resume。持久化存储、实例加载/锁、审批权限与业务审计仍需应用负责，不能按完整 BPM 平台的零集成成本估算。支持范围以 bpmn-elements 清单为准，不假设所有第三方 BPMN 扩展可直接执行。[仓库](https://github.com/paed01/bpmn-engine)、[API](https://github.com/paed01/bpmn-engine/blob/master/docs/API.md)、[许可证](https://github.com/paed01/bpmn-engine/blob/master/LICENSE)。

bpmn-js 可作为前端 BPMN 建模/展示器，但使用的是包含 bpmn.io 水印要求的许可证，不能简单标记为普通 MIT 或随意移除水印。编辑器能画出的模型也要经过后端支持元素与表达式校验。[bpmn-js 许可证](https://github.com/bpmn-io/bpmn-js/blob/develop/LICENSE)。

**工程判断**：适合已明确要求 BPMN XML、网关/并行人工审批的项目；当前只有基础审批需求时，先做原生固定模板更省开发与运维成本。

### 4.4 Temporal：长时间、跨服务、要求恢复可靠性的流程

Temporal 服务和 TypeScript SDK 均提供 MIT 许可源码。SDK 支持以 TypeScript 编写流程/Activity，Signal/Update 可驱动等待中的流程，持久化计时器适合审批超时。工作流定义受确定性约束，网络/数据库等副作用放 Activity；审批权限和终端用户待办 UI 仍须在本项目处理。[Temporal 许可](https://github.com/temporalio/temporal/blob/main/LICENSE)、[SDK](https://github.com/temporalio/sdk-typescript)、[Signal/Update](https://docs.temporal.io/develop/typescript/workflows/message-passing)。

这不是安装一个 npm 包就完成：需独立 Temporal Service、Worker 和持久化部署；官方示例涉及 PostgreSQL 等组件，并区分开发服务器与持续生产负载。不要用开发用 SQLite 服务配置直接推导生产部署结论。[部署指南](https://docs.temporal.io/self-hosted-guide/deployment)。

**工程判断**：作为后期方案；Egg 做鉴权和启动/回调入口，独立 Node Worker 执行 Activity，不让 Electron 客户端直接访问引擎。Node 版本元数据符合不代表当前 Windows 主机的 Worker 原生依赖已经通过验证。

### 4.5 Flowable：复杂企业审批/BPMN 的独立服务备选

Flowable 开源引擎为 Java、Apache-2.0，提供 BPMN/CMMN/DMN 和 REST API；可通过 HTTP 与现有 Egg 后端集成。官方数据库配置包含 PostgreSQL、MySQL 等支持项，SQLite 不在所列支持数据库中。[官方仓库](https://github.com/flowable/flowable-engine)、[REST](https://github.com/flowable/flowable-engine/blob/main/docs/public-api/README.md)、[数据库配置](https://www.flowable.com/open-source/docs/bpmn/ch03-Configuration)。

**工程判断**：功能匹配复杂人工审批，但新增 Java 服务及数据库的运维，不是当前最轻的路线。开源引擎许可不自动等于厂商所有设计器/企业产品权益。另，Camunda 8 当前生产许可也不能沿用老 Camunda 7 的开源印象；官方对相关组件的生产使用要求商业许可，应独立核查。[Camunda 当前许可](https://docs.camunda.io/docs/reference/licenses/)。

### 4.6 FlowGram：更完整的 React 工作流开发框架

FlowGram 仓库为 MIT，提供流程画布、节点配置表单、变量作用域和物料，定位为帮助开发者构建工作流产品的框架，而非直接部署的完整平台。与只使用 React Flow 画节点相比，若需要自有节点配置与变量体验，值得做并行小样验证。[官方仓库](https://github.com/bytedance/flowgram.ai)、[许可证](https://github.com/bytedance/flowgram.ai/blob/main/LICENSE)。

特别注意：官方 Runtime 文档明确标为早期开发、API 不保证向后兼容，当前只支持 Node.js 和自由布局；定位为 demo/参考实现，不作为 SDK 包发布。因此不能写成“接入后就拥有持久化审批、重试和生产恢复能力”。[Runtime 定位与限制](https://flowgram.ai/guide/runtime/introduction.html)。

**工程判断**：想把拖拽编辑器直接融入当前 React/Electron UI，可优先比较 FlowGram 和 React Flow；业务执行仍由原生 WorkflowService 或选定成熟引擎承担。基础审批先用固定模板，不为引入画布而提前增加通用执行器。

## 5. 现成可视化/低代码平台专项调研

具体嵌入形式与商业条款不得仅靠仓库根许可证推断。以下列出官方来源及未完成实测的边界。

### 实现语言与部署增量

| 平台 | 实现语言／运行环境 | 自托管依赖及直接来源 |
| --- | --- | --- |
| Node-RED | JavaScript／Node.js，浏览器编辑器 | 标准本地部署使用 Node.js 与流程／用户目录，不强制 Redis/Postgres；Windows 有官方说明。[部署](https://nodered.org/docs/getting-started/local)、[核心节点](https://nodered.org/docs/user-guide/nodes) |
| Activepieces | TypeScript／Node.js | 单容器爱好者模式用 PGLite＋内存队列；生产／多实例用 PostgreSQL＋Redis，官方 Compose 分 app/worker。PGLite 不是本项目 SQLite。[仓库](https://github.com/activepieces/activepieces)、[单容器限制](https://www.activepieces.com/docs/install/options/docker)、[Compose](https://github.com/activepieces/activepieces/blob/main/docker-compose.yml) |
| n8n | TypeScript／Node.js | 普通自托管默认 SQLite，可选 PostgreSQL；queue mode 用 Redis＋worker，分布式 SQLite 不受支持。调查时 master CLI 要求 Node ≥24，不能假设直接复用 Node22，选定发行版仍需复核。[CLI](https://github.com/n8n-io/n8n/blob/master/packages/cli/package.json)、[数据库](https://docs.n8n.io/deploy/host-n8n/configure-n8n/choose-n8ns-database)、[队列](https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/enable-queue-mode) |
| Windmill | Rust 后端／worker，Svelte5 前端；脚本支持 TS/Python 等 | 核心架构为 PostgreSQL＋server＋worker，队列也在 PostgreSQL，无需另加 Redis；官方提供 Docker Compose/Kubernetes 路径。[仓库 Stack](https://github.com/windmill-labs/windmill#stack)、[架构](https://www.windmill.dev/docs/advanced/self_host#architecture) |

### 逐项能力与授权限制

#### Node-RED

核心和编辑器为 Apache-2.0，允许商业修改／分发，须遵守许可证、改动声明和适用 NOTICE 要求，商标不随之授权；第三方节点须分别审计。官方支持嵌入 Express，分别挂载编辑器和 HTTP 节点路由，不要求购买核心的嵌入许可；这不是 React 原生组件，也不是现成 Egg 插件。[LICENSE](https://github.com/node-red/node-red/blob/main/LICENSE)、[嵌入示例](https://nodered.org/docs/user-guide/runtime/embedding)、[节点许可提醒](https://nodered.org/about/license/)

Inject 支持手动、周期／定时触发，HTTP In/Response 接收入站回调，HTTP Request 可调用 Egg。上下文默认内存，文件存储默认每 30 秒落盘；不能由此推导出持久人审或可靠跨重启续跑。本次未核实核心具备完整长期审批状态、权限与审计；需要另行设计。编辑器默认不安全，应配置 adminAuth 等访问控制。[触发](https://nodered.org/docs/user-guide/nodes)、[入站](https://cookbook.nodered.org/http/create-an-http-endpoint)、[出站](https://cookbook.nodered.org/http/simple-get-request)、[持久上下文](https://nodered.org/docs/user-guide/context)、[安全](https://nodered.org/docs/user-guide/runtime/securing-node-red)

#### Activepieces

非企业目录为 MIT；`packages/ee/` 和 `packages/server/api/src/app/ee` 按企业许可，生产需有效授权及相应席位。MIT 范围可按其条件修改／分发，但不等于企业嵌入功能免费：官方 builder SDK、自动用户 provision 的 embedding 明示企业方案。Electron 分发、白标和最终用户计费须单独确认合同范围。[根 LICENSE](https://github.com/activepieces/activepieces/blob/main/LICENSE)、[EE LICENSE](https://github.com/activepieces/activepieces/blob/main/packages/ee/LICENSE)、[Embedding](https://www.activepieces.com/docs/embedding/overview)

支持 Schedule/Webhook/轮询触发，可用 TS 自定义 piece 对接 Egg。WEBHOOK／DELAY waitpoint 持久化暂停状态，支持 HTTP 恢复并存活于 worker 重启，可构建审批。默认暂停上限累计 30 天，从 run 创建时计算，不是每次暂停重置；保留期不得更短，官方建议多留 1–2 天避免边界清理竞态。不能写成无限长期等待。爱好者模式不能直接升级企业版，官方称迁出需重新开始。[触发](https://www.activepieces.com/docs/flows/building-flows)、[轮询](https://www.activepieces.com/docs/build-pieces/piece-reference/triggers/polling-trigger)、[Flow Control](https://www.activepieces.com/docs/build-pieces/piece-reference/flow-control)、[期限配置](https://www.activepieces.com/docs/install/reference/environment-variables)、[迁移限制](https://www.activepieces.com/docs/install/options/docker)

#### n8n

核心是 Sustainable Use License（SUL），属于源码可见／fair-code，不是 OSI 开源；`.ee.` 文件／`.ee` 目录另需 Enterprise 授权。当前 FAQ 允许仅组织人员编辑的固定后台自动化，客户凭据本身不构成单独禁用条件；但外部用户通过自有 UI、API 或 AI 配置流程也不在免费许可内。直接展示编辑器需独立 OEM 商业协议，当前 OEM 文档要求保留 n8n 品牌；Enterprise 不应被当作自动包含 OEM／去品牌权。[SUL](https://github.com/n8n-io/n8n/blob/master/LICENSE.md)、[EE](https://github.com/n8n-io/n8n/blob/master/LICENSE_EE.md)、[非开源说明](https://docs.n8n.io/n8n-community-license/community-license)、[当前 FAQ](https://docs.n8n.io/n8n-community-license/community-license/license-faq)、[OEM](https://docs.n8n.io/deploy/host-n8n/deploy-as-an-oem-integration)

Webhook／Schedule 启动，HTTP Request 回调 Egg；Wait 支持时间、HTTP 或表单恢复，暂停执行数据入库，每次执行有 resume URL，可编排人审，但审批业务权限仍需设计。小于 65 秒的时间等待不落库，不能一概宣称所有等待都持久化。随付费 Electron 产品交付的免费许可适用性未获厂商确认。[Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook)、[Schedule](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger)、[HTTP](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest)、[Wait](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait)、[分发灰区](https://docs.n8n.io/n8n-community-license/community-license/license-faq)

#### Windmill

源码默认 AGPLv3，部分 client/OpenAPI 为 Apache-2.0，企业代码专有；不启用 enterprise 的源码构建物才按 AGPL 开源。官方社区 Docker 镜像／GitHub 二进制还含专有非公开代码：虽可免费使用、原样分发，但未经协议不得销售、转售、托管、修改或包装，不能把“AGPL 源码”直接套到官方发行包。白标／Flow Builder 嵌入 SDK 需特殊许可，React SDK 非公开／不在 npm；Vite 示例还要求 Svelte 编译插件。[LICENSE](https://github.com/windmill-labs/windmill/blob/main/LICENSE)、[白标与 SDK](https://www.windmill.dev/docs/misc/white_labelling)

自行编译开源核心也不是无条件的闭源嵌入授权：分发须履行相应源码义务；修改版经网络提供交互时，还须按 AGPL 第十三条向用户提供对应源码。是否让自有 Electron 部分构成衍生作品取决于具体组合／交付方式，不能仅凭独立 HTTP 调用断言整个产品必须开源，也不能断言完全无义务；本次未做法律审查。[AGPL 原文](https://github.com/windmill-labs/windmill/blob/main/LICENSE-AGPL)、[官方许可说明](https://www.windmill.dev/brand)

支持 cron、同步／异步 webhook、API 与轮询；Suspend 支持多事件审批、取消和超时，等待释放 worker。默认审批依靠秘密 URL；自定义审批表单、强制登录、组成员限制、禁止自批属于 Cloud／企业自托管功能，不应当作免费核心保证。Egg 可用 Bearer 调起 flow，审批后代理 resume/cancel；TS 脚本可调用业务 API。[触发](https://www.windmill.dev/docs/getting_started/triggers/)、[Webhook](https://www.windmill.dev/docs/core_concepts/webhooks)、[审批及版本限制](https://www.windmill.dev/docs/flows/flow_approval)、[释放 worker](https://www.windmill.dev/docs/core_concepts/workflows_as_code)

### 集成边界与未通过项

集成建议（基于上述接口的推断，未实现）：四者先作为独立服务，由 Egg 发 HTTP 事件、平台回调 Egg 执行业务动作，再沿现有 Socket.IO 通知客户端；不共享修改业务 SQLite。审批先在 Egg 校验身份、业务权限和幂等性，再代理秘密恢复链接；平台凭据不下发 Electron。这不是已具备可靠投递／outbox 的声明。[Node-RED HTTP](https://cookbook.nodered.org/http/create-an-http-endpoint)、[Activepieces 恢复](https://www.activepieces.com/docs/build-pieces/piece-reference/flow-control)、[n8n HTTP](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest)、[Windmill API](https://www.windmill.dev/docs/core_concepts/webhooks)

未实测四者在 Electron42/React19/Vite7 的编辑器嵌入、Cookie/CSP/SSO、Windows 服务化、崩溃恢复、重复回调、跨版本升级和真实长等待；未获得报价、OEM／离线交付／多租户合同确认。Node-RED 核心持久人审保障未确认；n8n master 的 Node24 要求不代表所有发行版；Activepieces 现成审批 piece 的具体版本／许可证未完成源码交叉核验，不影响上述 waitpoint 文档结论。不得将这些未通过项写成可直接上线的能力。

证据边界：暂停／恢复接口说明不等于完成审批产品，审批人身份绑定、撤回／转交、重复决定、业务副作用去重及审计完整性均未验收。用户电脑关机或平台服务不可达后的恢复行为也未验证。厂商方案名、定价和在线文档会变化，采购／实施前须锁定发行版本，复核授权条款并取得书面确认；本稿不能替代上线验收或法律意见。

## 6. 接入本项目的最小可靠边界

以下是建议方案，尚未实现：

```text
Electron 审批/自动化页面
        ↓
Egg Controller → WorkflowService（身份、状态、权限）
        ↓
SQL：版本化定义 / 实例 / 当前待办 / 审计 / 待投递动作
        ↓
定时扫描或独立 Worker / 外部引擎
        ↓
受控业务动作 → 现有任务、通知、聊天 Service → Socket + 增量同步
```

- **执行在服务端**：Electron 关闭、用户退出或网络断开，不能让审批实例与到期动作消失。
- **状态与动作分离**：提交/审批的数据库状态与待执行动作同事务落库；事务提交后再投递，失败可重试。增加独立的工作流 outbox/动作状态，不把按接收人保存的 SyncEvent 当作原始事件流重复触发。
- **权限仍由本项目控制**：从当前身份确定 companyId；验证审批人、流程角色和节点合法性。独立平台的 workspace/登录与本项目企业/部门身份不是天然一致。
- **幂等与并发**：以实例、节点、动作键记录执行结果；审批接口做状态条件更新/版本校验；回调去重，约束“批准/驳回同时到达”等竞争。
- **版本不可变**：发布流程定义后固定版本，已有实例继续用原版本；编辑画布不改变正在执行的审批。
- **受控节点**：起步仅允许批准、条件、创建任务、通知、延时和经过校验的 HTTP 动作中实际需要的类型。普通成员不得直接执行任意 JS/shell、SQL 或读服务器凭据；外部请求需防 SSRF 和凭据泄漏。
- **外部平台侧挂**：可以 HTTP 触发外部流程，再用签名回调/受限服务身份请求本项目业务动作。现有机器人密钥仅适用于机器人接口，不扩大为企业管理员令牌。
- **实现边界需调整**：现有 TasksService 自行管理事务并依赖 currentUser，不能直接当作无身份、任意事务注入的 Activity。实际接入应明确系统动作的权限与幂等入口，避免在 Controller 复制领域规则。

这些是根据当前服务/事务/权限模式提出的工程约束，不是第三方平台自动提供的功能。[本地任务服务](../../apps/server/app/service/tasks.ts)、[同步事件](../../apps/server/app/lib/sync.ts)、[通知存储](../../apps/server/app/lib/notifications.ts)。

## 7. 推荐的决策与验证顺序

### 若目标是审批模板

1. 先选一个真实场景，例如文档评审或请假申请，明确审批人、拒绝/撤回和超时处理。
2. 用原生持久化状态与表单配置完成闭环；并非必须先做拖拽设计器。
3. 只有出现节点分支/并行与可视化编辑需求，才决定加入 XState、React Flow 或 BPMN。
4. 大量外部集成时，再在 BullMQ 与独立平台中二选一验证，不同时引入所有备选。

### 若目标是 n8n 式自动化搭建

先比较 Activepieces 与 Node-RED：用“任务完成 → 条件判断 → 群消息/通知”和“Webhook → 创建任务 → 到期提醒”验证真实集成。授权允许给最终用户使用编辑器、企业隔离可落实、以及失败/等待可恢复，才进入产品嵌入阶段。

### 最少验证门槛

- 等待审批时重启服务、断网或关闭 Electron，实例仍可继续。
- 同一事件/回调投递两次，不重复产生任务、通知或外部写入。
- 一个节点失败后可重试且留有审计；数据库提交后投递前崩溃可以补偿。
- 不同企业、普通成员、错误审批人均不能读取/修改他人实例。
- 并发批准与驳回只得到一个合法最终结果；截止时间修改和超时事件有确定语义。
- 新版本发布不影响旧实例；升级引擎后的已有快照/流程能够恢复。
- 外部平台服务停机或令牌撤销，不丢事件、不暴露密钥。
- 候选包的 Node/CJS/ESM、React 19、Windows 开发环境或 Linux/Docker Worker 完成实际兼容验证。

本次没有运行这些验证；这是下次 PoC 的验收标准，不是通过报告。

## 8. 如果“GitHub 工作流”指 GitHub Actions

GitHub Actions 是 CI/CD 与仓库事件自动化平台，提供 Windows/Linux/macOS runner，工作流保存在 .github/workflows。它适合本项目自动测试、构建 Windows 安装包和发布 GitHub Release；不建议用它作为企业成员的实时审批/待办运行时，这个定位判断基于其仓库/runner 模型。[官方说明](https://docs.github.com/en/actions/get-started/understand-github-actions)。

当前仓库未发现 .github/workflows。建议可单独实施：

- PR/Push：固定 Node/pnpm 版本、冻结锁文件安装、shared 构建、服务端类型检查与测试、桌面端类型检查与测试。
- Tag/手动发布：Windows runner 执行现有 make:win，上传安装包，再按授权发布 Release。
- 测试数据库设置为临时 CHAT_DATABASE_PATH，并按测试场景禁用后台协作服务；不要调用会清理开发数据的 reset:data。
- 桌面测试继续使用当前 Electron-as-Node 包装脚本，验证 better-sqlite3 的 Electron ABI，不假设直接用普通 Node 运行即可。
- 签名证书、Release 写权限和部署密钥分别配置；不把个人令牌或私有数据放入工作流定义。

项目脚本依据：[根 package.json](../../package.json)、[Electron 测试启动器](../../apps/desktop/scripts/run-tests.mjs)、[服务端测试](../../apps/server/test/app/)。

## 9. 已查询的 npm 兼容性快照

以下来自 2026-10-11 的 npm 官方 registry `latest` 元数据，只证明声明的版本/许可/依赖范围，不是实际安装或集成测试。实施时锁定版本，并复核变更日志与已发布包；主分支文档可能领先发布包。

| 包 | 查询到的 latest | 许可 | 声明的关键条件 |
| --- | --- | --- | --- |
| bullmq | 6.3.12 | MIT | Node >=14.17；pg/Redis 客户端等后端相关 peer |
| xstate | 5.33.2 | MIT | 本次以稳定 v5 路线评估，不基于 v6 alpha 的实验性 durable API 上线 |
| @xyflow/react | 12.12.0 | MIT | React/react-dom >=17，范围覆盖项目 React 19 |
| @flowgram.ai/free-layout-editor | 1.0.15 | MIT | React/react-dom >=16.8；编辑器元数据不代表参考 Runtime 已发布 |
| bpmn-engine | 26.0.5 | MIT | Node >=18；需要显式管理 bpmn-elements、bpmn-moddle 等 peer |
| @temporalio/worker | 1.24.0 | MIT | Node >=20.3；Worker 原生依赖与宿主平台另做验证 |

一手元数据：[BullMQ](https://registry.npmjs.org/bullmq/latest)、[XState](https://registry.npmjs.org/xstate/latest)、[React Flow](https://registry.npmjs.org/@xyflow%2Freact/latest)、[FlowGram 编辑器](https://registry.npmjs.org/@flowgram.ai%2Ffree-layout-editor/latest)、[bpmn-engine](https://registry.npmjs.org/bpmn-engine/latest)、[Temporal Worker](https://registry.npmjs.org/@temporalio%2Fworker/latest)。

## 10. 尚未确认、不可当作已通过的事项

- 所有候选均未完成本项目运行环境下的 PoC、性能评估或运维演练。
- 平台白标、编辑器嵌入、SSO/RBAC、多租户和企业版具体权益应按实施时版本与合同核实；不能以核心仓库许可代替功能授权。
- 采用 AGPL/非 OSI 条款或企业许可方案时，需要结合具体部署/修改/分发方式评估义务；本文不是商业授权结论。
- 不使用 GitHub star 数或营销页面的“企业级”称号证明当前项目的适配与可靠性。
