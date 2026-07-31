/** 本地会话列表模型。 */
export interface ConversationRow {
  /** 服务端会话 ID。 */
  id: number;
  /** 会话展示名称。 */
  name: string;
  /** 最后一条消息摘要。 */
  lastMessage: string;
  /** 最后一条消息时间；没有消息时为 null。 */
  lastMessageAt: string | null;
  /** 是否置顶，SQLite 中使用 0 或 1。 */
  pinned: 0 | 1;
  /** 是否从当前账号的普通会话列表隐藏，SQLite 中使用 0 或 1。 */
  hidden: 0 | 1;
  /** 完整会话对象的 JSON 字符串。 */
  payload: string;
  /** 本地最后更新时间，使用 ISO 8601 字符串。 */
  updatedAt: string;
}

export const conversationTableSql = `
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    last_message TEXT NOT NULL DEFAULT '',
    last_message_at TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;
