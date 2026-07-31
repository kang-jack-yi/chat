import type { MessageKind, MessageStatus } from "@chat/shared";

/** 本地结构化消息模型。 */
export interface MessageRow {
  /** SQLite 自增行号，用于关联 FTS 索引。 */
  rowId: number;
  /** 本地稳定 ID；服务端消息使用 server:{id}，待发送消息使用 local:{clientId}。 */
  localId: string;
  /** 服务端消息 ID；尚未 ACK 时为 null。 */
  serverId: number | null;
  /** 客户端消息 ID，用于乐观消息、幂等和重试。 */
  clientId: string;
  /** 消息所属会话 ID。 */
  conversationId: number;
  /** 发送者用户 ID。 */
  senderId: number;
  /** 发送者名称快照。 */
  senderName: string;
  /** 消息类别，例如用户消息或系统消息。 */
  kind: MessageKind;
  /** 用于会话列表展示的消息摘要。 */
  summary: string;
  /** 用于本地全文检索的规范化文本。 */
  searchText: string;
  /** 消息中所有图片和文件名称的拼接文本。 */
  fileName: string;
  /** 本地发送状态。 */
  status: MessageStatus;
  /** 消息实体版本，用于忽略乱序的旧同步事件。 */
  version: number;
  /** 消息创建时间，使用 ISO 8601 字符串。 */
  createdAt: string;
  /** 本地最后更新时间，使用 ISO 8601 字符串。 */
  updatedAt: string;
  /** 删除或撤回时间；正常消息为 null。 */
  deletedAt: string | null;
  /** 完整 LocalImMessage 对象的 JSON 字符串。 */
  payload: string;
}

export const messageTableSql = `
  CREATE TABLE IF NOT EXISTS messages (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT,
    local_id TEXT NOT NULL UNIQUE,
    server_id INTEGER UNIQUE,
    client_id TEXT NOT NULL UNIQUE,
    conversation_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    sender_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    search_text TEXT NOT NULL,
    file_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
    ON messages(conversation_id, created_at DESC, row_id DESC);
`;
