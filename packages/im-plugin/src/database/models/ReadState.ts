/** 用户在会话中的最后已读位置。 */
export interface ReadStateRow {
  /** 服务端会话 ID。 */
  conversationId: number;
  /** 服务端用户 ID。 */
  userId: number;
  /** 最后已读的服务端消息 ID，只允许递增。 */
  messageId: number;
  /** 已读位置最后更新时间，使用 ISO 8601 字符串。 */
  updatedAt: string;
}

export const readStateTableSql = `
  CREATE TABLE IF NOT EXISTS read_states (
    conversation_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(conversation_id, user_id)
  );
`;
