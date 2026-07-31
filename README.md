# 企业协作桌面端

Windows Electron 企业通讯录与即时聊天原型。客户端使用 React 19、Ant Design、Tailwind、TanStack Query、Zustand、Axios 和 Socket.IO；服务端使用 Egg.js、Sequelize 与 SQLite。

本仓库只提供桌面客户端，不再提供浏览器版。每个登录账号在本机保存一份可重建的 SQLite 历史副本，服务端仍永久保存完整消息。

## 环境与启动

需要 Windows 10/11 x64、Node.js 22+、pnpm 10+。

```powershell
pnpm install
pnpm dev
```

`pnpm dev` 会同时启动：

- Egg.js API 与 Socket.IO：`http://127.0.0.1:7001`
- Electron Renderer 开发服务：`http://127.0.0.1:15173`
- Electron 桌面窗口

开发环境默认使用 `http://127.0.0.1:7001`，也可以在登录页通过“服务器设置”修改。正式安装包仅接受 HTTPS。

演示账号：

- 所有者：`13800000001`
- 管理员：`13800000002`
- 成员：`13800000003`
- 统一密码：`123456`

## 常用命令

```powershell
pnpm dev                 # 启动服务端和 Electron
pnpm build               # 构建全部工作区
pnpm test                # 运行服务端、Renderer 与本地 SQLite 测试
pnpm seed                # 初始化演示数据
pnpm build:desktop       # 构建 Electron 主进程、Preload 和 Renderer
pnpm make:win            # 生成 Windows x64 安装程序
```

安装程序输出到：

```text
apps/desktop/release/make/squirrel.windows/x64/EnterpriseChat-Setup.exe
```

构建正式安装包时可内置默认服务器：

```powershell
$env:DESKTOP_DEFAULT_SERVER_URL="https://chat.example.com"
pnpm make:win
```

未设置默认服务器时，客户端首次启动会强制打开“服务器设置”弹窗。

## 工程结构

```text
apps/
├─ desktop/
│  └─ src/
│     ├─ main/                 Electron 主进程、服务器配置、SQLite utilityProcess
│     ├─ preload/              最小权限 IPC bridge
│     └─ renderer/             React 桌面界面
└─ server/                     Egg.js API、Socket.IO、服务端 SQLite
packages/shared/               DTO、同步事件和公共类型
```

Renderer 不可直接访问 Node.js、SQLite 或真实文件路径。主进程只开放经过白名单校验的 IPC，`better-sqlite3` 在 Electron `utilityProcess` 中运行，打包时按 Electron ABI 重建并从 ASAR 解包。

## 服务器配置与认证

- 主进程执行 `/api/health` 检测，验证 `serviceId`、API 版本、最低客户端版本和永久 `serverId`。
- 切换服务器前先验证新地址；验证失败不会覆盖旧设置。
- 切换成功后关闭 SQLite、清理 Cookie/access token、Socket、TanStack Query 和 Zustand 登录态。
- Axios 在运行时设置 `baseURL`，自动加入 `Authorization: Bearer <accessToken>`。
- access token 有效期 15 分钟；refresh token 仅存于 HttpOnly Cookie。
- refresh token 对应服务端 `desktop_refresh_sessions`，每次刷新都会轮换，退出后立即撤销。

服务端至少应配置：

```text
CHAT_JWT_SECRET=至少32位随机字符串
CHAT_ALLOWED_ORIGINS=chat://app
CHAT_ALLOW_COMPANY_REGISTER=true
```

## 本地数据与同步

客户端数据目录：

```text
%APPDATA%/EnterpriseChat/
├─ settings.json
├─ data/{serverId}/{companyId}/{userId}/chat.db
└─ cache/{serverId}/{companyId}/{userId}/
```

本地 SQLite 未加密，同一 Windows 用户可直接读取数据库文件。数据库启用 WAL、外键、`synchronous=NORMAL`、5 秒 busy timeout 和 FTS5 trigram 中文索引。

同步流程：

1. 健康检查并恢复 refresh session。
2. 根据 `serverId/companyId/userId` 打开本地数据库。
3. 拉取通讯录、部门、会话、最近消息及快照游标。
4. 连接 Socket.IO，并通过持久 `sync_events` 补偿增量事件。
5. 后台按每页 100 条补齐完整历史并建立 FTS 索引。
6. 发送消息先写本地 `messages(pending)` 与 `outbox`；网络恢复后按 `clientId` 幂等重试。

退出账号会保留本地历史；“清除本地数据”才删除当前账号的数据目录。

服务端数据：

- 数据库：`apps/server/data/chat.sqlite`
- 上传文件：`apps/server/storage/uploads/{企业ID}/{年月}/`
- 同步事件保留 180 天，过期游标会要求客户端重新生成本地副本。

## 当前范围

支持通讯录、递归部门、成员管理、单聊、群聊、富文本、开源表情选择器、图片/文件消息、历史分页、本地全文搜索、已读状态、输入中、在线状态、置顶、免打扰、清空本人记录和离线发件箱。

当前面向单机原型。服务端横向扩容时需要迁移到 MySQL/PostgreSQL、对象存储以及 Redis Socket.IO Adapter。
