/** 消息全文检索虚拟表中的索引字段。 */
export interface MessageFtsRow {
  /** 与 messages.row_id 一致的 FTS 行号。 */
  rowId: number;
  /** 文本、@ 名称和引用摘要组成的检索正文。 */
  content: string;
  /** 发送者名称快照。 */
  senderName: string;
  /** 图片与普通文件名称。 */
  fileName: string;
}

export const messageFtsTrigramTableSql = `
  CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
    content,
    sender_name,
    file_name,
    tokenize = 'trigram'
  );
`;

export const messageFtsUnicodeTableSql = `
  CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
    content,
    sender_name,
    file_name,
    tokenize = 'unicode61'
  );
`;
