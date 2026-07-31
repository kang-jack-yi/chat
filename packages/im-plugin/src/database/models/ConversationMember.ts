/** 会话与成员的本地关联模型。 */
export interface ConversationMemberRow {
  /** 服务端会话 ID。 */
  conversationId: number;
  /** 服务端用户 ID。 */
  userId: number;
  /** 完整会话成员对象的 JSON 字符串。 */
  payload: string;
  /** 本地最后更新时间，使用 ISO 8601 字符串。 */
  updatedAt: string;
}

export const conversationMemberTableSql = `
  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(conversation_id, user_id)
  );
`;
